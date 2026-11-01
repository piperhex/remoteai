package lounge

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

func (p *peer) applyRelationships(value relationships) {
	p.blocks = make(map[string]bool, len(value.Blocked))
	p.blockedBy = make(map[string]bool, len(value.BlockedBy))
	for _, user := range value.Blocked {
		p.blocks[user.ID] = true
	}
	for _, id := range value.BlockedBy {
		p.blockedBy[id] = true
	}
}

func (p *peer) canContact(id string) bool { return !p.blockedBy[id] }

func (h *hub) readRelationships(user string) (relationships, error) {
	if h.relationships == nil {
		return relationships{Blocked: []account{}}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return h.relationships.Read(ctx, user)
}

// settingsMu serializes reads with writes so reconnects cannot restore a stale privacy preference.
func (h *hub) block(client *peer, input incoming) {
	if _, err := uuid.Parse(input.UserID); err != nil || input.Blocked == nil || input.UserID == client.user.ID {
		h.reject(client, input.ID, "client.lounge.actionFailed")
		return
	}
	if h.relationships == nil {
		h.reject(client, input.ID, "client.lounge.unavailable")
		return
	}
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	value, err := h.relationships.SetBlock(ctx, blockChange{client.user.ID, input.UserID, *input.Blocked})
	if err != nil {
		h.reject(client, input.ID, "client.lounge.actionFailed")
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for other := range h.clientsByUser[client.user.ID] {
		other.applyRelationships(value)
		h.sendPrivacyLocked(other, value.Blocked)
		h.refreshContactPresenceLocked(other)
	}
	online := h.contactOnlineLocked(client.user.ID)
	for other := range h.clientsByUser[input.UserID] {
		other.blockedBy[client.user.ID] = *input.Blocked
		h.sendContactChangeLocked(other, client.user.ID, online)
	}
	data, err := json.Marshal(map[string]string{"type": "updated", "id": input.ID})
	if err == nil {
		client.enqueue(data)
	}
}

func (h *hub) sendPrivacyLocked(client *peer, blocked []account) {
	data, err := json.Marshal(struct {
		Type    string    `json:"type"`
		Blocked []account `json:"blocked"`
	}{"privacy", blocked})
	if err == nil {
		client.enqueue(data)
	}
}
