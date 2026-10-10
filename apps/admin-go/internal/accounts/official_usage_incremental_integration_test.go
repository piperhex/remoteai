//go:build integration

package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestIncrementalUsageMatchesCompleteHistory(t *testing.T) {
	db := usageTestDB(t)
	owner := usageTestOwner(t, db)
	s := &service{deps: &platform.Dependencies{DB: db}}
	base := time.Now().Unix()/60*60 - 3600
	random := rand.New(rand.NewPCG(17, 29))
	for step := range 45 {
		point := base + int64(step)*60
		if step%4 == 0 {
			point = base + int64(random.IntN(step+1))*60
		}
		account := accountUsageReport{AccountID: "account", AccountLabel: "Account",
			Minutes: []usageMinute{{Ts: point, Samples: [][3]float64{{10, 100, float64(step + 1)}, {50, 20, 0.25}}}}}
		if step%3 != 1 {
			account.Quotas = []quotaObservation{{Ts: point + 10,
				Primary: usagePtr(float64(100 - step%7*10)), Secondary: usagePtr(float64(100 - step%11*5))}}
		}
		if step%5 == 0 && len(account.Quotas) > 0 {
			account.Quotas[0].Primary = nil
		}
		report := officialUsageReport{Version: 2, DeviceName: "Desktop", Accounts: []accountUsageReport{account}}
		device := fmt.Sprintf("device-%d", step%3)
		for range 2 {
			if err := s.storeUsageReport(t.Context(), owner, device, report); err != nil {
				t.Fatal(step, err)
			}
			assertUsageMatchesHistory(t, db, owner)
		}
	}
}

func TestConflictingQuotaHistorySurvivesMissingObservations(t *testing.T) {
	db := usageTestDB(t)
	owner := usageTestOwner(t, db)
	s := &service{deps: &platform.Dependencies{DB: db}}
	base := time.Now().Unix() - 600
	steps := []struct {
		device string
		point  quotaObservation
	}{
		{"first", quotaObservation{Ts: base, Primary: usagePtr(80.0)}},
		{"second", quotaObservation{Ts: base, Primary: usagePtr(60.0)}},
		{"first", quotaObservation{Ts: base + 60}},
		{"first", quotaObservation{Ts: base + 120}},
		{"second", quotaObservation{Ts: base, Primary: usagePtr(80.0)}},
	}
	for _, step := range steps {
		report := officialUsageReport{Version: 2, Accounts: []accountUsageReport{
			{AccountID: "account", Quotas: []quotaObservation{step.point}},
		}}
		if err := s.storeUsageReport(t.Context(), owner, step.device, report); err != nil {
			t.Fatal(err)
		}
		assertUsageMatchesHistory(t, db, owner)
	}
}

func assertUsageMatchesHistory(t *testing.T, db *gorm.DB, owner string) {
	t.Helper()
	var points []quotaObservation
	if err := db.Raw(`SELECT ts,primary_remaining AS "primary",secondary_remaining AS "secondary",
		primary_reset,secondary_reset FROM official_quota_v2_observations WHERE owner_id=? ORDER BY ts`,
		owner).Scan(&points).Error; err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		MinuteTs int64
		Samples  string
	}
	if err := db.Raw(`SELECT minute_ts,samples::text FROM official_usage_v2_minutes WHERE owner_id=?`,
		owner).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	current, err := readCurrentDeclines(db, owner, "account")
	if err != nil {
		t.Fatal(err)
	}
	actual := make(map[quotaWindow]quotaDecline)
	for _, phase := range current {
		actual[phase.QuotaWindow] = phase.Phase
	}
	for _, window := range []quotaWindow{primaryQuota, secondaryQuota} {
		expected := latestQuotaDecline(mergeQuotaObservations(points), window)
		got, exists := actual[window]
		if expected == nil {
			if exists {
				t.Fatal("unexpected decline", window, got)
			}
			continue
		}
		for _, row := range rows {
			minute := usageMinute{Ts: row.MinuteTs}
			if err := json.Unmarshal([]byte(row.Samples), &minute.Samples); err != nil {
				t.Fatal(err)
			}
			addMinuteToDecline(expected, minute)
		}
		if !exists || math.Abs(got.ConsumedUSD-expected.ConsumedUSD) > 1e-8 {
			t.Fatalf("cost differs from complete history: %s actual=%+v expected=%+v", window, got, expected)
		}
		got.ConsumedUSD = expected.ConsumedUSD
		if !reflect.DeepEqual(got, *expected) {
			t.Fatalf("phase differs from complete history: %s actual=%+v expected=%+v", window, got, expected)
		}
	}
}

type usageQueryRecorder struct {
	logger.Interface
	queries []string
}

func (r *usageQueryRecorder) Trace(_ context.Context, _ time.Time, query func() (string, int64), _ error) {
	sql, _ := query()
	r.queries = append(r.queries, sql)
}

func TestUsageBatchingAndSummaryQueryCount(t *testing.T) {
	db := usageTestDB(t)
	owner := usageTestOwner(t, db)
	trace := &usageQueryRecorder{Interface: logger.Default.LogMode(logger.Silent)}
	s := &service{deps: &platform.Dependencies{DB: db.Session(&gorm.Session{Logger: trace})}}
	base := time.Now().Unix()/60*60 - 120000
	account := accountUsageReport{AccountID: "account", Quotas: []quotaObservation{
		{Ts: base, Primary: usagePtr(80.0)}, {Ts: base + 10, Primary: usagePtr(60.0)}}}
	for i := range 1000 {
		account.Minutes = append(account.Minutes, usageMinute{Ts: base + int64(i)*60,
			Samples: [][3]float64{{20, 100, 1}}})
	}
	report := officialUsageReport{Version: 2, Accounts: []accountUsageReport{account}}
	if err := s.storeUsageReport(t.Context(), owner, "desktop", report); err != nil {
		t.Fatal(err)
	}
	if count := countUsageQueries(trace.queries, `INSERT INTO "official_usage_v2_minutes"`); count != 1 {
		t.Fatalf("1000 minutes should use one batch insert, got %d", count)
	}
	trace.queries = nil
	if err := s.storeUsageReport(t.Context(), owner, "desktop", report); err != nil {
		t.Fatal(err)
	}
	if countUsageQueries(trace.queries, "ORDER BY ts") != 0 ||
		countUsageQueries(trace.queries, "INSERT INTO official_quota_v2_declines") != 0 {
		t.Fatal("unchanged retry rebuilt quota history")
	}
	for i := range 100 {
		if err := db.Exec(`INSERT INTO official_usage_v2_accounts(owner_id,account_id,label) VALUES(?,?,?)`,
			owner, fmt.Sprintf("empty-%d", i), "Empty").Error; err != nil {
			t.Fatal(err)
		}
	}
	trace.queries = nil
	totals := readUsageTestSummary(t, s, owner, base)
	if len(totals) != 101 || totals[0].Tokens != 100000 || totals[0].Primary.ConsumedUSD != 1000 {
		t.Fatal("batch summary changed results", totals[0])
	}
	if count := countUsageQueries(trace.queries, "SELECT"); count != 3 {
		t.Fatalf("101 accounts should still use 3 SELECTs, got %d", count)
	}
}

func countUsageQueries(queries []string, prefix string) int {
	count := 0
	for _, query := range queries {
		if strings.HasPrefix(query, prefix) || prefix == "ORDER BY ts" && strings.Contains(query, prefix) {
			count++
		}
	}
	return count
}
