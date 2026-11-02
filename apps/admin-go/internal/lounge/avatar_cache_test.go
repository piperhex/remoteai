package lounge

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func cachedConnection(t *testing.T, h *hub, url, user string) *websocket.Conn {
	t.Helper()
	client := connect(t, h, url, "")
	write(t, client, incoming{Type: "authenticate", Ticket: credential(t, h, user, time.Now().Add(time.Minute)),
		AvatarCache: true, Direct: true, Receipts: true})
	frame := read(t, client)
	if frame["avatarCache"] != true || frame["user"].(map[string]interface{})["avatar"] != nil {
		t.Fatal("cached handshake must defer avatars to versioned profile synchronization")
	}
	return client
}

func TestAvatarCacheSynchronizesOnlyMissingOrChangedProfiles(t *testing.T) {
	h, url := fixture(t)
	a, b := uuid.NewString(), uuid.NewString()
	avatar := avatarPicture(t, avatarSize)
	h.profiles = &memoryProfiles{avatars: map[string]string{a: avatar}}
	alice, bob := cachedConnection(t, h, url, a), cachedConnection(t, h, url, b)
	watch := incoming{Type: "profile-watch", Watch: []string{a}}
	write(t, bob, watch)
	assertProfile(t, bob, avatarProfile{ID: a, Avatar: avatar})
	// The next watch may have been sent before the first profile arrived.
	write(t, bob, watch)
	expectPong(t, bob)
	watch.AvatarVersions = map[string]string{a: avatarVersion(avatar)}
	write(t, bob, watch)
	expectPong(t, bob)
	// Saving identical content acknowledges success without retransmitting the picture to subscribers.
	write(t, alice, incoming{Type: "avatar", ID: "same", Avatar: avatar})
	assertProfile(t, alice, avatarProfile{ID: a, Avatar: avatar})
	if read(t, alice)["type"] != "updated" {
		t.Fatal("unchanged save was not acknowledged")
	}
	expectPong(t, bob)
	write(t, alice, incoming{Type: "avatar", ID: "reset"})
	assertProfile(t, alice, avatarProfile{ID: a})
	assertProfile(t, bob, avatarProfile{ID: a})
	read(t, alice)
	// A persisted reset is a cache hit after reconnect; an old bitmap is repaired.
	reconnected := cachedConnection(t, h, url, b)
	watch.AvatarVersions[a] = avatarVersion("")
	write(t, reconnected, watch)
	expectPong(t, reconnected)
	watch.AvatarVersions[a] = avatarVersion(avatar)
	stale := cachedConnection(t, h, url, b)
	write(t, stale, watch)
	assertProfile(t, stale, avatarProfile{ID: a})
	// Dropped subscriptions can be re-added when a local cache has been evicted.
	write(t, reconnected, incoming{Type: "profile-watch"})
	watch.AvatarVersions = nil
	write(t, reconnected, watch)
	assertProfile(t, reconnected, avatarProfile{ID: a})
}

func TestAvatarCacheMessagesOmitPicturesForModernClients(t *testing.T) {
	h, url := fixture(t)
	a, b := uuid.NewString(), uuid.NewString()
	avatar := avatarPicture(t, avatarSize)
	h.profiles = &memoryProfiles{avatars: map[string]string{a: avatar}}
	h.relationships = &memoryRelationships{blocks: make(map[string]map[string]bool)}
	alice, bob := cachedConnection(t, h, url, a), cachedConnection(t, h, url, b)
	legacy := directConnection(t, h, url, b)
	for _, target := range []string{"", b} {
		for _, id := range []string{"first", "repeated"} {
			write(t, alice, incoming{Type: "message", ID: id, Text: "cached-avatar-message", To: target})
			for _, client := range []*websocket.Conn{alice, bob, legacy} {
				frame := read(t, client)
				if frame["type"] != "message" || frame["text"] != "cached-avatar-message" {
					t.Fatal("message content was not delivered")
				}
				got := frame["sender"].(map[string]interface{})["avatar"]
				if client == legacy && got != avatar || client != legacy && got != nil {
					t.Fatal("avatar payload does not match negotiated capability")
				}
			}
		}
	}
}

func TestAvatarCacheProfileSubscriptionsStayBounded(t *testing.T) {
	h, url := fixture(t)
	h.profiles = &memoryProfiles{avatars: map[string]string{}}
	client := cachedConnection(t, h, url, uuid.NewString())
	versions := make(map[string]string)
	for i := 0; i <= maxWatchedContacts; i++ {
		versions[uuid.NewString()] = avatarVersion("")
	}
	write(t, client, incoming{Type: "profile-watch", AvatarVersions: versions})
	client.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := client.ReadMessage(); err == nil {
		t.Fatal("unbounded avatar cache advertisement accepted")
	}
}
