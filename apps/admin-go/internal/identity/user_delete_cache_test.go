package identity

import (
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
)

func TestUserDeletionInvalidatesPortMappings(t *testing.T) {
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&user{}); err != nil {
		t.Fatal(err)
	}
	if err := store.DB.Exec(`CREATE TABLE remote_devices ("ownerId" text REFERENCES users(id) ON DELETE CASCADE,
		"deviceId" text)`).Error; err != nil {
		t.Fatal(err)
	}
	u := user{ID: uuid.NewString(), Email: "delete-mapping@example.test", Role: "user"}
	if err := store.DB.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	device := uuid.NewString()
	if err := store.DB.Exec(`INSERT INTO remote_devices VALUES (?, ?)`, u.ID, device).Error; err != nil {
		t.Fatal(err)
	}
	key := platform.PortMappingsCacheKey(u.ID, device)
	if err := store.Redis.Set(t.Context(), key, "cached generation", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	s := &service{&platform.Dependencies{DB: store.DB, Redis: store.Redis}}
	if err := s.deleteUserRecord(&u); err != nil {
		t.Fatal(err)
	}
	if store.Redis.Exists(t.Context(), key).Val() != 0 {
		t.Fatal("deleted user's mapping cache survived")
	}
}
