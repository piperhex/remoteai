package lounge

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func presenceTestPeer(h *hub, id string) *peer {
	p := benchmarkPresencePeer(h, id)
	p.applyRelationships(relationships{})
	return p
}

func queuedContact(t *testing.T, p *peer, id string, online *bool) {
	t.Helper()
	select {
	case data := <-p.queue:
		var frame struct {
			Type     string            `json:"type"`
			Contacts []contactPresence `json:"contacts"`
		}
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type != "contacts" || len(frame.Contacts) != 1 ||
			frame.Contacts[0].ID != id || !samePresence(frame.Contacts[0].Online, online) {
			t.Fatalf("unexpected contact frame: %s", data)
		}
		p.mu.Lock()
		p.queued -= len(data)
		p.mu.Unlock()
	case <-time.After(2 * time.Second):
		t.Fatal("missing contact frame")
	}
}

func noQueuedPresence(t *testing.T, p *peer) {
	t.Helper()
	select {
	case frame := <-p.queue:
		t.Fatalf("unexpected frame: %s", frame)
	default:
	}
}

func assertContactIndexes(t *testing.T, h *hub) {
	t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	for p, authenticated := range h.clients {
		_, indexed := h.clientsByUser[p.user.ID][p]
		if indexed != authenticated {
			t.Fatal("account index differs from authenticated connections")
		}
		for id := range p.watching {
			if _, ok := h.contactWatchers[id][p]; !ok || !authenticated {
				t.Fatal("subscription missing from reverse index")
			}
		}
		for id := range p.presence {
			if !p.watching[id] {
				t.Fatal("unsubscribed snapshot retained")
			}
		}
	}
	for user, peers := range h.clientsByUser {
		if len(peers) == 0 {
			t.Fatal("empty account index entry")
		}
		for p := range peers {
			if !h.clients[p] || p.user.ID != user {
				t.Fatal("stale account index entry")
			}
		}
	}
	for id, peers := range h.contactWatchers {
		if len(peers) == 0 {
			t.Fatal("empty subscription index entry")
		}
		for p := range peers {
			if !h.clients[p] || !p.watching[id] || id == p.user.ID {
				t.Fatal("stale reverse index entry")
			}
		}
	}
}

func TestContactWatchReplacementValidationAndCleanup(t *testing.T) {
	h := newHub(nil)
	a, b, c := uuid.NewString(), uuid.NewString(), uuid.NewString()
	viewer, second := presenceTestPeer(h, a), presenceTestPeer(h, a)
	presenceTestPeer(h, b)
	online, offline := true, false
	if !h.watch(viewer, []string{a, b, b}) {
		t.Fatal("watch rejected")
	}
	queuedContact(t, viewer, b, &online)
	noQueuedPresence(t, second)
	assertContactIndexes(t, h)
	if h.watch(viewer, []string{c, "bad-id"}) || h.watch(viewer, make([]string, maxWatchedContacts+1)) {
		t.Fatal("invalid replacement accepted")
	}
	if !viewer.watching[b] || len(viewer.watching) != 1 {
		t.Fatal("invalid watch mutated subscription")
	}
	if !h.watch(viewer, []string{b}) {
		t.Fatal("identical watch rejected")
	}
	queuedContact(t, viewer, b, &online)
	if !h.watch(viewer, []string{c}) {
		t.Fatal("replacement rejected")
	}
	queuedContact(t, viewer, c, &offline)
	if len(h.contactWatchers[b]) != 0 {
		t.Fatal("old subscription retained")
	}
	if !h.watch(viewer, nil) {
		t.Fatal("unsubscribe rejected")
	}
	noQueuedPresence(t, viewer)
	if len(h.contactWatchers) != 0 || len(viewer.presence) != 0 {
		t.Fatal("unsubscribe retained state")
	}
	h.watch(viewer, []string{b})
	queuedContact(t, viewer, b, &online)
	h.remove(viewer)
	h.remove(viewer) // Cleanup must be idempotent and leave the other device indexed.
	if h.watch(viewer, []string{c}) {
		t.Fatal("closed peer resubscribed")
	}
	assertContactIndexes(t, h)
	if len(h.clientsByUser[a]) != 1 || len(h.contactWatchers) != 0 {
		t.Fatal("disconnect cleanup failed")
	}
}

func TestContactPresenceRejectsInactiveViewersAndTargets(t *testing.T) {
	for _, state := range []string{"unauthorized", "expired", "closed"} {
		t.Run(state, func(t *testing.T) {
			h := newHub(nil)
			viewer := presenceTestPeer(h, uuid.NewString())
			target := presenceTestPeer(h, uuid.NewString())
			switch state {
			case "unauthorized":
				h.clients[target] = false
				h.unindexContactPeerLocked(target)
			case "expired":
				target.expires = time.Now().Add(-time.Second)
			case "closed":
				target.close()
			}
			if !h.watch(viewer, []string{target.user.ID}) {
				t.Fatal("watch rejected")
			}
			offline := false
			queuedContact(t, viewer, target.user.ID, &offline)
			if h.watch(target, []string{viewer.user.ID}) {
				t.Fatal("inactive viewer subscribed")
			}
			assertContactIndexes(t, h)
		})
	}
}

func TestContactPresenceOrderedSparseTransitions(t *testing.T) {
	h := newHub(nil)
	viewer, target := presenceTestPeer(h, uuid.NewString()), presenceTestPeer(h, uuid.NewString())
	online, offline := true, false
	h.watch(viewer, []string{target.user.ID})
	queuedContact(t, viewer, target.user.ID, &online)
	h.mu.Lock()
	viewer.blockedBy[target.user.ID] = true
	h.publishContactPresenceLocked(target.user.ID)
	target.expires = time.Now().Add(-time.Second)
	h.publishContactPresenceLocked(target.user.ID) // Hidden online/offline changes remain silent.
	viewer.blockedBy[target.user.ID] = false
	h.publishContactPresenceLocked(target.user.ID)
	target.expires = time.Now().Add(time.Hour)
	h.publishContactPresenceLocked(target.user.ID)
	h.publishContactPresenceLocked(target.user.ID) // No duplicate event.
	h.mu.Unlock()
	queuedContact(t, viewer, target.user.ID, nil)
	queuedContact(t, viewer, target.user.ID, &offline)
	queuedContact(t, viewer, target.user.ID, &online)
	noQueuedPresence(t, viewer)
}

func TestContactPresenceReconnectDoesNotRestoreSubscriptions(t *testing.T) {
	h, url := fixture(t)
	a, b := uuid.NewString(), uuid.NewString()
	viewer := directConnection(t, h, url, a)
	target := directConnection(t, h, url, b)
	write(t, viewer, incoming{Type: "watch", Watch: []string{b}})
	expectContact(t, viewer, true)
	viewer.Close()
	waitContactPeers(t, h, a, 0)
	reconnected := directConnection(t, h, url, a)
	target.Close()
	waitContactPeers(t, h, b, 0)
	expectPong(t, reconnected)
	write(t, reconnected, incoming{Type: "watch", Watch: []string{b}})
	expectContact(t, reconnected, false)
	assertContactIndexes(t, h)
}

func waitContactPeers(t *testing.T, h *hub, user string, count int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		h.mu.Lock()
		actual := len(h.clientsByUser[user])
		h.mu.Unlock()
		if actual == count {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("connection lifecycle did not finish")
}
