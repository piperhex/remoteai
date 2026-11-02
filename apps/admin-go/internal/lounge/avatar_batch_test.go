package lounge

import (
	"encoding/json"
	"strings"
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

func TestProfileSnapshotFitsQueueBeforeWriterStarts(t *testing.T) {
	actual := detailedAvatar(t)
	// Also cover the declared storage bound independently of PNG compression.
	maximum := "data:image/png;base64," + strings.Repeat("A", (maxAvatarBytes+2)/3*4)
	cases := []struct {
		name, avatar string
		cache        bool
	}{
		{"legacy", actual, false}, {"cached", actual, true},
		{"legacy-storage-bound", maximum, false}, {"cached-storage-bound", maximum, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := &peer{queue: make(chan []byte, 32), done: make(chan struct{}), avatarCache: tc.cache}
			profiles := make([]avatarProfile, maxWatchedContacts)
			for index := range profiles {
				profiles[index] = avatarProfile{ID: uuid.NewString(), Avatar: tc.avatar}
			}
			sendProfiles(client, profiles)
			select {
			case <-client.done:
				t.Fatal("one legal profile snapshot overflowed the queue before its writer could run")
			default:
			}
			assertQueuedProfileSnapshot(t, client, profiles)
		})
	}
}

func assertQueuedProfileSnapshot(t *testing.T, client *peer, profiles []avatarProfile) {
	t.Helper()
	received := 0
	for len(client.queue) > 0 {
		data := <-client.queue
		if len(data) > maxFrameBytes {
			t.Fatal("profile batch exceeded the client frame limit")
		}
		var frame struct {
			Profiles []avatarProfile `json:"profiles"`
		}
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		for _, profile := range frame.Profiles {
			if received >= len(profiles) || profile != profiles[received] {
				t.Fatal("profile snapshot lost or reordered avatars")
			}
			received++
		}
	}
	if received != len(profiles) {
		t.Fatalf("received %d of %d profiles", received, len(profiles))
	}
}
