package lounge

import (
	"encoding/json"

	"github.com/google/uuid"
)

const maxWatchedContacts = 200

type contactPresence struct {
	ID     string `json:"id"`
	Online *bool  `json:"online"`
}

// Presence subscriptions are connection-only. Blockers hide their status from blocked viewers.
func (h *hub) watch(client *peer, ids []string) bool {
	if len(ids) > maxWatchedContacts {
		return false
	}
	watching := make(map[string]bool, len(ids))
	for _, id := range ids {
		if _, err := uuid.Parse(id); err != nil {
			return false
		}
		watching[id] = true
	}
	h.mu.Lock()
	if h.closed || !h.activeLocked(client) {
		h.mu.Unlock()
		return false
	}
	user := client.user.ID
	delete(watching, user)
	h.replaceContactWatchLocked(client, watching)
	h.refreshContactPresenceLocked(client)
	h.mu.Unlock()
	h.sendDirectPermissions(user, ids)
	return true
}

func samePresence(a, b *bool) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// Only this account's devices are inspected, including expired or closing connections.
func (h *hub) contactOnlineLocked(user string) bool {
	for client := range h.clientsByUser[user] {
		if h.activeLocked(client) {
			return true
		}
	}
	return false
}

// The caller owns h.mu. Unrelated connections and their subscriptions are never visited.
func (h *hub) publishContactPresenceLocked(user string) {
	online := h.contactOnlineLocked(user)
	for client := range h.contactWatchers[user] {
		h.sendContactChangeLocked(client, user, online)
	}
}

func (h *hub) sendContactChangeLocked(client *peer, user string, online bool) {
	if !h.activeLocked(client) || !client.watching[user] {
		return
	}
	if change, changed := contactChangeLocked(client, user, online); changed {
		sendContactPresenceLocked(client, []contactPresence{change})
	}
}

func (h *hub) refreshContactPresenceLocked(client *peer) {
	if !h.activeLocked(client) {
		return
	}
	changes := []contactPresence{}
	for id := range client.watching {
		if change, changed := contactChangeLocked(client, id, h.contactOnlineLocked(id)); changed {
			changes = append(changes, change)
		}
	}
	sendContactPresenceLocked(client, changes)
}

func contactChangeLocked(client *peer, id string, online bool) (contactPresence, bool) {
	var current *bool
	if client.canContact(id) {
		current = &online
	}
	previous, known := client.presence[id]
	if known && samePresence(previous, current) {
		return contactPresence{}, false
	}
	if client.presence == nil {
		client.presence = make(map[string]*bool)
	}
	client.presence[id] = current
	return contactPresence{id, current}, true
}

// Enqueue under h.mu to preserve state-transition order; socket writes run in the writer.
func sendContactPresenceLocked(client *peer, changes []contactPresence) {
	if len(changes) == 0 {
		return
	}
	data, err := json.Marshal(struct {
		Type     string            `json:"type"`
		Contacts []contactPresence `json:"contacts"`
	}{"contacts", changes})
	if err == nil {
		client.enqueue(data)
	}
}
