package providermarket

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func seedPaginationItems(t *testing.T, db *gorm.DB, owner string) []item {
	t.Helper()
	rows := make([]item, 105)
	for index := range rows {
		order := int64(index)
		definition := fixture()
		definition.Name = fmt.Sprintf("%s-%03d", owner, index)
		rows[index] = item{ID: uuid.NewString(), OwnerID: &owner, Draft: definition,
			Published: true, Revision: 1, ReviewStatus: reviewApproved, SortOrder: &order}
	}
	if err := db.Omit("UserCount").Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestDatabaseAdminPagination(t *testing.T) {
	db := testDatabase(t)
	owner := testUser(t, db)
	rows := seedPaginationItems(t, db, owner)
	router := testRouter(t, db, map[string]*platform.Principal{
		"reader": {ID: owner, Permissions: []string{"admin.provider-market.read"}},
	})
	for _, test := range []struct {
		path          string
		count, offset int
	}{
		{"/admin/api/provider-market?", 40, 0},
		{"/admin/api/provider-market?page=2&pageSize=10&", 10, 10},
		{"/admin/api/provider-market?page=6&pageSize=20&", 5, 100},
		{"/admin/api/provider-market?page=2&pageSize=50&", 50, 50},
		{"/admin/api/provider-market?page=1&pageSize=100&", 100, 0},
		{"/admin/api/provider-market?page=2&pageSize=100&", 5, 100},
		{"/admin/api/provider-market?page=12&pageSize=10&", 0, 110},
		{"/provider-market?page=2&pageSize=10&", 40, 40},
		{"/provider-market/mine?page=2&pageSize=10&", 40, 40},
	} {
		t.Run(test.path, func(t *testing.T) {
			response := call(router, "reader", "GET", test.path+"search="+owner, nil)
			var result struct {
				Items []presentation `json:"items"`
				Total int            `json:"total"`
			}
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
				t.Fatalf("invalid list response: %d %s", response.Code, response.Body.String())
			}
			if len(result.Items) != test.count || result.Total != len(rows) {
				t.Fatalf("got %d items, total %d; want %d, %d", len(result.Items), result.Total, test.count, len(rows))
			}
			for index, entry := range result.Items {
				if entry.ID != rows[test.offset+index].ID {
					t.Fatalf("unexpected item at index %d: %s", index, entry.ID)
				}
			}
		})
	}
}

func TestDatabaseAdminBatchEntireLargePage(t *testing.T) {
	db := testDatabase(t)
	owner := testUser(t, db)
	rows := seedPaginationItems(t, db, owner)
	if err := db.Model(&item{}).Where("owner_id = ?", owner).Update("review_status", reviewPending).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db, map[string]*platform.Principal{
		"admin": {ID: owner, Permissions: []string{"admin.provider-market.read",
			"admin.provider-market.manage", "admin.provider-market.review"}},
	})
	entries := make([]itemRevision, 100)
	for index := range entries {
		entries[index] = itemRevision{ID: rows[index].ID, Revision: 1}
	}
	response := call(router, "admin", "POST", "/admin/api/provider-market/batch/review",
		batchReviewInput{Items: entries, Decision: reviewApproved})
	if response.Code != 201 {
		t.Fatal("full-page review failed", response.Code, response.Body.String())
	}
	for index := range entries {
		entries[index].Revision++
	}
	assertBatchStatus(t, db, entries, reviewApproved)
	response = call(router, "admin", "POST", "/admin/api/provider-market/batch/delete", batchInput{Items: entries})
	if response.Code != 201 {
		t.Fatal("full-page deletion failed", response.Code, response.Body.String())
	}
	var remaining []item
	if err := db.Where("owner_id = ?", owner).Find(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 5 {
		t.Fatal("deletion affected the wrong number of items", len(remaining))
	}
	for _, entry := range remaining {
		if entry.ReviewStatus != reviewPending || entry.Revision != 1 {
			t.Fatal("batch changed an unselected item", entry.ID)
		}
	}
}
