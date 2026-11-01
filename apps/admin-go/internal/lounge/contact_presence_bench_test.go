package lounge

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

const benchmarkContacts = 16

func benchmarkContactID(value int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", value)
}

func benchmarkPresencePeer(h *hub, id string) *peer {
	p := &peer{user: account{ID: id}, expires: time.Now().Add(time.Hour),
		done: make(chan struct{}), queue: make(chan []byte, 32)}
	h.clients[p] = true
	h.indexContactPeerLocked(p)
	return p
}

func drainPresenceQueue(p *peer) {
	for len(p.queue) > 0 {
		<-p.queue
	}
	p.mu.Lock()
	p.queued = 0
	p.mu.Unlock()
}

func benchmarkPresenceHub(size int) (*hub, []*peer, []string) {
	h := newHub(nil)
	ids := make([]string, benchmarkContacts)
	for i := range ids {
		ids[i] = benchmarkContactID(size + i + 1)
	}
	peers := make([]*peer, size)
	for i := range peers {
		peers[i] = benchmarkPresencePeer(h, benchmarkContactID(i+1))
		watching := make(map[string]bool, len(ids))
		for _, id := range ids {
			watching[id] = true
		}
		h.replaceContactWatchLocked(peers[i], watching)
		h.refreshContactPresenceLocked(peers[i])
	}
	for _, p := range peers {
		drainPresenceQueue(p)
	}
	return h, peers, ids
}

// One connection replaces its 16 subscriptions while all unrelated subscriptions stay stable.
func BenchmarkContactPresenceSparseWatch(b *testing.B) {
	for _, size := range []int{100, 1000, 10000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			h, peers, ids := benchmarkPresenceHub(size)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if !h.watch(peers[0], ids) {
					b.Fatal("watch rejected")
				}
				drainPresenceQueue(peers[0])
			}
		})
	}
}

// Two workers contend for the hub lock, updating one account observed by exactly four peers.
func BenchmarkContactPresenceSparseStatus(b *testing.B) {
	for _, size := range []int{100, 1000, 10000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			benchmarkPresenceStatus(b, size, 4)
		})
	}
}

func BenchmarkContactPresenceFanout(b *testing.B) {
	for _, subscribers := range []int{4, 64, 512} {
		b.Run(fmt.Sprint(subscribers), func(b *testing.B) {
			benchmarkPresenceStatus(b, 10000, subscribers)
		})
	}
}

func benchmarkPresenceStatus(b *testing.B, size, subscribers int) {
	h, peers, _ := benchmarkPresenceHub(size)
	target := peers[len(peers)-1]
	for _, p := range peers[:subscribers] {
		h.watch(p, append(contactWatchIDs(p), target.user.ID))
		drainPresenceQueue(p)
	}
	var waiting, held atomic.Int64
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			start := time.Now()
			h.mu.Lock()
			acquired := time.Now()
			h.clients[target] = !h.clients[target]
			h.publishContactPresenceLocked(target.user.ID)
			for _, p := range peers[:subscribers] {
				drainPresenceQueue(p)
			}
			finished := time.Now()
			h.mu.Unlock()
			waiting.Add(acquired.Sub(start).Nanoseconds())
			held.Add(finished.Sub(acquired).Nanoseconds())
		}
	})
	b.ReportMetric(float64(waiting.Load())/float64(b.N), "wait-ns/op")
	b.ReportMetric(float64(held.Load())/float64(b.N), "locked-ns/op")
}

func contactWatchIDs(p *peer) []string {
	ids := make([]string, 0, len(p.watching))
	for id := range p.watching {
		ids = append(ids, id)
	}
	return ids
}
