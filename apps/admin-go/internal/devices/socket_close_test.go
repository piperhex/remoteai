package devices

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

type closeWriteGate struct {
	enabled          atomic.Bool
	entered, release chan struct{}
	once             sync.Once
}

type slowCloseConn struct {
	net.Conn
	gate *closeWriteGate
}

func (conn slowCloseConn) Write(data []byte) (int, error) {
	if conn.gate.enabled.Load() {
		conn.gate.once.Do(func() { close(conn.gate.entered) })
		<-conn.gate.release
	}
	return conn.Conn.Write(data)
}

type slowCloseHijacker struct {
	http.ResponseWriter
	gate *closeWriteGate
}

func (w slowCloseHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, buffer, err := w.ResponseWriter.(http.Hijacker).Hijack()
	return slowCloseConn{conn, w.gate}, buffer, err
}

func slowClosingPeer(t *testing.T) (*peer, *closeWriteGate) {
	t.Helper()
	gate := &closeWriteGate{entered: make(chan struct{}), release: make(chan struct{})}
	accepted := make(chan *peer, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(slowCloseHijacker{w, gate}, r, nil)
		if err != nil {
			return
		}
		gate.enabled.Store(true)
		accepted <- &peer{conn: conn, done: make(chan struct{})}
	}))
	t.Cleanup(server.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	p := <-accepted
	t.Cleanup(func() { close(gate.release); conn.Close(); p.conn.Close() })
	return p, gate
}

func TestReplacingSlowPeerDoesNotBlockOtherSessions(t *testing.T) {
	previous, gate := slowClosingPeer(t)
	sessions := newChatSessions(nil)
	identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
	sessions.desktops["owner:pc"] = previous
	joined := make(chan error, 1)
	go func() { joined <- sessions.join(queuedPeer(), identity, platform.JSON{}, nil) }()
	select {
	case <-gate.entered:
	case <-time.After(time.Second):
		t.Fatal("close handshake did not start")
	}
	select {
	case err := <-joined:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("slow close blocked replacement while holding session lock")
	}
	updated := make(chan struct{})
	go func() { sessions.setLimit(5); close(updated) }()
	select {
	case <-updated:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("slow peer blocked unrelated session work")
	}
	if !previous.closed.Load() {
		t.Fatal("peer was not marked closed before network I/O")
	}
	select {
	case <-previous.done:
	default:
		t.Fatal("blocked writers were not released immediately")
	}
}
