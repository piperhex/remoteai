package mediarelay

import (
	"sync"
	"testing"
	"time"
)

func TestUDPQueueBoundsCopiesAndReleasesPackets(t *testing.T) {
	budget := &udpBudget{}
	queue := newUDPQueue(budget)
	done := make(chan struct{})
	frame := make([]byte, maxFrameBytes)
	for i := 0; i < udpQueueBytes/len(frame); i++ {
		if !queue.push(frame) {
			t.Fatal("queue rejected a bounded burst")
		}
	}
	if queue.push(frame) {
		t.Fatal("queue exceeded per-direction memory bound")
	}
	frame[0] = 1
	packet := queue.pop(done)
	if packet[0] != 0 {
		t.Fatal("socket buffer was not copied")
	}
	queue.close()
	if budget.bytes != len(packet) || queue.bytes != len(packet) {
		t.Fatal("in-flight packet must remain accounted until forwarding finishes")
	}
	queue.release(len(packet))
	queue.close()
	if budget.bytes != 0 || queue.bytes != 0 || queue.push(frame) || queue.pop(done) != nil {
		t.Fatal("closed queue leaked or accepted packets")
	}
}

func TestUDPQueueConcurrentShutdownReleasesEveryPacket(t *testing.T) {
	budget := &udpBudget{}
	queue := newUDPQueue(budget)
	done := make(chan struct{})
	var workers sync.WaitGroup
	workers.Add(3)
	go func() {
		defer workers.Done()
		for i := 0; i < 2000; i++ {
			queue.push(make([]byte, 1200))
		}
	}()
	go func() {
		defer workers.Done()
		for packet := queue.pop(done); packet != nil; packet = queue.pop(done) {
			queue.release(len(packet))
		}
	}()
	go func() { defer workers.Done(); queue.close() }()
	finished := make(chan struct{})
	go func() { workers.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("queue shutdown did not wake waiting worker")
	}
	if budget.bytes != 0 || queue.bytes != 0 {
		t.Fatal("concurrent shutdown leaked packets")
	}
}

func TestUDPQueueCancellationDoesNotDrainPendingPackets(t *testing.T) {
	budget := &udpBudget{}
	queue := newUDPQueue(budget)
	queue.push([]byte{1})
	done := make(chan struct{})
	close(done)
	if queue.pop(done) != nil {
		t.Fatal("forwarded a queued packet after cancellation")
	}
	queue.close()
	if budget.bytes != 0 {
		t.Fatal("cancelled queue leaked packets")
	}
}

func TestUDPQueueGlobalAndPacketLimits(t *testing.T) {
	budget := &udpBudget{}
	queues := make([]*udpQueue, 32)
	frame := make([]byte, 16*1024)
	for i := range queues {
		queues[i] = newUDPQueue(budget)
		for queues[i].push(frame) {
		}
	}
	if budget.bytes != udpBufferedBytes {
		t.Fatal("global UDP memory bound was not enforced")
	}
	for _, queue := range queues {
		queue.close()
	}
	queue := newUDPQueue(budget)
	for i := 0; i < udpQueuePackets; i++ {
		if !queue.push([]byte{1}) {
			t.Fatal("small packet rejected")
		}
	}
	if queue.push([]byte{1}) || queue.push(nil) || queue.push(make([]byte, maxFrameBytes+1)) {
		t.Fatal("packet count or size bound was not enforced")
	}
	queue.close()
	if budget.bytes != 0 {
		t.Fatal("global UDP buffer leaked")
	}
}
