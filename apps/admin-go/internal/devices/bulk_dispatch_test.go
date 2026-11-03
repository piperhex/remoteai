package devices

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

func bulkTestDelivery(t *testing.T, source, target *peer) (*chatSessions, relayDelivery) {
	t.Helper()
	sessions := newChatSessions(nil)
	session := &hotSession{id: "download", owner: t.Name(), device: "pc", bulkDone: make(chan struct{}),
		expires: time.Now().Add(time.Minute), desktop: chatEndpoint{socket: source},
		mobile: &chatEndpoint{socket: target}}
	sessions.hot.sessions[session.id] = session
	delivery := relayDelivery{owner: session.owner, sessionID: session.id, source: source,
		target: target, sessionDone: session.bulkDone}
	return sessions, delivery
}

func dispatchTestBulk(sessions *chatSessions, delivery relayDelivery, frame outputFrame) {
	frame.sourceDone, frame.sessionDone = delivery.source.done, delivery.sessionDone
	delivery.source.dispatchBulk(bulkDispatchItem{delivery: delivery, frame: frame,
		fail: func() { sessions.stopBulkSession(delivery) }})
}

func fillBulkTarget(t *testing.T, target *peer) {
	t.Helper()
	wire := fullBulkWire(t)
	for range bulkConnectionQueue / len(wire) {
		if !target.trySendBulk(outputFrame{bytes: wire}, t.Name()) {
			t.Fatal("could not fill receiver")
		}
	}
}

func waitBulkCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("bulk condition did not complete")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestBulkDispatchBurstPreservesWireOrderAndBudgets(t *testing.T) {
	source, _ := bulkBackpressurePeer(t)
	target, receiver := bulkBackpressurePeer(t)
	sessions, delivery := bulkTestDelivery(t, source, target)
	const count = 20 // More than the destination fits, but a normal bounded burst.
	wires := make([][]byte, count)
	var charged, sent atomic.Int64
	meter := relayMeterFunc(func(_ context.Context, owner string, size int, write func() error) error {
		if owner != delivery.owner {
			t.Error("billing owner changed")
		}
		if err := write(); err != nil {
			return err
		}
		charged.Add(int64(size))
		return nil
	})
	for i := range count {
		wires[i] = fullBulkWire(t)
		wires[i][len(wires[i])-1] = byte(i)
		dispatchTestBulk(sessions, delivery, outputFrame{bytes: wires[i], guard: delivery.guard(meter),
			sent: func(size int) { sent.Add(int64(size)) }})
	}
	if channelClosed(delivery.sessionDone) || source.bulkBuffered.Load() == 0 {
		t.Fatal("normal burst was rejected instead of staged")
	}
	if charged.Load() != 0 || sent.Load() != 0 {
		t.Fatal("queued frames were billed before writing")
	}
	if source.bulkBuffered.Load() > bulkConnectionQueue || target.bulkBuffered.Load() > bulkConnectionQueue {
		t.Fatal("connection budget exceeded")
	}
	bulkQueues.Lock()
	reserved := bulkQueues.accounts[t.Name()]
	bulkQueues.Unlock()
	if reserved != count*len(wires[0]) {
		t.Fatal("staging was unbudgeted or double charged", reserved)
	}
	target.send(platform.JSON{"type": "control-first"}, nil)
	finished := make(chan struct{})
	go func() { defer close(finished); target.writeLoop() }()
	defer func() { target.terminate(); <-finished }()
	kind, data, err := receiver.ReadMessage()
	if err != nil || kind != websocket.TextMessage || !bytes.Contains(data, []byte("control-first")) {
		t.Fatal("bulk blocked control", err)
	}
	for _, wire := range wires {
		kind, data, err = receiver.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage || !bytes.Equal(data, wire) {
			t.Fatal("bulk changed order or bytes", err)
		}
	}
	waitBulkCondition(t, func() bool { return source.bulkBuffered.Load()+target.bulkBuffered.Load() == 0 })
	if charged.Load() != int64(reserved) || sent.Load() != int64(reserved) {
		t.Fatal("staging changed successful wire-byte accounting", charged.Load(), sent.Load(), reserved)
	}
	bulkQueues.Lock()
	defer bulkQueues.Unlock()
	if bulkQueues.accounts[t.Name()] != 0 {
		t.Fatal("account budget leaked")
	}
}

