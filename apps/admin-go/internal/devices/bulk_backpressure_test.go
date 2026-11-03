package devices

import (
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
	t.Cleanup(func() {
		p.terminate()
		conn.Close()
		p.bulkDispatchMu.Lock()
		dispatch := p.bulkDispatch
		p.bulkDispatchMu.Unlock()
		if dispatch != nil {
			select {
			case <-dispatch.stopped:
			case <-time.After(time.Second):
				t.Error("bulk dispatcher leaked after source closed")
			}
		}
		p.drainBulk()
		if p.bulkBuffered.Load() != 0 {
			t.Error("connection bulk budget leaked")
		}
	})
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
