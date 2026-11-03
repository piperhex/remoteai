package content

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/codex-switch/admin-go/internal/updatesharing"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func policyCacheFixture(t *testing.T) (testfixture.Store, *service) {
	t.Helper()
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&chatSettings{}, &updatesharing.Record{}, &auditEntry{}); err != nil {
		t.Fatal(err)
	}
	clear := func() {
		if err := readcache.Invalidate(context.Background(), store.Redis, chatPolicyCacheKey, updatesharing.CacheKey); err != nil {
			t.Fatal(err)
		}
	}
	clear()
	t.Cleanup(clear)
	return store, &service{deps: &platform.Dependencies{DB: store.DB, Redis: store.Redis}}
}

func settingsContext(t *testing.T, body interface{}) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest("PATCH", "/settings", bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("principal", &platform.Principal{ID: uuid.NewString(), Email: "cache@example.test"})
	return c, response
}

func TestChatPolicyCacheInvalidatedBeforeBroadcast(t *testing.T) {
	store, s := policyCacheFixture(t)
	store.Queries.Count.Store(0)
	for range 10 {
		value, err := CachedChatPolicy(s.deps)
		if err != nil {
			t.Fatal(err)
		}
		value["chatSessionLimit"] = float64(99)
	}
	if got := store.Queries.Count.Load(); got != 1 {
		t.Fatalf("settings queries=%d, want 1", got)
	}
	next := defaultChatPolicy()
	next["chatSessionLimit"] = float64(8)
	s.deps.ChatPolicyChanged = func() {
		value, err := CachedChatPolicy(s.deps)
		if err != nil || value["chatSessionLimit"] != float64(8) {
			t.Error("broadcast saw stale policy", value, err)
		}
	}
	c, response := settingsContext(t, next)
	s.updateChatPolicy(c)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	store.Queries.Count.Store(0)
	value, err := CachedChatPolicy(s.deps)
	if err != nil || value["chatSessionLimit"] != float64(8) || store.Queries.Count.Load() != 0 {
		t.Fatal(value, err)
	}
}

func TestSharingPolicyCacheInvalidatedBySettingsWrite(t *testing.T) {
	store, s := policyCacheFixture(t)
	store.Queries.Count.Store(0)
	for range 10 {
		if _, err := updatesharing.ReadCached(s.deps); err != nil {
			t.Fatal(err)
		}
	}
	if got := store.Queries.Count.Load(); got != 1 {
		t.Fatalf("sharing queries=%d, want 1", got)
	}
	next := updatesharing.Settings{Scope: updatesharing.Off, PrepareAndroid: true}
	c, response := settingsContext(t, next)
	s.saveUpdateSharing(c)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	value, err := updatesharing.ReadCached(s.deps)
	if err != nil || value != next {
		t.Fatal("sharing update stayed cached", value, err)
	}
}
