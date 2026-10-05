package devices

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

func TestBulkRoutingRequiresSessionMembershipAndUsesAuthenticatedOwnership(t *testing.T) {
	sessions := newHotSessions(nil)
	desktop, mobile, outsider := queuedPeer(), queuedPeer(), queuedPeer()
	mobile.binaryBulk.Store(true)
	sessions.sessions["session"] = &hotSession{id: "session", owner: "owner", device: "computer",
		expires: time.Now().Add(time.Minute), desktop: chatEndpoint{socket: desktop},
		mobile: &chatEndpoint{socket: mobile}}
	var deliveries []relayDelivery
	sessions.deliver = func(delivery relayDelivery, frame platform.JSON) {
		if frame["type"] != "bulk" {
			t.Fatal("bulk converted to legacy")
		}
		deliveries = append(deliveries, delivery)
	}
	frame := platform.JSON{"type": "bulk", "sessionId": "session", "payload": bulkRecord(10),
		"owner": "forged", "device": "forged"}
	if handled, err := sessions.route(outsider, frame); !handled || err == nil {
		t.Fatal("accepted another socket's transfer")
	}
	if _, err := sessions.route(desktop, frame); err != nil {
		t.Fatal(err)
	}
	if len(deliveries) != 1 || deliveries[0].owner != "owner" || deliveries[0].device != "computer" ||
		deliveries[0].target != mobile || !deliveries[0].fromDesktop {
		t.Fatal("forwarded untrusted identity", deliveries)
	}
	mobile.binaryBulk.Store(false)
	if _, err := sessions.route(desktop, frame); err == nil || len(deliveries) != 1 {
		t.Fatal("forwarded to an unsupported path")
	}
}

func TestBulkSocketPrioritizesControlAndAuthorizesBeforeWritingWireBytes(t *testing.T) {
	wire, err := encodeBulkRelay(platform.JSON{"sessionId": "download", "payload": bulkRecord(512)})
	if err != nil {
		t.Fatal(err)
	}
	peers := make(chan *peer, 1)
	charged := make(chan int, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		p := &peer{conn: conn, queue: make(chan outputFrame, 4), bulkQueue: make(chan outputFrame, 4),
			done: make(chan struct{})}
		p.alive.Store(true)
		p.binaryBulk.Store(true)
		p.sendBulk(outputFrame{bytes: wire, guard: func(size int, write func() error) error {
			charged <- size
			return write()
		}}, "bulk-socket-test")
		p.send(platform.JSON{"type": "control-first"}, nil)
		peers <- p
		p.writeLoop()
	}))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	p := <-peers
	defer p.terminate()
	if err = conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	kind, control, err := conn.ReadMessage()
	if err != nil || kind != websocket.TextMessage || !bytes.Contains(control, []byte("control-first")) {
		t.Fatal("control did not precede queued file data", kind, err)
	}
	kind, data, err := conn.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || !bytes.Equal(data, wire) {
		t.Fatal("binary data changed", kind, err)
	}
	select {
	case size := <-charged:
		if size != len(wire) {
			t.Fatal("billing excluded relay envelope", size)
		}
	default:
		t.Fatal("forwarded without authorization")
	}
}
