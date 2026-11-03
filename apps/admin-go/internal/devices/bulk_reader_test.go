package devices

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

// Use the same reader, decoder, receive, authorization and delivery path as serve.
// Pausing the destination writer makes receiver saturation deterministic, independent
// of OS TCP buffering, while the source is a real multiplexed WebSocket.
func sharedBulkSource(t *testing.T, targets map[string]*peer) (*websocket.Conn, *peer, *ChatGateway) {
	t.Helper()
	// A real writer may drain the prefilled queue depending on OS socket buffering.
	// Keep accounting fail-closed without storage instead of leaving a nil meter.
	gateway := &ChatGateway{sessions: newChatSessions(nil), meter: chattraffic.NewMeter(nil, nil)}
	gateway.sessions.hot.deliver = gateway.deliverRelay
	ready := make(chan *peer, 1)
	finished := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		source := newPeerWithDiagnostics(conn, newChatDiagnostics())
		defer close(finished)
		defer source.terminate()
		source.binaryRelay.Store(true)
		source.binaryBulk.Store(true)
		gateway.sessions.mu.Lock()
		for id, target := range targets {
			gateway.sessions.hot.sessions[id] = &hotSession{id: id, owner: t.Name(), device: "pc",
				expires: time.Now().Add(time.Minute), desktop: chatEndpoint{socket: source},
				mobile: &chatEndpoint{socket: target}}
		}
		gateway.sessions.mu.Unlock()
		ready <- source
		state := &chatConnection{identity: &chatIdentity{role: "desktop", expires: time.Now().Add(time.Minute)}}
		gateway.readChat(source, state)
	}))
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	source := <-ready
	t.Cleanup(func() {
		conn.Close()
		source.terminate()
		<-finished
		server.Close()
		source.bulkDispatchMu.Lock()
		dispatch := source.bulkDispatch
		source.bulkDispatchMu.Unlock()
		if dispatch != nil {
			select {
			case <-dispatch.stopped:
			case <-time.After(time.Second):
				t.Error("source dispatcher leaked")
			}
		}
		if source.bulkBuffered.Load() != 0 {
			t.Error("source budget leaked")
		}
	})
	return conn, source, gateway
}

func TestBulkSharedSourceReaderKeepsOtherSessionsAndHeartbeatMoving(t *testing.T) {
	slow, _ := bulkBackpressurePeer(t)
	fast, _ := bulkBackpressurePeer(t)
	fillBulkTarget(t, slow)
	conn, source, _ := sharedBulkSource(t, map[string]*peer{"download": slow, "unrelated": fast})
	if err := conn.WriteMessage(websocket.BinaryMessage, fullBulkWire(t)); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(platform.JSON{"type": "signal", "sessionId": "unrelated",
		"payload": platform.JSON{"kind": "key", "key": strings.Repeat("ab", 32)}}); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(platform.JSON{"type": "relay", "sessionId": "unrelated",
		"payload": strings.Repeat("ab", 32)}); err != nil {
		t.Fatal(err)
	}
	wire, err := encodeBulkRelay(platform.JSON{"sessionId": "unrelated", "payload": bulkRecord(128)})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, wire); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"signal", "relay"} {
		select {
		case frame := <-fast.queue:
			if !bytes.Contains(frame.bytes, []byte(expected)) {
				t.Fatalf("missing %s: %s", expected, frame.bytes)
			}
		case <-time.After(time.Second):
			t.Fatalf("slow session blocked unrelated %s", expected)
		}
	}
	select {
	case frame := <-fast.bulkQueue:
		frame.release()
		if !bytes.Equal(frame.bytes, wire) {
			t.Fatal("unrelated data changed")
		}
	case <-time.After(time.Second):
		t.Fatal("slow session blocked unrelated bulk")
	}
	assertBulkHeartbeat(t, conn)
	if source.bulkBuffered.Load() == 0 || slow.closed.Load() {
		t.Fatal("slow session was not still waiting")
	}
	// Authentication is still processed while the destination remains full.
	if err := conn.WriteJSON(platform.JSON{"type": "renew-auth"}); err != nil {
		t.Fatal(err)
	}
	waitBulkCondition(t, source.closed.Load)
}

func assertBulkHeartbeat(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	pong := make(chan struct{}, 1)
	conn.SetPongHandler(func(string) error { pong <- struct{}{}; return nil })
	readDone := make(chan struct{})
	go func() { defer close(readDone); conn.ReadMessage() }()
	t.Cleanup(func() { conn.Close(); <-readDone })
	if err := conn.WriteControl(websocket.PingMessage, []byte("alive"), time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-pong:
	case <-time.After(time.Second):
		t.Fatal("slow session blocked ping/pong handling")
	}
}
