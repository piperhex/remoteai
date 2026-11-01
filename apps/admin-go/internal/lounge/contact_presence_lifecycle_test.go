package lounge

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestContactPresenceExpiryRenewalAndLastDevice(t *testing.T) {
	h := newHub(nil)
	defer h.close()
	viewer := presenceTestPeer(h, uuid.NewString())
	target := presenceTestPeer(h, uuid.NewString())
	second := presenceTestPeer(h, target.user.ID)
	online, offline := true, false
	h.watch(viewer, []string{target.user.ID})
	queuedContact(t, viewer, target.user.ID, &online)
	h.mu.Lock()
	target.expires = time.Now().Add(-time.Second)
	h.scheduleContactExpiryLocked(target)
	h.mu.Unlock()
	// Another live device keeps the user online even after the expiry callback runs.
	h.remove(target)
	noQueuedPresence(t, viewer)
	h.mu.Lock()
	oldExpiry := time.Now().Add(-time.Second)
	second.expires = time.Now().Add(time.Hour)
	h.scheduleContactExpiryLocked(second)
	h.indexContactPeerLocked(second)
	h.mu.Unlock()
	// Simulate a stopped callback that had already started before renewal.
	h.expireContactPresence(second, oldExpiry)
	noQueuedPresence(t, viewer)
	h.mu.Lock()
	second.expires = time.Now().Add(time.Millisecond)
	h.scheduleContactExpiryLocked(second)
	h.mu.Unlock()
	queuedContact(t, viewer, target.user.ID, &offline)
	h.mu.Lock()
	second.expires = time.Now().Add(time.Hour)
	h.scheduleContactExpiryLocked(second)
	h.publishContactPresenceLocked(second.user.ID)
	h.mu.Unlock()
	queuedContact(t, viewer, target.user.ID, &online)
	assertContactIndexes(t, h)
	h.remove(second)
	queuedContact(t, viewer, target.user.ID, &offline)
	if second.presenceExpiry != nil {
		t.Fatal("disconnect retained expiry timer")
	}
	h.expireContactPresence(second, second.expires)
	noQueuedPresence(t, viewer)
}

func TestContactPresenceRenewalRefreshesViewerAfterReady(t *testing.T) {
	h, url := fixture(t)
	a, b := uuid.NewString(), uuid.NewString()
	viewer := directConnection(t, h, url, a)
	target := directConnection(t, h, url, b)
	write(t, viewer, incoming{Type: "watch", Watch: []string{b}})
	expectContact(t, viewer, true)
	h.mu.Lock()
	for p := range h.clientsByUser[a] {
		p.expires = time.Now().Add(-time.Second)
	}
	for p := range h.clientsByUser[b] {
		p.expires = time.Now().Add(-time.Second)
	}
	h.publishContactPresenceLocked(b) // The inactive viewer must not receive this change.
	h.mu.Unlock()
	write(t, viewer, incoming{Type: "authenticate", Ticket: credential(t, h, a, time.Now().Add(time.Minute))})
	if frame := read(t, viewer); frame["type"] != "ready" {
		t.Fatalf("renewal order: %v", frame)
	}
	expectContact(t, viewer, false)
	target.Close()
	expectPong(t, viewer)
	assertContactIndexes(t, h)
}

func TestContactPresenceConcurrentLifecycle(t *testing.T) {
	h := newHub(nil)
	defer h.close()
	h.relationships = &memoryRelationships{blocks: make(map[string]map[string]bool)}
	target := presenceTestPeer(h, uuid.NewString())
	target.queue = make(chan []byte, 4096)
	const workers, rounds = 8, 50
	var group sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		group.Go(func() {
			user := uuid.NewString()
			for round := 0; round < rounds; round++ {
				h.mu.Lock()
				p := presenceTestPeer(h, user)
				p.queue = make(chan []byte, 1024)
				h.scheduleContactExpiryLocked(p)
				h.publishContactPresenceLocked(user)
				h.mu.Unlock()
				if !h.watch(p, []string{user, target.user.ID, target.user.ID}) {
					t.Error("watch failed")
				}
				enabled := round%2 == 0
				h.block(target, incoming{ID: "block", UserID: user, Blocked: &enabled})
				if !h.watch(p, nil) || !h.watch(p, []string{target.user.ID}) {
					t.Error("replacement failed")
				}
				assertContactIndexes(t, h)
				h.remove(p)
				if h.watch(p, []string{target.user.ID}) {
					t.Error("removed peer resubscribed")
				}
			}
		})
	}
	group.Go(func() {
		for i := 0; i < workers*rounds; i++ {
			h.mu.Lock()
			target.expires = time.Now().Add(-time.Second)
			h.publishContactPresenceLocked(target.user.ID)
			target.expires = time.Now().Add(time.Hour)
			h.scheduleContactExpiryLocked(target)
			h.publishContactPresenceLocked(target.user.ID)
			h.mu.Unlock()
		}
	})
	group.Wait()
	h.remove(target)
	assertContactIndexes(t, h)
	if len(h.clientsByUser) != 0 || len(h.contactWatchers) != 0 {
		t.Fatal("lifecycle retained index entries")
	}
}
