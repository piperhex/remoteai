package lounge

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

const sha256HexLength = sha256.Size * 2

// Retained subscriptions already received queued updates on this ordered connection.
// A new watch can race that delivery and still advertise an older on-disk version.
func watchAvatarVersions(client *peer, input incoming) {
	versions := make(map[string]string, len(input.Watch))
	for _, id := range input.Watch {
		version := input.AvatarVersions[id]
		if sent, exists := client.avatarVersions[id]; exists && client.profileWatch[id] {
			version = sent
		}
		if len(version) == sha256HexLength {
			versions[id] = version
		}
	}
	client.avatarVersions = versions
}

// Versions describe the canonical bitmap, including an explicit reset to no avatar.
func avatarVersion(avatar string) string {
	digest := sha256.Sum256([]byte(avatar))
	return hex.EncodeToString(digest[:])
}

type cachedAvatarProfile struct {
	ID      string `json:"id"`
	Avatar  string `json:"avatar"`
	Version string `json:"version,omitempty"`
}

// Called with hub.mu held. Only versions for the bounded subscription are retained.
func profileUpdates(client *peer, profiles []avatarProfile) []cachedAvatarProfile {
	updates := make([]cachedAvatarProfile, 0, len(profiles))
	for _, profile := range profiles {
		version := ""
		if client.avatarCache {
			version = avatarVersion(profile.Avatar)
			if client.avatarVersions[profile.ID] == version {
				continue
			}
			if client.avatarVersions == nil {
				client.avatarVersions = make(map[string]string)
			}
			client.avatarVersions[profile.ID] = version
		}
		updates = append(updates, cachedAvatarProfile{profile.ID, profile.Avatar, version})
	}
	return updates
}

func withoutAvatar(user account) account {
	user.Avatar = ""
	return user
}

type messageFrames struct{ legacy, cached []byte }

// Encode once per audience format, so fan-out does not re-encode images for each recipient.
func encodeMessage(value message) (messageFrames, error) {
	legacy, err := json.Marshal(value)
	if err != nil {
		return messageFrames{}, err
	}
	value.Sender = withoutAvatar(value.Sender)
	if value.Recipient != nil {
		recipient := withoutAvatar(*value.Recipient)
		value.Recipient = &recipient
	}
	cached, err := json.Marshal(value)
	return messageFrames{legacy: legacy, cached: cached}, err
}

func (frames messageFrames) forPeer(client *peer) []byte {
	if client.avatarCache {
		return frames.cached
	}
	return frames.legacy
}
