package lounge

import (
	"encoding/json"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

// Counts accounts, not devices, and never writes presence information outside process memory.
// The caller owns h.mu.
func (h *hub) onlineLocked() int {
	users := make(map[string]struct{})
	for client, authenticated := range h.clients {
		if !authenticated || !client.expires.After(time.Now()) {
			continue
		}
		select {
		case <-client.done:
			continue
		default:
			users[client.user.ID] = struct{}{}
		}
	}
	return len(users)
}

func (h *hub) onlineForLocked(moderator bool) *int {
	if !moderator {
		return nil
	}
	count := h.onlineLocked()
	return &count
}

// The caller owns h.mu. New peers already receive the current count in their ready frame.
func (h *hub) publishPresenceLocked(exclude *peer) {
	count := h.onlineLocked()
	if count == h.presenceCount {
		return
	}
	h.presenceCount = count
	data, err := json.Marshal(struct {
		Type  string `json:"type"`
		Count int    `json:"onlineCount"`
	}{"presence", count})
	if err != nil {
		return
	}
	for client, authenticated := range h.clients {
		if client != exclude && authenticated && client.moderator && client.expires.After(time.Now()) {
			client.enqueue(data)
		}
	}
}

func (h *hub) remove(client *peer) {
	client.close()
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, client)
	h.unindexContactPeerLocked(client)
	h.publishPresenceLocked(nil)
	h.publishContactPresenceLocked(client.user.ID)
}

func (h *hub) registerPresence(group *gin.RouterGroup, deps *platform.Dependencies) {
	group.GET("/presence", deps.RequirePermissions("admin.users.read"), func(c *gin.Context) {
		h.mu.Lock()
		count := h.onlineLocked()
		h.mu.Unlock()
		c.Header("Cache-Control", "no-store")
		c.JSON(200, gin.H{"onlineCount": count})
	})
}
