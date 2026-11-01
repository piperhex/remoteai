package lounge

import "time"

// All indexes, subscription snapshots, and expiry timers are owned by hub.mu.
// clientsByUser contains authenticated connections; activeLocked remains the authority
// for expiry and shutdown. contactWatchers is the exact inverse of peer.watching.
func (h *hub) indexContactPeerLocked(client *peer) {
	user := client.user.ID
	if h.clientsByUser[user] == nil {
		h.clientsByUser[user] = make(map[*peer]struct{})
	}
	h.clientsByUser[user][client] = struct{}{}
}

func (h *hub) replaceContactWatchLocked(client *peer, watching map[string]bool) {
	for id := range client.watching {
		if !watching[id] {
			h.removeContactWatcherLocked(id, client)
		}
	}
	for id := range watching {
		if h.contactWatchers[id] == nil {
			h.contactWatchers[id] = make(map[*peer]struct{})
		}
		h.contactWatchers[id][client] = struct{}{}
	}
	// A replacement, even with identical IDs, requests a fresh snapshot on this connection.
	client.watching, client.presence = watching, nil
}

func (h *hub) removeContactWatcherLocked(id string, client *peer) {
	delete(h.contactWatchers[id], client)
	if len(h.contactWatchers[id]) == 0 {
		delete(h.contactWatchers, id)
	}
}

func (h *hub) unindexContactPeerLocked(client *peer) {
	if client.presenceExpiry != nil {
		client.presenceExpiry.Stop()
		client.presenceExpiry = nil
	}
	for id := range client.watching {
		h.removeContactWatcherLocked(id, client)
	}
	client.watching, client.presence = nil, nil
	user := client.user.ID
	delete(h.clientsByUser[user], client)
	if len(h.clientsByUser[user]) == 0 {
		delete(h.clientsByUser, user)
	}
}

func (h *hub) scheduleContactExpiryLocked(client *peer) {
	if client.presenceExpiry != nil {
		client.presenceExpiry.Stop()
	}
	expires := client.expires
	client.presenceExpiry = time.AfterFunc(time.Until(expires), func() {
		h.expireContactPresence(client, expires)
	})
}

func (h *hub) expireContactPresence(client *peer, expires time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Stop can race a renewal or disconnect. Never publish the old ticket's expiry.
	if h.closed || !h.clients[client] || !client.expires.Equal(expires) {
		return
	}
	h.publishContactPresenceLocked(client.user.ID)
}
