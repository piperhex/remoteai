package lounge

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

func (h *hub) readProfiles(ids []string) ([]avatarProfile, error) {
	if h.profiles == nil {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return h.profiles.Read(ctx, ids)
}

func sendProfiles(client *peer, profiles []avatarProfile) {
	// Keep even maximum-size avatars below the client's 6 MiB frame limit.
	const profilesPerFrame = 32
	for len(profiles) > profilesPerFrame {
		sendProfileBatch(client, profiles[:profilesPerFrame])
		profiles = profiles[profilesPerFrame:]
	}
	sendProfileBatch(client, profiles)
}

func sendProfileBatch(client *peer, profiles []avatarProfile) {
	data, err := json.Marshal(struct {
		Type     string          `json:"type"`
		Profiles []avatarProfile `json:"profiles"`
	}{"profiles", profiles})
	if err == nil {
		client.enqueue(data)
	}
}

// Subscriptions live only on the connection and do not expose presence or an account directory.
func (h *hub) watchProfiles(client *peer, ids []string) bool {
	if h.profiles == nil || len(ids) > maxWatchedContacts {
		return false
	}
	watching := make(map[string]bool, len(ids))
	for _, id := range ids {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed.String() != id {
			return false
		}
		watching[id] = true
	}
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	profiles, err := h.readProfiles(ids)
	if err != nil {
		return false
	}
	names, err := h.watchedNames(client, ids)
	if err != nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	client.profileWatch = watching
	sendProfiles(client, profiles)
	if h.names != nil {
		sendNames(client, names)
	}
	return true
}

func (h *hub) saveAvatar(client *peer, input incoming) {
	avatar, err := canonicalAvatar(input.Avatar)
	if err != nil || h.profiles == nil {
		h.reject(client, input.ID, "client.lounge.avatarSaveFailed")
		return
	}
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	profile := avatarProfile{ID: client.user.ID, Avatar: avatar}
	if h.profiles.Save(ctx, profile) != nil {
		h.reject(client, input.ID, "client.lounge.avatarSaveFailed")
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for subscriber := range h.clients {
		if !h.activeLocked(subscriber) {
			continue
		}
		own := subscriber.user.ID == profile.ID
		if own {
			subscriber.user.Avatar = avatar
		}
		if own || subscriber.profileWatch[profile.ID] {
			sendProfiles(subscriber, []avatarProfile{profile})
		}
	}
	data, err := json.Marshal(map[string]string{"type": "updated", "id": input.ID})
	if err == nil {
		client.enqueue(data)
	}
}
