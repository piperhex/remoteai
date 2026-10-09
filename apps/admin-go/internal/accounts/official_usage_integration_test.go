//go:build integration

package accounts

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func usageTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(postgres.Open(
		"host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=admin_go sslmode=disable"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	tx := db.Begin()
	t.Cleanup(func() { tx.Rollback() })
	migration, err := os.ReadFile("../migrations/010_official_usage.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Exec(string(migration)).Error; err != nil {
		t.Fatal(err)
	}
	return tx
}

func usageTestOwner(t *testing.T, db *gorm.DB) string {
	t.Helper()
	owner := uuid.NewString()
	if err := db.Exec(`INSERT INTO users(id,email,"passwordHash") VALUES(?,?,?)`,
		owner, owner+"@example.test", "fixture-only").Error; err != nil {
		t.Fatal(err)
	}
	return owner
}

func readUsageTestSummary(t *testing.T, s *service, owner string, start int64) []officialAccountTotal {
	t.Helper()
	value, err := s.officialUsageSummary(owner, start, time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct{ Accounts []officialAccountTotal }
	if err = json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded.Accounts
}

func TestOfficialUsageReportAndPersistedDeclines(t *testing.T) {
	db := usageTestDB(t)
	owner, other := usageTestOwner(t, db), usageTestOwner(t, db)
	s := &service{deps: &platform.Dependencies{DB: db}}
	base := time.Now().Unix()/60*60 - 600
	report := officialUsageReport{DeviceName: "Office", Accounts: []accountUsageReport{{
		AccountID: "official", AccountLabel: "Official account", Minutes: []usageMinute{{Ts: base,
			Samples: [][3]float64{{20, 100, 2}}}},
		Quotas: []quotaObservation{{Ts: base + 10, Primary: usagePtr(80.0)}, {Ts: base + 50, Primary: usagePtr(60.0)}},
	}}}
	if err := s.storeUsageReport(owner, "desktop", report); err != nil {
		t.Fatal(err)
	}
	if err := s.storeUsageReport(owner, "desktop", report); err != nil {
		t.Fatal(err)
	}
	report.DeviceName = "Laptop"
	report.Accounts[0].Minutes[0].Samples = [][3]float64{{30, 200, 4}}
	if err := s.storeUsageReport(owner, "laptop", report); err != nil {
		t.Fatal(err)
	}
	totals := readUsageTestSummary(t, s, owner, base)
	if len(totals) != 1 || totals[0].Tokens != 300 || len(totals[0].Devices) != 2 {
		t.Fatal(totals)
	}
	if *totals[0].Primary.CapacityUSD != 30 || *totals[0].RemainingUSD != 18 {
		t.Fatal(totals[0])
	}
	if len(readUsageTestSummary(t, s, other, base)) != 0 {
		t.Fatal("owner isolation failed")
	}
	if got := readUsageTestSummary(t, s, owner, base+25)[0]; got.Tokens != 200 || got.CostUSD != 4 {
		t.Fatal("partial minute boundary lost", got)
	}
	var saved quotaDecline
	if err := db.Raw(`SELECT * FROM official_quota_declines WHERE owner_id=? AND is_current`, owner).
		Scan(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if saved.StartTs != base+10 || saved.EndTs != base+50 || saved.DeclinePercent != 20 || saved.ConsumedUSD != 6 {
		t.Fatal("decline evidence was not persisted", saved)
	}
	testLateUsageAndRebound(t, s, owner, report)
}

func testLateUsageAndRebound(t *testing.T, s *service, owner string, report officialUsageReport) {
	t.Helper()
	base := report.Accounts[0].Minutes[0].Ts
	report.Accounts[0].Minutes[0].Samples = [][3]float64{{30, 300, 7}, {55, 100, 1}}
	if err := s.storeUsageReport(owner, "laptop", report); err != nil {
		t.Fatal(err)
	}
	total := readUsageTestSummary(t, s, owner, base)[0]
	if total.Tokens != 500 || *total.Primary.CapacityUSD != 45 || *total.RemainingUSD != 26 {
		t.Fatal(total)
	}
	report.Accounts[0].Minutes = nil
	report.Accounts[0].Quotas = []quotaObservation{{Ts: base + 80, Primary: usagePtr(90.0)}}
	if err := s.storeUsageReport(owner, "laptop", report); err != nil {
		t.Fatal(err)
	}
	total = readUsageTestSummary(t, s, owner, base)[0]
	if total.RemainingUSD != nil || total.Primary.StartTs != base+80 {
		t.Fatal("old stage reused", total)
	}
	var counts struct {
		All     int
		Current int
	}
	if err := s.deps.DB.Raw(`SELECT COUNT(*) AS all, COUNT(*) FILTER (WHERE is_current) AS current
        FROM official_quota_declines WHERE owner_id=?`, owner).Scan(&counts).Error; err != nil {
		t.Fatal(err)
	}
	if counts.All != 2 || counts.Current != 1 {
		t.Fatal("phase history/current marker incorrect", counts)
	}
}
