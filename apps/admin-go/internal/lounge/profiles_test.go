package lounge

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type memoryProfiles struct {
	avatars map[string]string
	fail    bool
}

func (m *memoryProfiles) Read(_ context.Context, ids []string) ([]avatarProfile, error) {
	result := []avatarProfile{}
	for _, id := range ids {
		result = append(result, avatarProfile{ID: id, Avatar: m.avatars[id]})
	}
	return result, nil
}

func (m *memoryProfiles) Save(_ context.Context, profile avatarProfile) error {
	if m.fail {
		return errors.New("database unavailable")
	}
	m.avatars[profile.ID] = profile.Avatar
	return nil
}

func assertProfile(t *testing.T, conn *websocket.Conn, expected avatarProfile) {
	t.Helper()
	frame := read(t, conn)
	profiles, ok := frame["profiles"].([]interface{})
	if frame["type"] != "profiles" || !ok || len(profiles) != 1 {
		t.Fatal("expected one profile update")
	}
	profile := profiles[0].(map[string]interface{})
	if profile["id"] != expected.ID || profile["avatar"] != expected.Avatar {
		t.Fatal("incorrect synchronized avatar")
	}
}

func TestLoungeProfilesSyncDevicesAndSubscribers(t *testing.T) {
	h, url := fixture(t)
	h.profiles = &memoryProfiles{avatars: make(map[string]string)}
	a, b := uuid.NewString(), uuid.NewString()
	alice, second, bob := connect(t, h, url, a), connect(t, h, url, a), connect(t, h, url, b)
	stranger := connect(t, h, url, uuid.NewString())
	write(t, bob, incoming{Type: "profile-watch", Watch: []string{a}})
	assertProfile(t, bob, avatarProfile{ID: a})
	avatar := avatarPicture(t, avatarSize)
	// The request cannot select another account, and updating a profile does not send a chat message.
	write(t, alice, incoming{Type: "avatar", ID: "save", Avatar: avatar, UserID: b, Text: "private-marker"})
	for _, client := range []*websocket.Conn{alice, second, bob} {
		assertProfile(t, client, avatarProfile{ID: a, Avatar: avatar})
	}
	if frame := read(t, alice); frame["type"] != "updated" || frame["id"] != "save" {
		t.Fatal("save was not acknowledged")
	}
	write(t, stranger, incoming{Type: "ping"})
	if read(t, stranger)["type"] != "pong" {
		t.Fatal("profile leaked to an unsubscribed connection")
	}
	write(t, second, incoming{Type: "message", ID: "stale", Text: "hello"})
	for _, client := range []*websocket.Conn{alice, second, bob, stranger} {
		if read(t, client)["sender"].(map[string]interface{})["avatar"] != avatar {
			t.Fatal("message used a stale device avatar")
		}
	}
	write(t, second, incoming{Type: "avatar", ID: "reset"})
	for _, client := range []*websocket.Conn{alice, second, bob} {
		assertProfile(t, client, avatarProfile{ID: a})
	}
	read(t, second)
	assertReadyAvatar(t, h, url, avatarProfile{ID: a})
	assertReadyAvatar(t, h, url, avatarProfile{ID: b})
}

func assertReadyAvatar(t *testing.T, h *hub, url string, expected avatarProfile) {
	t.Helper()
	conn := connect(t, h, url, "")
	write(t, conn, incoming{Type: "authenticate", Ticket: credential(t, h, expected.ID, time.Now().Add(time.Minute))})
	frame := read(t, conn)
	profile, ok := frame["user"].(map[string]interface{})
	if frame["type"] != "ready" || frame["profiles"] != true || !ok {
		t.Fatal("profile capability missing from ready")
	}
	actual, _ := profile["avatar"].(string)
	if actual != expected.Avatar {
		t.Fatal("reconnect did not load the server avatar")
	}
}

func TestLoungeProfilesRejectInvalidAndFailedSaves(t *testing.T) {
	h, url := fixture(t)
	h.profiles = &memoryProfiles{avatars: make(map[string]string), fail: true}
	alice := connect(t, h, url, uuid.NewString())
	for _, avatar := range []string{"https://tracking.test/avatar", avatarPicture(t, 129), avatarPicture(t, avatarSize)} {
		write(t, alice, incoming{Type: "avatar", ID: "invalid", Avatar: avatar})
		frame := read(t, alice)
		if frame["type"] != "rejected" || frame["code"] != "client.lounge.avatarSaveFailed" {
			t.Fatal("profile failure must be rejected without internal details")
		}
	}
	unauthenticated := connect(t, h, url, "")
	write(t, unauthenticated, incoming{Type: "avatar", ID: "unauthorized"})
	unauthenticated.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := unauthenticated.ReadMessage(); err == nil {
		t.Fatal("unauthenticated avatar update accepted")
	}
}

func TestLoungeProfilesPersistAcrossRestartWithoutChatContent(t *testing.T) {
	db := concurrentPolicyDB(t)
	embedded, err := os.ReadFile("../migrations/022_lounge_profiles.sql")
	if err != nil {
		t.Fatal(err)
	}
	upgrade, err := os.ReadFile("../../sql/20261028-lounge-profiles.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(string(upgrade), "BEGIN;", ""), "COMMIT;", ""))
	if schema != strings.TrimSpace(string(embedded)) {
		t.Fatal("profile upgrade differs from bootstrap")
	}
	for range 2 {
		if err := db.Exec(schema).Error; err != nil {
			t.Fatal(err)
		}
	}
	user := policyUser(t, db)
	avatar := avatarPicture(t, avatarSize)
	h, url := fixture(t)
	h.profiles = postgresProfiles{db: db}
	client := connect(t, h, url, user)
	write(t, client, incoming{Type: "avatar", ID: "private-request-id", Avatar: avatar, Text: "private-content"})
	assertProfile(t, client, avatarProfile{ID: user, Avatar: avatar})
	read(t, client)
	h.close()
	fresh, freshURL := fixture(t)
	fresh.profiles = postgresProfiles{db: db}
	assertReadyAvatar(t, fresh, freshURL, avatarProfile{ID: user, Avatar: avatar})
	var columns []string
	if err := db.Raw(`SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'lounge_profiles' ORDER BY column_name`).
		Scan(&columns).Error; err != nil || strings.Join(columns, ",") != "avatar,user_id" {
		t.Fatal("unexpected retained profile data", err)
	}
	if err := (postgresProfiles{db: db}).Save(context.Background(), avatarProfile{ID: user}); err != nil {
		t.Fatal(err)
	}
	assertReadyAvatar(t, fresh, freshURL, avatarProfile{ID: user})
}
