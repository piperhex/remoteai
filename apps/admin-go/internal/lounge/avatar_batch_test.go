package lounge

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestLoungeLargeAvatarSubscriptionsFitClientFrameLimit(t *testing.T) {
	h, url := fixture(t)
	avatar := detailedAvatar(t)
	profiles := &memoryProfiles{avatars: make(map[string]string)}
	ids := make([]string, maxWatchedContacts)
	for index := range ids {
		ids[index] = uuid.NewString()
		profiles.avatars[ids[index]] = avatar
	}
	h.profiles = profiles
	client := connect(t, h, url, uuid.NewString())
	client.SetReadLimit(maxFrameBytes)
	write(t, client, incoming{Type: "profile-watch", Watch: ids})
	received := 0
	for received < len(ids) {
		_, data, err := client.ReadMessage()
		if err != nil || len(data) > maxFrameBytes {
			t.Fatal("profile response exceeded client frame limit", err)
		}
		var frame struct {
			Type     string          `json:"type"`
			Profiles []avatarProfile `json:"profiles"`
		}
		if err := json.Unmarshal(data, &frame); err != nil || frame.Type != "profiles" || len(frame.Profiles) == 0 {
			t.Fatal("invalid profile batch", err)
		}
		for _, profile := range frame.Profiles {
			if received >= len(ids) || profile.ID != ids[received] || profile.Avatar != avatar {
				t.Fatal("profile batch lost or reordered avatars")
			}
			received++
		}
	}
}
