package content

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/turnquota"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func quotaDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TURN_QUOTA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated TURN_QUOTA_TEST_DATABASE_URL")
	}
	db, err := gorm.Open(postgres.Open(dsn))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close() })
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() {
		if err := tx.Rollback().Error; err != nil {
			t.Error(err)
		}
	})
	schema := "quota_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	for _, query := range []string{`CREATE SCHEMA "` + schema + `"`, `SET LOCAL search_path TO "` + schema + `"`} {
		if err := tx.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.AutoMigrate(&chatSettings{}, &auditEntry{}); err != nil {
		t.Fatal(err)
	}
	return tx
}

func quotaRequest(router *gin.Engine, method, suffix, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/admin/api/chat-settings/turn-relay"+suffix, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestTurnQuotaPermissions(t *testing.T) {
	for _, permissions := range [][]string{nil, {}, {"admin.chat-settings.read"}} {
		deps := &platform.Dependencies{}
		if permissions != nil {
			deps.Authenticate = func(*gin.Context) (*platform.Principal, error) {
				return &platform.Principal{Permissions: permissions}, nil
			}
		}
		router := gin.New()
		(&service{deps: deps}).turnQuotaRoutes(router)
		for _, operation := range [][2]string{{"PATCH", ""}, {"POST", "/retry"}} {
			response := quotaRequest(router, operation[0], operation[1], `{"totalQuota":2}`)
			want := 403
			if permissions == nil {
				want = 401
			}
			if response.Code != want {
				t.Fatal(response.Code, response.Body)
			}
		}
		if len(permissions) == 0 {
			response := quotaRequest(router, "GET", "", "")
			if response.Code != 401 && response.Code != 403 {
				t.Fatal(response.Code)
			}
		}
	}
}

func TestTurnQuotaPersistenceValidationAndAudit(t *testing.T) {
	db := quotaDatabase(t)
	deps := &platform.Dependencies{DB: db, Config: platform.Config{},
		Authenticate: func(*gin.Context) (*platform.Principal, error) {
			return &platform.Principal{ID: uuid.NewString(), Email: "admin@local.test",
				Permissions: []string{"admin.chat-settings.read", "admin.chat-settings.manage"}}, nil
		}}
	router := gin.New()
	(&service{deps: deps}).turnQuotaRoutes(router)
	get := func() turnquota.Status {
		response := quotaRequest(router, "GET", "", "")
		var status turnquota.Status
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &status) != nil {
			t.Fatal(response.Body)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cacheable quota")
		}
		return status
	}
	if get().TotalQuota != 256 {
		t.Fatal("default changed")
	}
	for _, body := range []string{`{}`, `{"totalQuota":null}`, `{"totalQuota":0}`, `{"totalQuota":-1}`,
		`{"totalQuota":65536}`, `{"totalQuota":2.5}`, `{"totalQuota":"3"}`} {
		if response := quotaRequest(router, "PATCH", "", body); response.Code != 400 {
			t.Fatal(body, response.Body)
		}
	}
	response := quotaRequest(router, "PATCH", "", `{"totalQuota":3}`)
	if response.Code != 200 {
		t.Fatal(response.Body)
	}
	if status := get(); status.TotalQuota != 3 || status.State != "pending" || status.Issue != "not_configured" {
		t.Fatal(status)
	}
	var entries []auditEntry
	if err := db.Find(&entries).Error; err != nil || len(entries) != 1 || entries[0].Action != "turn-quota.update" {
		t.Fatal(entries, err)
	}
	response = quotaRequest(router, "POST", "/retry", "")
	if response.Code != 201 {
		t.Fatal(response.Body)
	}
	var count int64
	err := db.Model(&auditEntry{}).Where("action = ?", "turn-quota.retry").Count(&count).Error
	if err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if err := db.Save(&chatSettings{Id: "current", Policy: defaultChatPolicy()}).Error; err != nil {
		t.Fatal(err)
	}
	if get().TotalQuota != 3 {
		t.Fatal("chat update erased quota")
	}
}
