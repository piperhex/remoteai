package devices

import (
	"fmt"
	"sync"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
)

func commandFixture(t *testing.T) (*ControlGateway, *peer, *peer) {
	t.Helper()
	g := newControlGateway(nil)
	caller, desktop := queuedPeer(), queuedPeer()
	g.sockets["owner:device"] = desktop
	t.Cleanup(func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		for _, command := range g.commands {
			command.timer.Stop()
		}
	})
	return g, caller, desktop
}

func forwardCommand(g *ControlGateway, caller *peer, device, request string) {
	g.forwardRemoteCommand(caller, "owner", platform.JSON{"deviceId": device, "requestId": request},
		remoteCommandInput{Command: "whoami", Shell: "auto", TimeoutSeconds: 30})
}

func TestRemoteCommandDefaultFiveAndConfiguredLimits(t *testing.T) {
	for _, limit := range []int{0, 1, 8, 32} {
		t.Run(fmt.Sprint(limit), func(t *testing.T) {
			g, caller, desktop := commandFixture(t)
			g.commandLimit.Store(int64(limit))
			expected := limit
			if expected == 0 {
				expected = 5
			}
			for index := 0; index < expected; index++ {
				forwardCommand(g, caller, "device", fmt.Sprint(index))
				frame := updateFrame(t, desktop)
				if frame["concurrencyLimit"] != float64(expected) {
					t.Fatal(frame)
				}
			}
			if len(g.commands) != expected {
				t.Fatal("commands did not overlap", len(g.commands))
			}
			forwardCommand(g, caller, "device", "overflow")
			if updateFrame(t, caller)["errorCode"] != "client.remoteCommand.busy" || len(desktop.queue) != 0 {
				t.Fatal("limit was not enforced")
			}
		})
	}
}

func TestRemoteCommandCallerAndTargetScopesAreIndependent(t *testing.T) {
	g, caller, desktop := commandFixture(t)
	second, other := queuedPeer(), queuedPeer()
	g.sockets["owner:other"] = other
	for index := 0; index < 5; index++ {
		forwardCommand(g, caller, "device", fmt.Sprint(index))
		updateFrame(t, desktop)
	}
	forwardCommand(g, caller, "other", "same-caller")
	if updateFrame(t, caller)["error"] == "" || len(other.queue) != 0 {
		t.Fatal("caller scope exceeded")
	}
	forwardCommand(g, second, "device", "same-target")
	if updateFrame(t, second)["error"] == "" || len(desktop.queue) != 0 {
		t.Fatal("target scope exceeded")
	}
	forwardCommand(g, second, "other", "isolated")
	if updateFrame(t, other)["type"] != "remote-command" {
		t.Fatal("different target was blocked")
	}
}

func TestRemoteCommandConcurrentCallersCannotOverbookTarget(t *testing.T) {
	g, _, desktop := commandFixture(t)
	var workers sync.WaitGroup
	for index := 0; index < 24; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			forwardCommand(g, queuedPeer(), "device", fmt.Sprint(index))
		}(index)
	}
	workers.Wait()
	if len(g.commands) != 5 || len(desktop.queue) != 5 {
		t.Fatal("target overbooked", len(g.commands))
	}
}

func TestRemoteCommandDecreasePreservesRunningCommandsAndOutOfOrderResults(t *testing.T) {
	g, caller, desktop := commandFixture(t)
	commands := make([]string, 5)
	for index := range commands {
		forwardCommand(g, caller, "device", fmt.Sprint(index))
		commands[index] = updateFrame(t, desktop)["commandId"].(string)
	}
	g.commandLimit.Store(1)
	forwardCommand(g, caller, "device", "blocked")
	if updateFrame(t, caller)["error"] == "" || len(g.commands) != 5 || len(desktop.queue) != 0 {
		t.Fatal("decrease interrupted running commands")
	}
	for index := len(commands) - 1; index >= 0; index-- {
		reply := platform.JSON{"commandId": commands[index], "data": platform.JSON{"stdout": fmt.Sprint(index)}}
		if index == 3 {
			reply["error"] = "test failure"
		}
		if index == 2 {
			reply["data"] = nil
		}
		g.receiveRemoteCommand(desktop, controlSession{owner: "owner", device: "device"}, reply)
		if updateFrame(t, caller)["requestId"] != fmt.Sprint(index) {
			t.Fatal("result crossed requests")
		}
	}
	forwardCommand(g, caller, "device", "after-completion")
	if updateFrame(t, desktop)["concurrencyLimit"] != float64(1) || len(g.commands) != 1 {
		t.Fatal("slots were not released")
	}
	g.commandLimit.Store(8)
	for index := 1; index < 8; index++ {
		forwardCommand(g, caller, "device", fmt.Sprint(index))
		updateFrame(t, desktop)
	}
	if len(g.commands) != 8 {
		t.Fatal("increase did not apply")
	}
}

func TestRemoteCommandDisconnectCancelsOnlyAssociatedTasks(t *testing.T) {
	g, caller, desktop := commandFixture(t)
	second := queuedPeer()
	for index := 0; index < 3; index++ {
		forwardCommand(g, caller, "device", fmt.Sprint(index))
		updateFrame(t, desktop)
	}
	forwardCommand(g, second, "device", "other")
	survivor := updateFrame(t, desktop)["commandId"].(string)
	g.mu.Lock()
	g.disconnectRemoteCommands(caller)
	g.mu.Unlock()
	if len(g.commands) != 1 {
		t.Fatal("disconnect removed unrelated command")
	}
	for index := 0; index < 3; index++ {
		frame := updateFrame(t, desktop)
		if frame["type"] != "remote-command-cancel" || frame["commandId"] == survivor {
			t.Fatal(frame)
		}
	}
	g.mu.Lock()
	g.disconnectRemoteCommands(desktop)
	g.mu.Unlock()
	if len(g.commands) != 0 || updateFrame(t, second)["requestId"] != "other" {
		t.Fatal("target disconnect leaked")
	}
}
