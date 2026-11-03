package turnquota

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPolicyValidationAndLegacyDefault(t *testing.T) {
	for _, value := range []int{1, 2, Default, Maximum} {
		if err := (Policy{value}).Validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []int{-1, 0, Maximum + 1} {
		if err := (Policy{value}).Validate(); !errors.Is(err, ErrInvalid) {
			t.Fatal(value, err)
		}
	}
	for _, data := range []string{`{}`, `{"unrelated": 3}`} {
		var policy Policy
		if err := json.Unmarshal([]byte(data), &policy); err != nil || policy.TotalQuota != Default {
			t.Fatal(policy, err)
		}
	}
	for _, data := range []string{`{"totalQuota":1.5}`, `{"totalQuota":"2"}`} {
		var policy Policy
		if json.Unmarshal([]byte(data), &policy) == nil {
			t.Fatal(data)
		}
	}
}

func TestBootstrapAtomicReplacement(t *testing.T) {
	directory := t.TempDir()
	for _, value := range []int{256, 2, 3, 1} {
		if err := writeBootstrap(directory, value); err != nil {
			t.Fatal(err)
		}
		if actual := readBootstrap(directory); actual != value {
			t.Fatal(actual)
		}
	}
	if err := writeBootstrap(filepath.Join(directory, "missing"), 2); err == nil {
		t.Fatal("missing storage accepted")
	}
	for _, malformed := range []string{"+2", " 2\n", "2\r\n", "0", "65536"} {
		if err := os.WriteFile(filepath.Join(directory, "total-quota"), []byte(malformed), 0644); err != nil {
			t.Fatal(err)
		}
		if readBootstrap(directory) != 0 {
			t.Fatal("invalid restart snapshot accepted", malformed)
		}
		if err := writeBootstrap(directory, 2); err != nil {
			t.Fatal(err)
		}
	}
}

func integrationDeps(t *testing.T) *platform.Dependencies {
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
	t.Cleanup(func() {
		if err := pool.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := db.AutoMigrate(&settingsRow{}); err != nil {
		t.Fatal(err)
	}
	return &platform.Dependencies{DB: db, Config: platform.Config{
		"DESKTOP_TURN_CONTROL":          os.Getenv("TURN_QUOTA_TEST_CONTROL"),
		"DESKTOP_TURN_CONTROL_PASSWORD": "local_turn_quota_control_1234567890",
		"DESKTOP_TURN_QUOTA_DIR":        os.Getenv("TURN_QUOTA_TEST_DIR"),
	}}
}

func saveQuota(t *testing.T, deps *platform.Dependencies, value int) {
	t.Helper()
	if err := Update(context.Background(), deps.DB, Policy{value}, func(*gorm.DB) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func awaitQuota(t *testing.T, deps *platform.Dependencies, value int) {
	t.Helper()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		status, err := Reconcile(context.Background(), deps)
		if err != nil {
			t.Fatal(err)
		}
		if status.State == "applied" && status.TotalQuota == value {
			t.Logf("coturn confirmed quota=%d", value)
			return
		}
		if status.Issue != "" {
			t.Fatal(status)
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatal("coturn did not apply quota in 12 seconds")
}

func TestPersistenceAndSyncRecovery(t *testing.T) {
	deps := integrationDeps(t)
	if err := deps.DB.Delete(&settingsRow{}, "id = ?", settingsID).Error; err != nil {
		t.Fatal(err)
	}
	policy, err := Read(deps.DB)
	if err != nil || policy.TotalQuota != Default {
		t.Fatal(policy, err)
	}
	saveQuota(t, deps, 3)
	err = Update(context.Background(), deps.DB, Policy{2}, func(*gorm.DB) error { return errors.New("audit failed") })
	policy, readErr := Read(deps.DB)
	if err == nil || readErr != nil || policy.TotalQuota != 3 {
		t.Fatal(policy, err, readErr)
	}
	awaitQuota(t, deps, 3)
	config := deps.Config
	deps.Config = platform.Config{}
	status, err := Reconcile(context.Background(), deps)
	if err != nil || status.Issue != "not_configured" || status.State == "applied" {
		t.Fatal(status, err)
	}
	deps.Config = config
	address := config["DESKTOP_TURN_CONTROL"]
	config["DESKTOP_TURN_CONTROL"] = "127.0.0.1:1"
	saveQuota(t, deps, 2)
	status, err = Reconcile(context.Background(), deps)
	if err != nil || status.Issue != "control_unavailable" || status.State == "applied" {
		t.Fatal(status, err)
	}
	config["DESKTOP_TURN_CONTROL"] = address
	awaitQuota(t, deps, 2)
	config["DESKTOP_TURN_QUOTA_DIR"] += "/missing"
	status, err = Reconcile(context.Background(), deps)
	if err != nil || status.Issue != "restart_snapshot_failed" {
		t.Fatal(status, err)
	}
	config["DESKTOP_TURN_QUOTA_DIR"] = os.Getenv("TURN_QUOTA_TEST_DIR")
	// A fresh controller reads the same DB value; no process-local state is authoritative.
	fresh := &platform.Dependencies{DB: deps.DB, Config: config}
	awaitQuota(t, fresh, 2)
}

func TestWorkerRecoversRuntimeDrift(t *testing.T) {
	deps := integrationDeps(t)
	saveQuota(t, deps, 2)
	config, ok := configuration(deps.Config)
	if !ok {
		t.Fatal("missing test control configuration")
	}
	client, err := connect(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer client.conn.Close()
	if err := client.set(3); err != nil {
		t.Fatal(err)
	}
	quota, err := client.read(config.realm)
	if err != nil || quota.Default != 3 {
		t.Fatal(quota, err)
	}
	stop := Start(deps)
	defer stop()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		status, err := Snapshot(context.Background(), deps)
		if err != nil {
			t.Fatal(err)
		}
		if status.State == "applied" && status.TotalQuota == 2 {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal("automatic worker did not restore saved quota")
}
