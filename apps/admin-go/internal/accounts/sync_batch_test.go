package accounts

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
)

func batchFixture(t *testing.T) (*service, testfixture.Store, string) {
	t.Helper()
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&account{}, &provider{}, &systemAccount{}, &binding{}); err != nil {
		t.Fatal(err)
	}
	owner := uuid.NewString()
	s := &service{deps: &platform.Dependencies{DB: store.DB, Redis: store.Redis}}
	t.Cleanup(func() {
		for _, providers := range []bool{false, true} {
			if err := s.invalidate(owner, providers); err != nil {
				t.Error(err)
			}
		}
	})
	return s, store, owner
}

func batchRecords(count int) []object {
	rows := make([]object, count)
	for i := range rows {
		rows[i] = object{"id": fmt.Sprintf("fixture-%d", i), "email": "fixture@example.test",
			"name": "provider", "note": "original", "auth": object{}, "active": false,
			"lastModifiedAt": testOld}
	}
	return rows
}

func TestSyncBatchSQLCountsAndUnchangedCaches(t *testing.T) {
	s, store, owner := batchFixture(t)
	rows := batchRecords(120)
	options := writeOptions{Owner: owner}
	store.Queries.Count.Store(0)
	if _, err := s.upsertAccounts(options, rows); err != nil {
		t.Fatal(err)
	}
	if count := store.Queries.Count.Load(); count != 122 {
		t.Fatalf("120 new accounts used %d statements; want 2 SELECT + 120 INSERT", count)
	}
	store.Queries.Count.Store(0)
	if _, err := s.upsertProviders(owner, rows); err != nil {
		t.Fatal(err)
	}
	if count := store.Queries.Count.Load(); count != 121 {
		t.Fatalf("120 new providers used %d statements; want 1 SELECT + 120 INSERT", count)
	}
	t.Log("120 new accounts: 2 SELECT + 120 INSERT; 120 new providers: 1 SELECT + 120 INSERT")
	if _, err := s.list(owner, "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.providers(owner); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		store.Queries.Count.Store(0)
		if _, err := s.upsertAccounts(options, rows); err != nil {
			t.Fatal(err)
		}
		if count := store.Queries.Count.Load(); count != 2 {
			t.Fatalf("120 unchanged accounts used %d SQL statements; want 2 reads", count)
		}
		store.Queries.Count.Store(0)
		if _, err := s.upsertProviders(owner, rows); err != nil {
			t.Fatal(err)
		}
		if count := store.Queries.Count.Load(); count != 1 {
			t.Fatalf("120 unchanged providers used %d SQL statements; want 1 read", count)
		}
		store.Queries.Count.Store(0)
		if _, err := s.list(owner, "", false); err != nil {
			t.Fatal(err)
		}
		if _, err := s.providers(owner); err != nil {
			t.Fatal(err)
		}
		if count := store.Queries.Count.Load(); count != 0 {
			t.Fatalf("unchanged upload evicted read cache: %d SQL statements", count)
		}
	}
	t.Log("120 unchanged accounts: 2 SELECT, 0 writes; 120 providers: 1 SELECT, 0 writes; cached reads: 0 SQL")
	rows[0]["note"] = "updated"
	rows[0]["fieldModifiedAt"] = object{"note": testNew}
	if _, err := s.upsertAccounts(options, rows); err != nil {
		t.Fatal(err)
	}
	details, err := s.details(owner, "fixture-0")
	if err != nil || details.(object)["note"] != "updated" {
		t.Fatal(details, err)
	}
	if _, err := s.details(uuid.NewString(), "fixture-0"); err == nil {
		t.Fatal("owner scope lost")
	}
}

