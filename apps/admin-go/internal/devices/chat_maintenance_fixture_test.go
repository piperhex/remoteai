package devices

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
)

func maintenanceStore(t *testing.T) testfixture.Store {
	t.Helper()
	store := testfixture.Open(t)
	statements := []string{
		"CREATE TABLE users(id uuid PRIMARY KEY)",
		"CREATE TABLE chat_settings(id text PRIMARY KEY, policy jsonb, updated_at timestamptz)",
		`CREATE TABLE chat_relay_traffic(reporter_id uuid, hour_start timestamptz, bytes bigint,
		 PRIMARY KEY(hour_start, reporter_id))`,
	}
	for _, file := range []string{"004_chat_user_traffic.sql", "005_chat_relay_budgets.sql", "009_chat_bulk_leases.sql"} {
		data, err := os.ReadFile("../migrations/" + file)
		if err != nil {
			t.Fatal(err)
		}
		statements = append(statements, string(data))
	}
	for _, statement := range statements {
		if err := store.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	return store
}

func maintenanceFixture(t *testing.T) (*ChatGateway, *peer, string) {
	t.Helper()
	store := maintenanceStore(t)
	owner, desktop := uuid.NewString(), queuedPeer()
	if err := store.DB.Exec("INSERT INTO users(id) VALUES (?)", owner).Error; err != nil {
		t.Fatal(err)
	}
	gateway := &ChatGateway{service: &Service{deps: &platform.Dependencies{DB: store.DB}},
		sessions: newChatSessions(nil), traffic: newTrafficCounter(store.DB),
		meter: chattraffic.NewMeter(store.DB, store.Redis), maintenance: newChatMaintenance(),
		connections: map[*peer]*chatConnection{desktop: {identity: &chatIdentity{
			owner: owner, device: "fixture-device", role: "desktop", expires: time.Now().Add(time.Hour)}}}}
	gateway.bulkMeter = chattraffic.NewBulkMeter(gateway.meter)
	gateway.sessions.hot.sessions["fixture-session"] = &hotSession{
		id: "fixture-session", desktop: chatEndpoint{socket: desktop}, expires: time.Now().Add(time.Hour)}
	gateway.sessions.desktopICE = func(string, time.Time) []platform.JSON {
		return []platform.JSON{{"urls": "turn:fixture.invalid:3479"}}
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		keys, err := store.Redis.Keys(ctx, "chat:budget:{"+owner+"}:*").Result()
		if err == nil && len(keys) > 0 {
			err = store.Redis.Del(ctx, keys...).Err()
		}
		if err != nil {
			t.Error(err)
		}
	})
	t.Cleanup(gateway.maintenance.stop)
	return gateway, desktop, owner
}

func awaitMaintenance(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("maintenance fixture timed out")
	}
}
