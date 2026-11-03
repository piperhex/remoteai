package devices

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/codex-switch/admin-go/internal/content"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func commandPolicyDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("REMOTE_COMMAND_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set REMOTE_COMMAND_TEST_DATABASE_URL to an isolated PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := pool.Close(); err != nil {
			t.Error(err)
		}
	})
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() {
		if err := tx.Rollback().Error; err != nil {
			t.Error(err)
		}
	})
	schema := "command_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	for _, sql := range []string{
		`CREATE SCHEMA "` + schema + `"`, `SET LOCAL search_path TO "` + schema + `"`,
		`CREATE TABLE chat_settings (id text PRIMARY KEY, policy jsonb, updated_at timestamptz)`,
		`CREATE TABLE admin_audit_logs (id text PRIMARY KEY, "actorId" text, "actorEmail" text,
            action text, "targetType" text, "targetId" text, "targetEmail" text,
            metadata jsonb, "createdAt" timestamptz)`,
	} {
		if err := tx.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	return tx
}

func TestRemoteCommandAdminPersistenceRefreshAndPermissions(t *testing.T) {
	db := commandPolicyDatabase(t)
	deps := &platform.Dependencies{DB: db, Config: platform.Config{},
		Authenticate: func(c *gin.Context) (*platform.Principal, error) {
			permissions := []string{"admin.chat-settings.read"}
			if c.GetHeader("Authorization") == "manage" {
				permissions = append(permissions, "admin.chat-settings.manage")
			}
			if c.GetHeader("Authorization") == "" {
				return nil, nil
			}
			return &platform.Principal{ID: "admin", Email: "admin@fixture.test", Permissions: permissions}, nil
		}}
	g := newControlGateway(&Service{deps})
	router := gin.New()
	if err := content.Register(router, deps); err != nil {
		t.Fatal(err)
	}
	policy, err := content.ReadChatPolicy(db)
	if err != nil || g.remoteCommandLimit() != 5 {
		t.Fatal(policy, err)
	}
	delete(policy, "remoteCommandConcurrencyLimit")
	delete(policy, "titleSettings") // Legacy payload also predates title settings.
	patch := func(auth string, value map[string]interface{}) *httptest.ResponseRecorder {
		body, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPatch, "/admin/api/chat-settings", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", auth)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	for _, auth := range []string{"", "read"} {
		response := patch(auth, policy)
		if response.Code != 401 && response.Code != 403 {
			t.Fatal(response.Code, response.Body)
		}
	}
	if response := patch("manage", policy); response.Code != 200 {
		t.Fatal(response.Code, response.Body)
	}
	for _, value := range []float64{8, 1, 32} {
		policy["remoteCommandConcurrencyLimit"] = value
		response := patch("manage", policy)
		if response.Code != 200 || g.remoteCommandLimit() != int(value) {
			t.Fatal(response.Code, response.Body)
		}
		persisted, err := content.ReadChatPolicy(db)
		if err != nil || persisted["remoteCommandConcurrencyLimit"] != value {
			t.Fatal(persisted, err)
		}
	}
	policy["remoteCommandConcurrencyLimit"] = float64(33)
	if response := patch("manage", policy); response.Code != 400 || g.remoteCommandLimit() != 32 {
		t.Fatal("invalid update changed cached policy", response.Code, response.Body)
	}
	var auditCount int64
	if err := db.Table("admin_audit_logs").Count(&auditCount).Error; err != nil || auditCount != 4 {
		t.Fatal("updates must be audited", auditCount, err)
	}
	// A failed audit rolls back the policy and must not refresh the gateway.
	if err := db.Exec("DROP TABLE admin_audit_logs").Error; err != nil {
		t.Fatal(err)
	}
	policy["remoteCommandConcurrencyLimit"] = float64(1)
	if response := patch("manage", policy); response.Code != 500 || g.remoteCommandLimit() != 32 {
		t.Fatal("failed transaction changed cached policy", response.Code, response.Body)
	}
	restarted := newControlGateway(&Service{deps})
	if restarted.remoteCommandLimit() != 32 {
		t.Fatal("restart lost persisted limit")
	}
}
