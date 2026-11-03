package identity

import (
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestPrincipalCachePreservesLiveRevocation(t *testing.T) {
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&user{}, &role{}, &rolePermission{}); err != nil {
		t.Fatal(err)
	}
	s := &service{&platform.Dependencies{DB: store.DB, Redis: store.Redis}}
	r := role{Code: uuid.NewString(), Name: "Reader"}
	if err := s.saveRole(&r, []string{"self.accounts.read"}); err != nil {
		t.Fatal(err)
	}
	u := user{ID: uuid.NewString(), Email: "cache@example.test", Role: r.Code}
	if err := store.DB.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	store.Queries.Count.Store(0)
	first, err := s.currentPrincipal(t.Context(), u.ID)
	if err != nil || len(first.Permissions) != 1 || store.Queries.Count.Load() != 2 {
		t.Fatal(first, err, store.Queries.Count.Load())
	}
	first.Permissions[0] = "mutated"
	store.Queries.Count.Store(0)
	otherRedis := redis.NewClient(store.Redis.Options())
	defer otherRedis.Close()
	if err := otherRedis.Ping(t.Context()).Err(); err != nil {
		t.Fatal(err)
	}
	other := &service{&platform.Dependencies{DB: store.DB, Redis: otherRedis}}
	warm, err := other.currentPrincipal(t.Context(), u.ID)
	if err != nil || warm.Permissions[0] != "self.accounts.read" || store.Queries.Count.Load() != 1 {
		t.Fatal("warm request did not use one live SQL check", warm, err, store.Queries.Count.Load())
	}
	if err := s.saveRole(&r, []string{}); err != nil {
		t.Fatal(err)
	}
	revoked, err := other.currentPrincipal(t.Context(), u.ID)
	if err != nil || len(revoked.Permissions) != 0 {
		t.Fatal("role revocation was cached", revoked, err)
	}
	if err := store.DB.Model(&u).Update("disabled", true).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := other.currentPrincipal(t.Context(), u.ID); err == nil {
		t.Fatal("disabled user authenticated from cache")
	}
	if err := store.DB.Model(&u).Update("disabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.DB.Delete(&r).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := other.currentPrincipal(t.Context(), u.ID); err == nil {
		t.Fatal("deleted role authenticated from cache")
	}
}
