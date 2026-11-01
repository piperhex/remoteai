package providermarket

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func testRouter(t *testing.T, db *gorm.DB, actors map[string]*platform.Principal) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(platform.RequestBodyParser())
	err := Register(router, &platform.Dependencies{DB: db, Authenticate: func(c *gin.Context) (*platform.Principal, error) {
		return actors[c.GetHeader("Authorization")], nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	return router
}
func call(router *gin.Engine, actor, method, path string, body interface{}) *httptest.ResponseRecorder {
	if body == nil {
		body = map[string]interface{}{}
	}
	encoded, _ := json.Marshal(body)
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Authorization", actor)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
func TestAuthenticationAndStrictPublicAllowlist(t *testing.T) {
	router := testRouter(t, nil, map[string]*platform.Principal{"user": {ID: "owner"}})
	for _, target := range []struct{ method, path string }{
		{"POST", "/provider-market"}, {"PUT", "/provider-market/example"},
		{"DELETE", "/provider-market/example"}, {"POST", "/provider-market/example/usage"},
		{"GET", "/provider-market/mine"}, {"POST", "/admin/api/provider-market"},
		{"PATCH", "/admin/api/provider-market/example/order"},
		{"PATCH", "/admin/api/provider-market/example/review"},
		{"PATCH", "/admin/api/provider-market/example/badge"},
	} {
		if response := call(router, "", target.method, target.path, nil); response.Code != 401 {
			t.Fatalf("anonymous %s: %d", target.path, response.Code)
		}
	}
	for _, key := range []string{"ownerId", "authorId", "official", "sortOrder", "apiKey", "userCount",
		"reviewStatus", "reviewReason", "marketingBadge", "reviewedBy"} {
		body := map[string]interface{}{"draft": fixture(), "published": true, key: "forged"}
		if response := call(router, "user", "POST", "/provider-market", body); response.Code != 400 {
			t.Fatalf("accepted forged %s: %d", key, response.Code)
		}
	}
	for _, key := range []string{"apiKey", "walletPassword", "balanceQueryToken", "headers", "requestOptions",
		"reviewStatus", "marketingBadge"} {
		encoded, _ := json.Marshal(fixture())
		var draft map[string]interface{}
		json.Unmarshal(encoded, &draft)
		draft[key] = "secret"
		body := map[string]interface{}{"draft": draft, "published": true}
		if call(router, "user", "POST", "/provider-market", body).Code != 400 {
			t.Fatal("private field accepted", key)
		}
	}
	if call(router, "user", "PATCH", "/admin/api/provider-market/example/order", nil).Code != 403 {
		t.Fatal("ordinary user can order the market")
	}
}
