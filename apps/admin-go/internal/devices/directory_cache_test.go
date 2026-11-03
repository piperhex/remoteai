package devices

import (
	"context"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
)

func TestDeviceDirectoryCachesMetadataAndKeepsPresenceLive(t *testing.T) {
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&Device{}); err != nil {
		t.Fatal(err)
	}
	s := &Service{&platform.Dependencies{DB: store.DB, Redis: store.Redis}}
	owner, id := uuid.NewString(), uuid.NewString()
	t.Cleanup(func() {
		if err := readcache.Invalidate(context.Background(), store.Redis, platform.DeviceDirectoryCacheKey(owner)); err != nil {
			t.Error(err)
		}
	})
	input := platform.JSON{"deviceId": id, "name": "first", "platform": "windows", "capabilities": []interface{}{"remote-command"}}
	created, err := s.register(owner, input)
	if err != nil {
		t.Fatal(err)
	}
	g := &ControlGateway{service: s, sockets: map[string]*peer{}}
	store.Queries.Count.Store(0)
	first, err := g.statuses(owner)
	if err != nil || len(first) != 1 {
		t.Fatal(first, err)
	}
	if first[0].OwnerID != owner || first[0].CreatedAt.Sub(created.CreatedAt).Abs() > time.Microsecond {
		t.Fatal("internal metadata lost")
	}
	first[0].Capabilities[0] = "mutated"
	g.sockets[owner+":"+id] = &peer{}
	second, err := g.statuses(owner)
	if err != nil || !second[0].Online || second[0].Capabilities[0] != "remote-command" {
		t.Fatal(second, err)
	}
	if got := store.Queries.Count.Load(); got != 1 {
		t.Fatalf("directory queries=%d, want 1", got)
	}
	input["name"] = "renamed"
	if _, err := s.register(owner, input); err != nil {
		t.Fatal(err)
	}
	third, err := g.statuses(owner)
	if err != nil || third[0].Name != "renamed" {
		t.Fatal(third, err)
	}
	if other, err := s.list(uuid.NewString()); err != nil || len(other) != 0 {
		t.Fatal("owner isolation", other, err)
	}
}
