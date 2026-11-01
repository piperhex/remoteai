package providermarket

import (
	"encoding/json"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

type marketTestRequest struct {
	actor, method, path string
	body                interface{}
	status              int
}

func requestMarketItem(t *testing.T, router *gin.Engine, request marketTestRequest) presentation {
	t.Helper()
	response := call(router, request.actor, request.method, request.path, request.body)
	if response.Code != request.status {
		t.Fatalf("%s %s: %d %s", request.method, request.path, response.Code, response.Body.String())
	}
	var result presentation
	if response.Code < 300 && json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatal("invalid item response")
	}
	return result
}

func expectPublicEntry(t *testing.T, router *gin.Engine, id string, visible bool) {
	t.Helper()
	status := 404
	if visible {
		status = 200
	}
	requestMarketItem(t, router, marketTestRequest{"", "GET", "/provider-market/" + id, nil, status})
	response := call(router, "", "GET", "/provider-market", nil)
	var page struct {
		Items []presentation `json:"items"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &page) != nil {
		t.Fatal(response.Body.String())
	}
	found := false
	for _, row := range page.Items {
		if row.ID == id {
			found = true
		}
	}
	if found != visible {
		t.Fatal("public listing did not enforce review", id, visible)
	}
}

func TestDatabaseReviewGatesEveryPublicationRevision(t *testing.T) {
	db := testDatabase(t)
	owner, reviewer := testUser(t, db), testUser(t, db)
	router := testRouter(t, db, map[string]*platform.Principal{
		"owner":    {ID: owner},
		"reviewer": {ID: reviewer, Permissions: []string{"admin.provider-market.read", "admin.provider-market.review"}},
		"manager":  {ID: reviewer, Permissions: []string{"admin.provider-market.read", "admin.provider-market.manage"}},
	})
	body := saveInput{Draft: fixture(), Published: pointer(true)}
	entry := requestMarketItem(t, router, marketTestRequest{"owner", "POST", "/provider-market", body, 201})
	if entry.ReviewStatus != reviewPending {
		t.Fatal("publication did not enter review")
	}
	expectPublicEntry(t, router, entry.ID, false)
	path := "/admin/api/provider-market/" + entry.ID + "/review"
	approval := reviewInput{Revision: entry.Revision, Decision: reviewApproved}
	for _, actor := range []string{"owner", "manager"} {
		requestMarketItem(t, router, marketTestRequest{actor, "PATCH", path, approval, 403})
	}
	entry = requestMarketItem(t, router, marketTestRequest{"reviewer", "PATCH", path, approval, 200})
	expectPublicEntry(t, router, entry.ID, true)
	body.Revision, body.Draft.Name = entry.Revision, "Changed after review"
	entry = requestMarketItem(t, router, marketTestRequest{"owner", "PUT", "/provider-market/" + entry.ID, body, 200})
	expectPublicEntry(t, router, entry.ID, false)
	requestMarketItem(t, router, marketTestRequest{"reviewer", "PATCH", path, approval, 409})
	rejection := reviewInput{Revision: entry.Revision, Decision: reviewRejected, Reason: "Correct the price"}
	entry = requestMarketItem(t, router, marketTestRequest{"reviewer", "PATCH", path, rejection, 200})
	if entry.ReviewStatus != reviewRejected || entry.ReviewReason != rejection.Reason {
		t.Fatal("review feedback missing")
	}
	expectPublicEntry(t, router, entry.ID, false)
	response := call(router, "owner", "GET", "/provider-market/mine", nil)
	var own struct {
		Items []presentation `json:"items"`
	}
	if json.Unmarshal(response.Body.Bytes(), &own) != nil || len(own.Items) != 1 ||
		own.Items[0].ReviewReason != rejection.Reason {
		t.Fatal("owner cannot see rejection")
	}
	body.Revision = entry.Revision
	entry = requestMarketItem(t, router, marketTestRequest{"owner", "PUT", "/provider-market/" + entry.ID, body, 200})
	if entry.ReviewStatus != reviewPending || entry.ReviewReason != "" {
		t.Fatal("resubmission was not reset")
	}
	body.Revision, body.Published = entry.Revision, pointer(false)
	entry = requestMarketItem(t, router, marketTestRequest{"owner", "PUT", "/provider-market/" + entry.ID, body, 200})
	approval.Revision = entry.Revision
	requestMarketItem(t, router, marketTestRequest{"reviewer", "PATCH", path, approval, 400})
	expectPublicEntry(t, router, entry.ID, false)
}

func TestDatabaseBadgePermissionAndReviewRemainIndependent(t *testing.T) {
	db := testDatabase(t)
	owner, admin := testUser(t, db), testUser(t, db)
	router := testRouter(t, db, map[string]*platform.Principal{
		"owner":   {ID: owner},
		"promote": {ID: admin, Permissions: []string{"admin.provider-market.read", "admin.provider-market.promote"}},
		"review":  {ID: admin, Permissions: []string{"admin.provider-market.read", "admin.provider-market.review"}},
	})
	entry := requestMarketItem(t, router, marketTestRequest{"owner", "POST", "/provider-market",
		saveInput{Draft: fixture(), Published: pointer(true)}, 201})
	path := "/admin/api/provider-market/" + entry.ID + "/badge"
	badge := &marketingBadge{Text: "限时优惠", Tone: "orange"}
	body := map[string]interface{}{"revision": entry.Revision, "badge": badge}
	for _, actor := range []string{"owner", "review"} {
		requestMarketItem(t, router, marketTestRequest{actor, "PATCH", path, body, 403})
	}
	entry = requestMarketItem(t, router, marketTestRequest{"promote", "PATCH", path, body, 200})
	if entry.MarketingBadge == nil || *entry.MarketingBadge != *badge || entry.ReviewStatus != reviewPending {
		t.Fatal("badge changed review status or was not saved")
	}
	expectPublicEntry(t, router, entry.ID, false)
	requestMarketItem(t, router, marketTestRequest{"promote", "PATCH", path, body, 409})
	approval := reviewInput{Revision: entry.Revision, Decision: reviewApproved}
	requestMarketItem(t, router, marketTestRequest{"promote", "PATCH", "/admin/api/provider-market/" + entry.ID + "/review", approval, 403})
	entry = requestMarketItem(t, router, marketTestRequest{"review", "PATCH", "/admin/api/provider-market/" + entry.ID + "/review", approval, 200})
	expectPublicEntry(t, router, entry.ID, true)
	entry = requestMarketItem(t, router, marketTestRequest{"promote", "PATCH", path,
		map[string]interface{}{"revision": entry.Revision, "badge": nil}, 200})
	if entry.MarketingBadge != nil || entry.ReviewStatus != reviewApproved {
		t.Fatal("clearing badge changed approval")
	}
}

func TestDatabaseReviewRequiresCompleteLegacyPublication(t *testing.T) {
	db := testDatabase(t)
	owner := testUser(t, db)
	legacy := fixture()
	legacy.PageLink = nil
	entry, err := mutate(db, change{Owner: owner, Input: saveInput{Draft: legacy, Published: pointer(true)}})
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db, map[string]*platform.Principal{
		"review": {ID: owner, Permissions: []string{"admin.provider-market.read", "admin.provider-market.review"}},
	})
	requestMarketItem(t, router, marketTestRequest{"review", "PATCH", "/admin/api/provider-market/" + entry.ID + "/review",
		reviewInput{Revision: entry.Revision, Decision: reviewApproved}, 400})
	expectPublicEntry(t, router, entry.ID, false)
}
