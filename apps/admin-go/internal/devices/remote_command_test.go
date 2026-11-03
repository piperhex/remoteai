package devices

import (
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func commandRequest() platform.JSON {
	return platform.JSON{"deviceId": "device", "requestId": "diagnose"}
}

func TestRemoteCommandsRequireSameOwnerAndExactTargetSocket(t *testing.T) {
	g := newControlGateway(nil)
	caller, desktop, other := queuedPeer(), queuedPeer(), queuedPeer()
	g.sockets["owner:device"] = desktop
	input := remoteCommandInput{Command: "whoami", Shell: "auto", TimeoutSeconds: 30}
	g.forwardRemoteCommand(caller, "intruder", commandRequest(), input)
	if updateFrame(t, caller)["error"] == "" || len(desktop.queue) != 0 {
		t.Fatal("cross-account execution")
	}
	g.forwardRemoteCommand(caller, "owner", commandRequest(), input)
	forwarded := updateFrame(t, desktop)
	reply := platform.JSON{"commandId": forwarded["commandId"], "data": platform.JSON{
		"stdout": "diagnostic", "stderr": "", "exitCode": 0, "timedOut": false, "truncated": false, "durationMs": 10,
	}}
	for _, session := range []controlSession{{owner: "intruder", device: "device"}, {owner: "owner", device: "other"}} {
		g.receiveRemoteCommand(desktop, session, reply)
	}
	g.receiveRemoteCommand(other, controlSession{owner: "owner", device: "device"}, reply)
	if len(caller.queue) != 0 || len(g.commands) != 1 {
		t.Fatal("forged response accepted")
	}
	g.receiveRemoteCommand(desktop, controlSession{owner: "owner", device: "device"}, reply)
	response := updateFrame(t, caller)
	if response["requestId"] != "diagnose" || response["error"] != "" || len(g.commands) != 0 {
		t.Fatal("response was not delivered to original requester")
	}
	g.receiveRemoteCommand(desktop, controlSession{owner: "owner", device: "device"}, reply)
	if len(caller.queue) != 0 {
		t.Fatal("duplicate command response")
	}
}

func TestRemoteCommandsCancelOnDisconnectAndTimeoutAndLimitConcurrency(t *testing.T) {
	g := newControlGateway(nil)
	g.commandLimit.Store(1)
	caller, desktop, second := queuedPeer(), queuedPeer(), queuedPeer()
	g.sockets["owner:device"] = desktop
	input := remoteCommandInput{Command: "whoami", Shell: "auto", TimeoutSeconds: 30}
	g.forwardRemoteCommand(caller, "owner", commandRequest(), input)
	updateFrame(t, desktop)
	g.forwardRemoteCommand(second, "owner", commandRequest(), input)
	if updateFrame(t, second)["error"] == "" || len(desktop.queue) != 0 {
		t.Fatal("overlapping execution")
	}
	g.mu.Lock()
	g.disconnectRemoteCommands(caller)
	g.mu.Unlock()
	if updateFrame(t, desktop)["type"] != "remote-command-cancel" || len(g.commands) != 0 {
		t.Fatal("requester disconnect did not cancel")
	}
	g.forwardRemoteCommand(caller, "owner", commandRequest(), input)
	command := updateFrame(t, desktop)["commandId"].(string)
	g.commands[command].timer.Stop()
	g.expireRemoteCommand(command)
	if updateFrame(t, desktop)["type"] != "remote-command-cancel" || updateFrame(t, caller)["error"] == "" {
		t.Fatal("timeout did not cancel and report uncertain outcome")
	}
	g.forwardRemoteCommand(caller, "owner", commandRequest(), input)
	updateFrame(t, desktop)
	g.mu.Lock()
	g.disconnectRemoteCommands(desktop)
	g.mu.Unlock()
	if updateFrame(t, caller)["error"] == "" || len(g.commands) != 0 {
		t.Fatal("target disconnect retained command")
	}
}

func TestRemoteCommandValidationAndExpiredAuthentication(t *testing.T) {
	for _, input := range []platform.JSON{
		{"command": ""}, {"command": "x\x00"}, {"command": strings.Repeat("x", maxRemoteCommandBytes+1)},
		{"command": "whoami", "timeoutSeconds": 61}, {"command": "whoami", "timeoutSeconds": -1},
		{"command": "whoami", "timeoutSeconds": 0}, {"command": "whoami", "shell": ""},
		{"command": "whoami", "shell": "cmd"}, {"command": "whoami", "cwd": ""},
		{"command": "whoami", "unexpected": true},
	} {
		if _, valid := parseRemoteCommand(input); valid {
			t.Fatalf("accepted invalid command: %v", input)
		}
	}
	input, valid := parseRemoteCommand(platform.JSON{"command": "whoami"})
	if !valid || input.TimeoutSeconds != 30 || input.Shell != "auto" {
		t.Fatal("invalid defaults")
	}
	g := newControlGateway(nil)
	caller := queuedPeer()
	g.sessions[caller] = controlSession{owner: "owner", kind: "subscriber", expires: time.Now().Add(-time.Second)}
	if g.receive(caller, platform.JSON{"type": "remote-command"}, nil) == nil {
		t.Fatal("expired authentication accepted")
	}
	if !supportedCapability("remote-command") || checkCapability(&Device{}, commandSpec{capability: "remote-command"}) == nil {
		t.Fatal("missing plugin capability was accepted")
	}
}
