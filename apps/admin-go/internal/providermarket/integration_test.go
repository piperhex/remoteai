package providermarket

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/codex-switch/admin-go/internal/migrations"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func testDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("PROVIDER_MARKET_TEST_DSN")
	if dsn == "" {
		t.Skip("PROVIDER_MARKET_TEST_DSN must reference an isolated PostgreSQL test database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close() })
	if err := migrations.InitializeEmpty(db); err != nil {
		t.Fatal(err)
	}
	return db
}
func testUser(t *testing.T, db *gorm.DB) string {
	t.Helper()
	id := uuid.NewString()
	if err := db.Exec(`INSERT INTO users(id,email,"passwordHash") VALUES(?,?,?)`, id, id+"@test.invalid", "test-only").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DELETE FROM users WHERE id = ?", id) })
	return id
}
func TestDatabaseOwnerPermissionsAndConflicts(t *testing.T) {
	db := testDatabase(t)
	a, b := testUser(t, db), testUser(t, db)
	actors := map[string]*platform.Principal{
		"a": {ID: a}, "b": {ID: b},
		"admin": {ID: b, Permissions: []string{"admin.provider-market.read", "admin.provider-market.manage"}},
		"order": {ID: b, Permissions: []string{"admin.provider-market.read", "admin.provider-market.order"}},
	}
	router := testRouter(t, db, actors)
	body := saveInput{Draft: fixture(), Published: pointer(true)}
	response := call(router, "a", "POST", "/provider-market", body)
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	var saved presentation
	if json.Unmarshal(response.Body.Bytes(), &saved) != nil || saved.OwnerID == nil || *saved.OwnerID != a || saved.Official {
		t.Fatal("ownership was not derived from principal")
	}
	body.Revision = saved.Revision
	for _, method := range []string{"PUT", "DELETE"} {
		var payload interface{} = body
		if method == "DELETE" {
			payload = map[string]interface{}{"revision": saved.Revision}
		}
		if call(router, "b", method, "/provider-market/"+saved.ID, payload).Code != 403 {
			t.Fatal("other owner allowed")
		}
	}
	order := map[string]interface{}{"revision": saved.Revision, "sortOrder": 1}
	if call(router, "admin", "PATCH", "/admin/api/provider-market/"+saved.ID+"/order", order).Code != 403 {
		t.Fatal("manage permission also granted order")
	}
	if call(router, "order", "POST", "/admin/api/provider-market", body).Code != 403 {
		t.Fatal("order allowed publish")
	}
	if call(router, "order", "PATCH", "/admin/api/provider-market/"+saved.ID+"/order", order).Code != 200 {
		t.Fatal("ordering failed")
	}
	if call(router, "a", "PUT", "/provider-market/"+saved.ID, body).Code != 409 {
		t.Fatal("stale write accepted")
	}
	body.Revision++
	body.Published = pointer(false)
	if call(router, "a", "PUT", "/provider-market/"+saved.ID, body).Code != 200 {
		t.Fatal("owner cannot unpublish")
	}
	if call(router, "", "GET", "/provider-market/"+saved.ID, nil).Code != 404 {
		t.Fatal("unpublished exposed")
	}
	if call(router, "a", "GET", "/provider-market/mine", nil).Code != 200 {
		t.Fatal("own drafts inaccessible")
	}
	body.Revision = 0
	response = call(router, "admin", "POST", "/admin/api/provider-market", body)
	var official presentation
	json.Unmarshal(response.Body.Bytes(), &official)
	if response.Code != 201 || !official.Official || official.OwnerID != nil {
		t.Fatal("official ownership wrong")
	}
	t.Cleanup(func() { db.Delete(&item{}, "id = ?", official.ID) })
	body.Revision = official.Revision
	if call(router, "b", "PUT", "/provider-market/"+official.ID, body).Code != 403 {
		t.Fatal("official hijacked")
	}
	if call(router, "admin", "PUT", "/admin/api/provider-market/"+saved.ID, body).Code != 403 {
		t.Fatal("official endpoint rewrote community publication")
	}
}

func TestDatabaseUsageCountsRealProvidersOnceAndSortsOnlyEntries(t *testing.T) {
	db := testDatabase(t)
	owner := testUser(t, db)
	other := testUser(t, db)
	first, err := mutate(db, change{Owner: owner, Input: saveInput{Draft: fixture(), Published: pointer(true)}})
	if err != nil {
		t.Fatal(err)
	}
	secondDraft := fixture()
	secondDraft.Name = "Second"
	second, err := mutate(db, change{Owner: owner, Input: saveInput{Draft: secondDraft, Published: pointer(true)}})
	if err != nil {
		t.Fatal(err)
	}
	first, err = reviewItem(db, first.ID, other, reviewInput{Revision: first.Revision, Decision: reviewApproved})
	if err != nil {
		t.Fatal(err)
	}
	second, err = reviewItem(db, second.ID, other, reviewInput{Revision: second.Revision, Decision: reviewApproved})
	if err != nil {
		t.Fatal(err)
	}
	if counted, err := recordUsage(db, owner, first.ID, "not-saved"); err != nil || counted {
		t.Fatal("unpersisted usage counted", err)
	}
	if err := db.Exec(`INSERT INTO synced_providers(id,"ownerId","providerId",name,"baseUrl","apiKey",model,"apiFormat")
		VALUES(?,?,?,?,?,?,?,?)`, uuid.NewString(), owner, "personal-one", "Personal", first.Draft.BaseURL,
		"test-only", "model-b", "openaiResponses").Error; err != nil {
		t.Fatal(err)
	}
	if counted, err := recordUsage(db, other, first.ID, "personal-one"); err != nil || counted {
		t.Fatal("another account's provider counted", err)
	}
	for range 3 {
		if counted, err := recordUsage(db, owner, first.ID, "personal-one"); err != nil || !counted {
			t.Fatal(err)
		}
	}
	value, err := findItem(db, first.ID)
	if err != nil || value.UserCount != 1 {
		t.Fatal("usage not deduplicated", value.UserCount, err)
	}
	checkOrder := func(expected string) {
		t.Helper()
		var items []item
		if err := queryItems(db).Where("owner_id = ?", owner).Order(marketOrder).Find(&items).Error; err != nil {
			t.Fatal(err)
		}
		if len(items) != 2 || items[0].ID != expected {
			t.Fatal("wrong provider order", items)
		}
		if items[0].Draft.Models[0].ID != "model-b" || items[0].Draft.Models[0].Tiers[0].Multiplier != 5 {
			t.Fatal("model or tier order changed")
		}
	}
	checkOrder(first.ID)
	second, err = updateOrder(db, second.ID, second.Revision, pointer(int64(0)))
	if err != nil {
		t.Fatal(err)
	}
	checkOrder(second.ID)
	_, err = updateOrder(db, second.ID, second.Revision, nil)
	if err != nil {
		t.Fatal(err)
	}
	checkOrder(first.ID)
	var personalCount int64
	db.Table("synced_providers").Where(`"ownerId" = ?`, owner).Count(&personalCount)
	if personalCount != 1 {
		t.Fatal("market operations changed personal Providers")
	}
}
