package devices

import (
	"bytes"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

func TestBulkSharedSourceWithStalledSocketWriter(t *testing.T) {
	slow, receiver := bulkBackpressurePeer(t)
	fast, _ := bulkBackpressurePeer(t)
	// Force real kernel backpressure; the receiving WebSocket never reads.
	if err := slow.conn.UnderlyingConn().(*net.TCPConn).SetWriteBuffer(1024); err != nil {
		t.Fatal(err)
	}
	if err := receiver.UnderlyingConn().(*net.TCPConn).SetReadBuffer(1024); err != nil {
		t.Fatal(err)
	}
	fillBulkTarget(t, slow)
	writerDone := make(chan struct{})
	go func() { defer close(writerDone); slow.writeLoop() }()
	defer func() { slow.terminate(); <-writerDone }()
	conn, source, _ := sharedBulkSource(t, map[string]*peer{"download": slow, "unrelated": fast})
	wire := fullBulkWire(t)
	deadline := time.Now().Add(time.Second)
	for source.bulkBuffered.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("receiver did not produce kernel backpressure")
		}
		if err := conn.WriteMessage(websocket.BinaryMessage, wire); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := conn.WriteJSON(platform.JSON{"type": "signal", "sessionId": "unrelated",
		"payload": platform.JSON{"kind": "key", "key": strings.Repeat("ab", 32)}}); err != nil {
		t.Fatal(err)
	}
	other, err := encodeBulkRelay(platform.JSON{"sessionId": "unrelated", "payload": bulkRecord(128)})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, other); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fast.queue:
	case <-time.After(time.Second):
		t.Fatal("kernel backpressure blocked unrelated control")
	}
	select {
	case frame := <-fast.bulkQueue:
		frame.release()
		if !bytes.Equal(frame.bytes, other) {
			t.Fatal("unrelated data changed")
		}
	case <-time.After(time.Second):
		t.Fatal("kernel backpressure blocked unrelated data")
	}
	assertBulkHeartbeat(t, conn)
	if source.bulkBuffered.Load() == 0 {
		t.Fatal("slow socket unexpectedly drained")
	}
}
