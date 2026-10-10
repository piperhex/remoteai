package mediarelay

import "sync"

const udpQueueBytes = 1024 * 1024
const udpQueuePackets = 1024
const udpBufferedBytes = 16 * 1024 * 1024

// Count queued and in-flight datagrams across both directions and all accounts.
type udpBudget struct {
	mu    sync.Mutex
	bytes int
}

func (b *udpBudget) reserve(bytes int) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.bytes+bytes > udpBufferedBytes {
		return false
	}
	b.bytes += bytes
	return true
}

func (b *udpBudget) release(bytes int) {
	b.mu.Lock()
	b.bytes -= bytes
	b.mu.Unlock()
}

// UDP cannot apply TCP backpressure. Absorb a bounded keyframe burst while the
// forwarding worker checks each packet's quota; the reader must never wait on Redis.
type udpQueue struct {
	mu      sync.Mutex
	budget  *udpBudget
	packets [][]byte
	bytes   int
	closed  bool
	ready   chan struct{}
}

func newUDPQueue(budget *udpBudget) *udpQueue {
	return &udpQueue{budget: budget, ready: make(chan struct{}, 1)}
}

func (q *udpQueue) push(packet []byte) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed || len(packet) == 0 || len(packet) > maxFrameBytes ||
		len(q.packets) >= udpQueuePackets || q.bytes+len(packet) > udpQueueBytes {
		return false
	}
	if !q.budget.reserve(len(packet)) {
		return false
	}
	q.bytes += len(packet)
	q.packets = append(q.packets, append([]byte(nil), packet...))
	select {
	case q.ready <- struct{}{}:
	default:
	}
	return true
}

func (q *udpQueue) pop(done <-chan struct{}) []byte {
	for {
		select {
		case <-done:
			return nil
		default:
		}
		q.mu.Lock()
		if len(q.packets) > 0 {
			packet := q.packets[0]
			q.packets[0] = nil
			q.packets = q.packets[1:]
			q.mu.Unlock()
			return packet
		}
		closed := q.closed
		q.mu.Unlock()
		if closed {
			return nil
		}
		select {
		case <-done:
			return nil
		case <-q.ready:
		}
	}
}

func (q *udpQueue) release(bytes int) {
	q.mu.Lock()
	q.bytes -= bytes
	q.mu.Unlock()
	q.budget.release(bytes)
}

func (q *udpQueue) close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	q.closed = true
	close(q.ready)
	bytes := 0
	for _, packet := range q.packets {
		bytes += len(packet)
	}
	q.packets = nil
	q.bytes -= bytes
	q.budget.release(bytes)
}
