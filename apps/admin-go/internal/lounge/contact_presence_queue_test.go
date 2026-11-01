package lounge

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type slowCloseConn struct {
	net.Conn
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (c *slowCloseConn) Close() error {
	c.once.Do(func() { close(c.entered) })
	<-c.release
	return c.Conn.Close()
}

func presenceSlowSocket(t *testing.T) (*websocket.Conn, *slowCloseConn) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	var slow *slowCloseConn
	dialer := websocket.Dialer{NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		slow = &slowCloseConn{Conn: conn, entered: make(chan struct{}), release: make(chan struct{})}
		return slow, nil
	}}
	ws, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { close(slow.release); ws.Close() })
	return ws, slow
}

func TestContactPresenceQueueOverflowDoesNotHoldHubLockForSocketClose(t *testing.T) {
	for _, limit := range []string{"frames", "bytes"} {
		t.Run(limit, func(t *testing.T) {
			h := newHub(nil)
			p := presenceTestPeer(h, uuid.NewString())
			ws, slow := presenceSlowSocket(t)
			p.conn = ws
			if limit == "frames" {
				p.queue = make(chan []byte)
			} else {
				p.queued = maxQueuedBytes
			}
			watched := make(chan bool, 1)
			go func() { watched <- h.watch(p, []string{uuid.NewString()}) }()
			select {
			case <-slow.entered:
			case <-time.After(2 * time.Second):
				t.Fatal("overflow did not close socket")
			}
			select {
			case ok := <-watched:
				if !ok {
					t.Fatal("watch rejected before overflow")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("watch waited for socket close")
			}
			if !h.mu.TryLock() {
				t.Fatal("socket close retained hub lock")
			}
			h.mu.Unlock()
			if h.activeLocked(p) || h.watch(p, []string{uuid.NewString()}) {
				t.Fatal("overflowed connection remained active")
			}
		})
	}
}

func TestContactPresenceShutdownStopsAllPeersBeforeSocketClose(t *testing.T) {
	h := newHub(nil)
	closed := make(chan struct{})
	// Registered before the socket cleanup so its blocked Close is released first.
	t.Cleanup(func() {
		select {
		case <-closed:
		case <-time.After(2 * time.Second):
			t.Error("hub shutdown did not finish")
		}
	})
	ws, slow := presenceSlowSocket(t)
	p := presenceTestPeer(h, uuid.NewString())
	p.conn = ws
	other := presenceTestPeer(h, uuid.NewString())
	go func() { h.close(); close(closed) }()
	select {
	case <-slow.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not close socket")
	}
	if !h.mu.TryLock() {
		t.Fatal("shutdown held the hub lock during socket close")
	}
	active := h.activeLocked(p) || h.activeLocked(other)
	h.mu.Unlock()
	if active || h.watch(other, []string{p.user.ID}) {
		t.Fatal("shutdown left an active subscriber")
	}
}
