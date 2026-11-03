package accounts

import (
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
)

func TestAccountReadViewsShareCacheWithoutLeakingProjectionChanges(t *testing.T) {
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&account{}, &systemAccount{}, &binding{}); err != nil {
		t.Fatal(err)
	}
	s := &service{deps: &platform.Dependencies{DB: store.DB, Redis: store.Redis}}
	owner, id := uuid.NewString(), uuid.NewString()
	t.Cleanup(func() {
		if err := s.invalidate(owner, false); err != nil {
			t.Error(err)
		}
	})
	row := account{ID: uuid.NewString(), OwnerID: owner, AccountID: id, Email: "fixture@example.test",
		Note: "before", LastModifiedAt: time.Now(), Auth: object{"tokens": object{"access_token": "test-only"}},
		PrivateDetails: object{"alias": "private"}}
	if err := store.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	store.Queries.Count.Store(0)
	web, err := s.summary(owner, false, true)
	if err != nil {
		t.Fatal(err)
	}
	webAccount := web.(object)["accounts"].([]object)[0]
	if has(webAccount, "auth") || has(webAccount, "privateDetails") {
		t.Fatal("web projection exposed private data")
	}
	list, err := s.list(owner, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if !has(list.(object)["accounts"].([]object)[0], "auth") {
		t.Fatal("web projection mutated cached credentials")
	}
	details, err := s.details(owner, id)
	if err != nil || !has(details.(object), "privateDetails") {
		t.Fatal(details, err)
	}
	if got := store.Queries.Count.Load(); got != 2 {
		t.Fatalf("all views issued %d SQL queries, want 2 total", got)
	}
	if _, err := s.updateAdmin(owner, id, object{"note": "after"}, true); err != nil {
		t.Fatal(err)
	}
	updated, err := s.details(owner, id)
	if err != nil || updated.(object)["note"] != "after" {
		t.Fatal("write did not invalidate", updated, err)
	}
	if _, err := s.details(uuid.NewString(), id); err == nil {
		t.Fatal("account cache crossed owners")
	}
	if _, err := s.deleteAccount(owner, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.details(owner, id); err == nil {
		t.Fatal("deleted account remained cached")
	}
}