func TestBulkDispatchExhaustionClosesOnlyAffectedSession(t *testing.T) {
	for _, limit := range []string{"connection", "frames", "account", "instance"} {
		t.Run(limit, func(t *testing.T) {
			source, _ := bulkBackpressurePeer(t)
			target, _ := bulkBackpressurePeer(t)
			sessions, delivery := bulkTestDelivery(t, source, target)
			var releases []func()
			defer func() {
				for _, release := range releases {
					release()
				}
			}()
			fillBulkTarget(t, target)
			if limit == "account" || limit == "instance" {
				bulkQueues.Lock()
				used := bulkQueues.accounts[t.Name()]
				bulkQueues.Unlock()
				release, ok := reserveBulkQueue(t.Name(), bulkAccountQueue-used)
				if !ok {
					t.Fatal("account setup failed")
				}
				releases = append(releases, release)
			}
			if limit == "instance" {
				for i := 1; i < bulkInstanceQueue/bulkAccountQueue; i++ {
					release, ok := reserveBulkQueue(fmt.Sprintf("%s-%d", t.Name(), i), bulkAccountQueue)
					if !ok {
						t.Fatal("instance setup failed")
					}
					releases = append(releases, release)
				}
				// Exercise the instance cap with an account that still has room.
				delivery.owner = t.Name() + "-fresh"
			}
			wire := fullBulkWire(t)
			if limit == "frames" {
				var err error
				wire, err = encodeBulkRelay(platform.JSON{"sessionId": "download", "payload": bulkRecord(1)})
				if err != nil {
					t.Fatal(err)
				}
				for target.trySendBulk(outputFrame{bytes: wire}, t.Name()) {
				}
			}
			for range bulkPendingFrames + 1 {
				dispatchTestBulk(sessions, delivery, outputFrame{bytes: wire})
			}
			if !channelClosed(delivery.sessionDone) || source.closed.Load() || target.closed.Load() {
				t.Fatal("pressure did not isolate its session")
			}
			waitBulkCondition(t, func() bool { return source.bulkBuffered.Load() == 0 })
			for _, release := range releases {
				release()
			}
			target.drainBulk()
			resumed, next := bulkTestDelivery(t, source, target)
			dispatchTestBulk(resumed, next, outputFrame{bytes: fullBulkWire(t)})
			if channelClosed(next.sessionDone) || len(target.bulkQueue) != 1 {
				t.Fatal("released budget could not be reused by a new session")
			}
		})
	}
}

func TestBulkDispatchRetriesReadyLaneWhileAnotherLaneStaysFull(t *testing.T) {
	source, _ := bulkBackpressurePeer(t)
	slow, _ := bulkBackpressurePeer(t)
	fast, _ := bulkBackpressurePeer(t)
	sessions, slowDelivery := bulkTestDelivery(t, source, slow)
	otherSessions, fastDelivery := bulkTestDelivery(t, source, fast)
	fillBulkTarget(t, slow)
	fillBulkTarget(t, fast)
	wire := fullBulkWire(t)
	dispatchTestBulk(sessions, slowDelivery, outputFrame{bytes: wire})
	dispatchTestBulk(otherSessions, fastDelivery, outputFrame{bytes: wire})
	// Both lanes have pending frames; freeing only the later lane must make progress.
	fast.drainBulk()
	select {
	case frame := <-fast.bulkQueue:
		frame.release()
		if !bytes.Equal(frame.bytes, wire) {
			t.Fatal("ready lane changed bytes")
		}
	case <-time.After(time.Second):
		t.Fatal("dispatcher waited on its first blocked lane")
	}
	if source.bulkBuffered.Load() != int64(len(wire)) {
		t.Fatal("blocked lane lost its reservation")
	}
}

