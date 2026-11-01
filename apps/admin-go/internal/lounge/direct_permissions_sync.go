package lounge

import (
	"context"
	"encoding/json"
	"time"
)

func (h *hub) sendDirectPermissions(user string, peers []string) {
	if h.directPolicy == nil || len(peers) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	states, err := h.directPolicy.States(ctx, user, peers)
	if err != nil {
		return // Sending still fails closed in Admit; never log storage details or contact identities.
	}
	data, err := json.Marshal(struct {
		Type string `json:"type"`
		directStates
	}{"direct-permissions", states})
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clientsByUser[user] {
		if h.activeLocked(client) && client.direct {
			client.enqueue(data)
		}
	}
}