func TestSyncBatchRollbackRetryDeletionAndDuplicateIDs(t *testing.T) {
	s, store, owner := batchFixture(t)
	rows := batchRecords(2)
	if _, err := s.upsertProviders(owner, rows); err != nil {
		t.Fatal(err)
	}
	rows[0]["name"] = "changed"
	rows[0]["fieldModifiedAt"] = object{"name": testNew}
	rows[1]["requestOptions"] = "invalid"
	if _, err := s.upsertProviders(owner, rows); err == nil {
		t.Fatal("expected invalid options")
	}
	stored := provider{}
	if err := store.DB.Where(`"ownerId" = ? AND "providerId" = ?`, owner, "fixture-0").First(&stored).Error; err != nil || stored.Name != "provider" {
		t.Fatal("partial batch was not rolled back", stored.Name, err)
	}
	delete(rows[1], "requestOptions")
	if _, err := s.upsertProviders(owner, rows); err != nil {
		t.Fatal(err)
	}
	if _, err := s.deleteProvider(owner, "fixture-0"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.upsertProviders(owner, rows); err != nil {
		t.Fatal(err)
	}
	deleted, err := s.deleted(owner, true)
	if err != nil || len(deleted.(object)["providers"].([]object)) != 1 {
		t.Fatal(deleted, err)
	}
	if _, err := s.restore(owner, "fixture-0", true); err != nil {
		t.Fatal(err)
	}
	older := copyObject(rows[0])
	older["name"] = "stale"
	older["fieldModifiedAt"] = object{"name": testOld}
	if _, err := s.upsertProviders(owner, []object{rows[0], older}); err != nil {
		t.Fatal(err)
	}
	got, err := s.providers(owner)
	if err != nil || got["providers"].([]object)[0]["name"] != "changed" {
		t.Fatal(got, err)
	}
}

func TestSyncBatchOfficialMetadataPrivateDetailsAndTombstones(t *testing.T) {
	s, store, owner := batchFixture(t)
	system := systemAccount{ID: uuid.NewString(), SyncAccountID: "official", Note: "managed",
		LastModifiedAt: date(testOld), Auth: object{}}
	if err := store.DB.Create(&system).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.DB.Create(&binding{SystemAccountID: system.ID, UserID: owner}).Error; err != nil {
		t.Fatal(err)
	}
	in := object{"id": "official", "note": "unauthorized", "expiresAt": "", "lastModifiedAt": testOld,
		"privateDetails": object{"alias": "mine", "password": "fixture-only"}}
	options := writeOptions{Owner: owner, RejectMetadata: true}
	if _, err := s.upsertAccounts(options, []object{in}); err == nil {
		t.Fatal("metadata permission bypass")
	}
	options.RejectMetadata = false // Existing bulk contract ignores protected metadata.
	if _, err := s.upsertAccounts(options, []object{in}); err != nil {
		t.Fatal(err)
	}
	rows, err := s.boundAccounts(owner)
	if err != nil || rows[0].Note != "managed" {
		t.Fatal(rows, err)
	}
	details, err := s.details(owner, "official")
	if err != nil || obj(details.(object)["privateDetails"])["alias"] != "mine" {
		t.Fatal(details, err)
	}
	options.Editable = true
	if _, err := s.upsertAccounts(options, []object{in}); err != nil {
		t.Fatal(err)
	}
	rows, err = s.boundAccounts(owner)
	if err != nil || rows[0].Note != "unauthorized" {
		t.Fatal(rows, err)
	}
	if _, err := s.deleteAccount(owner, "official"); err != nil {
		t.Fatal(err)
	}
	in["fieldModifiedAt"] = object{"privateDetails": testNew}
	if _, err := s.upsertAccounts(options, []object{in}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.details(owner, "official"); err == nil {
		t.Fatal("upload resurrected a tombstone")
	}
	if _, err := s.restore(owner, "official", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.details(owner, "official"); err != nil {
		t.Fatal(err)
	}
}

func TestSyncBatchDeviceChangesInvalidateOnlyDeviceCache(t *testing.T) {
	s, store, owner := batchFixture(t)
	if err := store.DB.Exec(`CREATE TABLE remote_devices (
        "ownerId" text, "deviceId" text, "activeAccountId" text, "lastSeenAt" timestamptz)`).Error; err != nil {
		t.Fatal(err)
	}
	device := uuid.NewString()
	if err := store.DB.Exec(`INSERT INTO remote_devices VALUES (?, ?, ?, ?)`, owner, device, "fixture-0", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	rows := batchRecords(2)
	options := writeOptions{Owner: owner, Device: device}
	rows[0]["active"] = true
	if _, err := s.upsertAccounts(options, rows); err != nil {
		t.Fatal(err)
	}
	key := platform.DeviceDirectoryCacheKey(owner)
	ctx := context.Background()
	t.Cleanup(func() { store.Redis.Del(ctx, key) })
	if err := store.Redis.Set(ctx, key, "sentinel", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.list(owner, "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.upsertAccounts(options, rows); err != nil {
		t.Fatal(err)
	}
	if value, err := store.Redis.Get(ctx, key).Result(); err != nil || value != "sentinel" {
		t.Fatal("unchanged active device invalidated cache", value, err)
	}
	rows[0]["active"], rows[1]["active"] = false, true
	// Device active state must change even when the account field timestamp has not advanced.
	if _, err := s.upsertAccounts(options, rows); err != nil {
		t.Fatal(err)
	}
	if store.Redis.Exists(ctx, key).Val() != 0 {
		t.Fatal("device cache was not invalidated")
	}
	store.Queries.Count.Store(0)
	if _, err := s.list(owner, "", false); err != nil {
		t.Fatal(err)
	}
	if store.Queries.Count.Load() != 0 {
		t.Fatal("device-only update invalidated effective accounts")
	}
	got, err := s.list(owner, device, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range got.(object)["accounts"].([]object) {
		if row["active"] != (row["id"] == "fixture-1") {
			t.Fatal("incorrect device projection", row)
		}
	}
}