func TestBulkDispatchActualTimeoutLeavesSourceConnected(t *testing.T) {
	source, _ := bulkBackpressurePeer(t)
	target, _ := bulkBackpressurePeer(t)
	sessions, delivery := bulkTestDelivery(t, source, target)
	fillBulkTarget(t, target)
	started := time.Now()
	dispatchTestBulk(sessions, delivery, outputFrame{bytes: fullBulkWire(t)})
	select {
	case <-delivery.sessionDone:
		if time.Since(started) < bulkQueueWaitTimeout {
			t.Fatal("normal burst expired prematurely")
		}
	case <-time.After(bulkQueueWaitTimeout + time.Second):
		t.Fatal("stalled session did not expire")
	}
	if source.closed.Load() || target.closed.Load() {
		t.Fatal("timeout closed shared transport")
	}
	waitBulkCondition(t, func() bool { return source.bulkBuffered.Load() == 0 })
}

func TestBulkDispatchCancellationAndReconnect(t *testing.T) {
	for _, event := range []string{"source", "target", "peer-close", "resume", "register", "timeout"} {
		t.Run(event, func(t *testing.T) {
			source, _ := bulkBackpressurePeer(t)
			target, _ := bulkBackpressurePeer(t)
			sessions, delivery := bulkTestDelivery(t, source, target)
			fillBulkTarget(t, target)
			dispatchTestBulk(sessions, delivery, outputFrame{bytes: fullBulkWire(t)})
			switch event {
			case "source":
				source.terminate()
			case "target":
				target.terminate()
			case "peer-close":
				if err := sessions.route(source, platform.JSON{"type": "peer-close", "sessionId": "download"}); err != nil {
					t.Fatal(err)
				}
			case "resume", "register":
				reconnectBulkTest(t, sessions, delivery, event)
			case "timeout":
				source.bulkDispatchMu.Lock()
				source.bulkDispatch.pending[0].deadline = time.Now().Add(-time.Second)
				source.bulkDispatchMu.Unlock()
				notifyBulkQueues()
			}
			waitBulkCondition(t, func() bool { return source.bulkBuffered.Load() == 0 })
			if event == "timeout" && (!channelClosed(delivery.sessionDone) || target.closed.Load()) {
				t.Fatal("timeout closed the transport or retained the stalled session")
			}
		})
	}
}

func reconnectBulkTest(t *testing.T, sessions *chatSessions, delivery relayDelivery, event string) {
	t.Helper()
	replacement, _ := bulkBackpressurePeer(t)
	identity := chatIdentity{owner: t.Name(), device: "pc", expires: time.Now().Add(time.Minute)}
	sessions.mu.Lock()
	session := sessions.hot.sessions[delivery.sessionID]
	session.token = strings.Repeat("ab", 32)
	claim := platform.JSON{"sessionId": session.id, "resumeToken": session.token}
	var err error
	if event == "resume" {
		err = sessions.hot.resume(hotJoin{client: replacement, identity: identity, message: platform.JSON{},
			desktop: session.desktop}, claim)
	} else {
		err = sessions.hot.register(replacement, identity, []interface{}{claim})
	}
	sessions.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if !channelClosed(delivery.sessionDone) {
		t.Fatal("old endpoint generation retained")
	}
	// A timeout racing reconnect must not revoke the replacement session.
	sessions.stopBulkSession(delivery)
	sessions.mu.Lock()
	defer sessions.mu.Unlock()
	if sessions.hot.sessions[delivery.sessionID] == nil {
		t.Fatal("stale timeout revoked replacement")
	}
}
