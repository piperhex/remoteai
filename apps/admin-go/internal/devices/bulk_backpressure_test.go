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

// Keep the writer stopped to reproduce a sender burst while accounting is still starting.
func bulkBackpressurePeer(t *testing.T) (*peer, *websocket.Conn) {
	t.Helper()
	peers := make(chan *peer, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		p := &peer{conn: conn, queue: make(chan outputFrame, 32), bulkQueue: make(chan outputFrame, 32),
			done: make(chan struct{})}
		p.binaryBulk.Store(true)
		p.alive.Store(true)
		peers <- p
	}))
	t.Cleanup(server.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	p := <-peers
	t.Cleanup(func() { p.terminate(); conn.Close(); p.drainBulk() })
	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	return p, conn
}

func fullBulkWire(t *testing.T) []byte {
	t.Helper()
	wire, err := encodeBulkRelay(platform.JSON{"sessionId": "download",
		"payload": bulkRecord(bulkRecordLimit - bulkRecordHeader - bulkRecordTag)})
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func TestBulkSenderBurstWaitsForWriterInsteadOfDisconnecting(t *testing.T) {
	p, conn := bulkBackpressurePeer(t)
	wire := fullBulkWire(t)
	completed := make(chan struct{})
	go func() {
		defer close(completed)
		for range 16 {
			p.sendBulk(outputFrame{bytes: wire}, t.Name())
		}
	}()
	select {
	case <-completed:
		t.Fatal("a full-size batch must wait for queue space, not close the connection")
	case <-time.After(30 * time.Millisecond):
	}
	if p.closed.Load() || p.bulkBuffered.Load() > bulkConnectionQueue {
		t.Fatal("burst disconnected or exceeded the queue budget")
	}
	p.send(platform.JSON{"type": "control-first"}, nil)
	writerDone := make(chan struct{})
	go func() { defer close(writerDone); p.writeLoop() }()
	defer func() { p.terminate(); <-writerDone }()
	kind, data, err := conn.ReadMessage()
	if err != nil || kind != websocket.TextMessage || !bytes.Contains(data, []byte("control-first")) {
		t.Fatal("control was blocked by a waiting download", kind, err)
	}
	for range 16 {
		kind, data, err = conn.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage || !bytes.Equal(data, wire) {
			t.Fatal("burst was lost or changed", kind, err)
		}
	}
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("sender did not resume after queue drained")
	}
}

func TestBulkBackpressureReleasesAccountBudgetAndWakesSender(t *testing.T) {
	p, _ := bulkBackpressurePeer(t)
	release, ok := reserveBulkQueue(t.Name(), bulkAccountQueue)
	if !ok {
		t.Fatal("could not occupy account budget")
	}
	defer release()
	completed := make(chan struct{})
	go func() { defer close(completed); p.sendBulk(outputFrame{bytes: fullBulkWire(t)}, t.Name()) }()
	select {
	case <-completed:
		t.Fatal("account pressure must wait instead of disconnecting")
	case <-time.After(30 * time.Millisecond):
	}
	release()
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("released account budget did not wake the sender")
	}
	frame := <-p.bulkQueue
	frame.release()
	frame.release()
	if p.closed.Load() || p.bulkBuffered.Load() != 0 {
		t.Fatal("connection closed or reservation was released more than once")
	}
	bulkQueues.Lock()
	defer bulkQueues.Unlock()
	if bulkQueues.accounts[t.Name()] != 0 {
		t.Fatal("account queue reservation leaked")
	}
}

func TestBulkBackpressureStopsWhenEitherSocketCloses(t *testing.T) {
	for _, side := range []string{"source", "receiver"} {
		t.Run(side, func(t *testing.T) {
			p, _ := bulkBackpressurePeer(t)
			release, ok := reserveBulkQueue(t.Name(), bulkAccountQueue)
			if !ok {
				t.Fatal("could not occupy account budget")
			}
			defer release()
			cancel := make(chan struct{})
			completed := make(chan struct{})
			go func() {
				defer close(completed)
				p.sendBulk(outputFrame{bytes: fullBulkWire(t), sourceDone: cancel}, t.Name())
			}()
			select {
			case <-completed:
				t.Fatal("sender did not wait for capacity")
			case <-time.After(30 * time.Millisecond):
			}
			if side == "source" {
				close(cancel)
			} else {
				p.terminate()
			}
			select {
			case <-completed:
			case <-time.After(time.Second):
				t.Fatal("closed socket left its sender waiting")
			}
			if p.bulkBuffered.Load() != 0 || len(p.bulkQueue) != 0 {
				t.Fatal("cancelled frame was enqueued")
			}
		})
	}
}

func TestBulkBackpressureTimeoutIsBounded(t *testing.T) {
	p, conn := bulkBackpressurePeer(t)
	wire := fullBulkWire(t)
	for range bulkConnectionQueue / len(wire) {
		p.sendBulk(outputFrame{bytes: wire}, t.Name())
	}
	completed := make(chan struct{})
	go func() { defer close(completed); p.sendBulk(outputFrame{bytes: wire}, t.Name()) }()
	_, _, err := conn.ReadMessage()
	if !websocket.IsCloseError(err, 4008) {
		t.Fatal("a permanently stalled receiver must close after the bounded wait", err)
	}
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("timed-out sender did not exit")
	}
	p.drainBulk()
	if p.bulkBuffered.Load() != 0 {
		t.Fatal("timed-out connection leaked queue bytes")
	}
}

func TestBulkBackpressureDoesNotHoldGlobalSessionLock(t *testing.T) {
	target, _ := bulkBackpressurePeer(t)
	source := queuedPeer()
	wire := fullBulkWire(t)
	for range bulkConnectionQueue / len(wire) {
		target.sendBulk(outputFrame{bytes: wire}, t.Name())
	}
	sessions := newChatSessions(nil)
	sessions.hot.sessions["download"] = &hotSession{id: "download", owner: t.Name(), device: "pc",
		expires: time.Now().Add(time.Minute), desktop: chatEndpoint{socket: source},
		mobile: &chatEndpoint{socket: target}}
	sessions.hot.deliver = func(delivery relayDelivery, _ platform.JSON) {
		delivery.target.sendBulk(outputFrame{bytes: wire}, delivery.owner)
	}
	bulkDone := make(chan error, 1)
	go func() {
		bulkDone <- sessions.route(source, platform.JSON{"type": "bulk", "sessionId": "download",
			"payload": bulkRecord(1)})
	}()
	defer func() { target.terminate(); <-bulkDone }()
	select {
	case <-bulkDone:
		bulkDone <- nil
		t.Fatal("sender did not wait for capacity")
	case <-time.After(30 * time.Millisecond):
	}
	controlDone := make(chan error, 1)
	go func() {
		controlDone <- sessions.route(target, platform.JSON{"type": "signal", "sessionId": "download",
			"payload": platform.JSON{"kind": "key", "key": strings.Repeat("ab", 32)}})
	}()
	select {
	case err := <-controlDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("a waiting download held the global routing lock")
	}
}
