package providermarket

import (
	"sort"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func batchFixture(t *testing.T, db *gorm.DB) (*gin.Engine, []itemRevision, string) {
	t.Helper()
	owner, admin := testUser(t, db), testUser(t, db)
	router := testRouter(t, db, map[string]*platform.Principal{
		"owner": {ID: owner},
		"admin": {ID: admin, Permissions: []string{"admin.provider-market.read",
			"admin.provider-market.manage", "admin.provider-market.review"}},
	})
	entries := make([]itemRevision, 2)
	for index := range entries {
		value, err := mutate(db, change{Owner: owner, Input: saveInput{Draft: fixture(), Published: pointer(true)}})
		if err != nil {
			t.Fatal(err)
		}
		entries[index] = itemRevision{ID: value.ID, Revision: value.Revision}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return router, entries, owner
}

func assertBatchStatus(t *testing.T, db *gorm.DB, entries []itemRevision, status reviewStatus) {
	t.Helper()
	for _, entry := range entries {
		value, err := findItem(db, entry.ID)
		if err != nil || value.Revision != entry.Revision || value.ReviewStatus != status {
			t.Fatal("batch state differs", value.Revision, value.ReviewStatus, err)
		}
	}
}

func TestDatabaseBatchReviewAtomicity(t *testing.T) {
	db := testDatabase(t)
	router, entries, _ := batchFixture(t, db)
	path := "/admin/api/provider-market/batch/review"
	stale := append([]itemRevision(nil), entries...)
	stale[1].Revision++
	response := call(router, "admin", "POST", path, batchReviewInput{Items: stale, Decision: reviewApproved})
	if response.Code != 409 {
		t.Fatal(response.Code, response.Body.String())
	}
	assertBatchStatus(t, db, entries, reviewPending)
	response = call(router, "admin", "POST", path, batchReviewInput{Items: entries, Decision: reviewApproved})
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	for index := range entries {
		entries[index].Revision++
		value, err := findItem(db, entries[index].ID)
		if err != nil || value.ReviewedBy == nil || value.ReviewedAt == nil {
			t.Fatal("missing review audit", err)
		}
		expectPublicEntry(t, router, value.ID, true)
	}
	assertBatchStatus(t, db, entries, reviewApproved)
	response = call(router, "admin", "POST", path,
		batchReviewInput{Items: entries, Decision: reviewRejected, Reason: "Must not reject approved entries in bulk"})
	if response.Code != 400 {
		t.Fatal("non-pending entries accepted", response.Code)
	}
	assertBatchStatus(t, db, entries, reviewApproved)
}

func TestDatabaseBatchRejectAndDelete(t *testing.T) {
	db := testDatabase(t)
	router, entries, owner := batchFixture(t, db)
	response := call(router, "admin", "POST", "/admin/api/provider-market/batch/review",
		batchReviewInput{Items: entries, Decision: reviewRejected, Reason: "  Please correct prices  "})
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	for index := range entries {
		entries[index].Revision++
		value, err := findItem(db, entries[index].ID)
		if err != nil || value.ReviewReason != "Please correct prices" {
			t.Fatal("rejection reason missing", err)
		}
		expectPublicEntry(t, router, value.ID, false)
	}
	assertBatchStatus(t, db, entries, reviewRejected)
	personalID := uuid.NewString()
	if err := db.Exec(`INSERT INTO synced_providers(id,"ownerId","providerId",name,"baseUrl","apiKey",model,"apiFormat")
		VALUES(?,?,?,?,?,?,?,?)`, personalID, owner, "personal-batch", "Personal", "https://provider.example/v1",
		"test-only", "model-b", "openaiResponses").Error; err != nil {
		t.Fatal(err)
	}
	stale := append([]itemRevision(nil), entries...)
	stale[1].Revision++
	path := "/admin/api/provider-market/batch/delete"
	if response := call(router, "admin", "POST", path, batchInput{Items: stale}); response.Code != 409 {
		t.Fatal("stale deletion accepted", response.Code)
	}
	assertBatchStatus(t, db, entries, reviewRejected)
	if response := call(router, "admin", "POST", path, batchInput{Items: entries}); response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, entry := range entries {
		if _, err := findItem(db, entry.ID); err == nil {
			t.Fatal("deleted item remains")
		}
	}
	var count int64
	if err := db.Table("synced_providers").Where("id = ?", personalID).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("market deletion affected personal provider", err)
	}
}

func TestDatabaseAdminDeletionAndMixedReviewEligibility(t *testing.T) {
	db := testDatabase(t)
	router, entries, _ := batchFixture(t, db)
	official := requestMarketItem(t, router, marketTestRequest{"admin", "POST", "/admin/api/provider-market",
		saveInput{Draft: fixture(), Published: pointer(true)}, 201})
	t.Cleanup(func() { db.Delete(&item{}, "id = ?", official.ID) })
	entries = append(entries, itemRevision{ID: official.ID, Revision: official.Revision})
	response := call(router, "admin", "POST", "/admin/api/provider-market/batch/review",
		batchReviewInput{Items: entries, Decision: reviewApproved})
	if response.Code != 400 {
		t.Fatal("official item reviewed", response.Code)
	}
	assertBatchStatus(t, db, entries[:2], reviewPending)
	requestMarketItem(t, router, marketTestRequest{"admin", "DELETE", "/admin/api/provider-market/" + entries[0].ID,
		map[string]interface{}{"revision": entries[0].Revision}, 200})
	response = call(router, "admin", "POST", "/admin/api/provider-market/batch/delete", batchInput{Items: entries[1:]})
	if response.Code != 201 {
		t.Fatal("mixed deletion failed", response.Code, response.Body.String())
	}
}
