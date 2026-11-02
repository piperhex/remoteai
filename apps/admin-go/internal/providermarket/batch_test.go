package providermarket

import (
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

func TestBatchValidationAndPermissions(t *testing.T) {
	entry := itemRevision{ID: uuid.NewString(), Revision: 1}
	tooMany := make([]itemRevision, maxBatchItems+1)
	for index := range tooMany {
		tooMany[index] = itemRevision{ID: uuid.NewString(), Revision: 1}
	}
	for _, entries := range [][]itemRevision{nil, {entry, entry}, {{ID: "invalid", Revision: 1}},
		{{ID: entry.ID, Revision: 0}}, tooMany} {
		if validBatch(entries) {
			t.Fatal("invalid selection accepted", entries)
		}
	}
	if !validBatch(tooMany[:maxBatchItems]) {
		t.Fatal("full page refused")
	}
	router := testRouter(t, nil, map[string]*platform.Principal{
		"reader": {ID: "reader", Permissions: []string{"admin.provider-market.read"}},
		"manager": {ID: "manager", Permissions: []string{
			"admin.provider-market.read", "admin.provider-market.manage"}},
		"reviewer": {ID: "reviewer", Permissions: []string{
			"admin.provider-market.read", "admin.provider-market.review"}},
		"noRead": {ID: "noRead", Permissions: []string{
			"admin.provider-market.manage", "admin.provider-market.review"}},
	})
	for _, operation := range []struct{ path, actor, other string }{
		{"/admin/api/provider-market/batch/delete", "manager", "reviewer"},
		{"/admin/api/provider-market/batch/review", "reviewer", "manager"},
	} {
		for _, actor := range []string{"", "reader", operation.other, "noRead"} {
			want := 403
			if actor == "" {
				want = 401
			}
			if response := call(router, actor, "POST", operation.path, nil); response.Code != want {
				t.Fatalf("%s %s: %d", actor, operation.path, response.Code)
			}
		}
		if response := call(router, operation.actor, "POST", operation.path, nil); response.Code != 400 {
			t.Fatal("empty batch accepted", response.Code)
		}
	}
	for _, body := range []interface{}{
		batchReviewInput{Items: []itemRevision{entry}, Decision: reviewRejected, Reason: " "},
		batchReviewInput{Items: []itemRevision{entry}, Decision: reviewPending},
		map[string]interface{}{"items": []itemRevision{entry}, "decision": "approved", "official": true},
	} {
		if call(router, "reviewer", "POST", "/admin/api/provider-market/batch/review", body).Code != 400 {
			t.Fatal("invalid batch review accepted")
		}
	}
}
