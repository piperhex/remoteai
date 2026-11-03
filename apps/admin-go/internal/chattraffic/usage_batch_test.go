package chattraffic

import (
	"os"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
)

func TestReadUsagesBatchesAndDeduplicatesAccounts(t *testing.T) {
	store := testfixture.Open(t)
	if err := store.DB.Exec("CREATE TABLE users(id uuid PRIMARY KEY)").Error; err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../migrations/004_chat_user_traffic.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DB.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	owners := make([]string, 1000)
	rows := make([]map[string]interface{}, len(owners))
	for i := range owners {
		owners[i] = uuid.NewString()
		rows[i] = map[string]interface{}{"id": owners[i]}
	}
	if err := store.DB.Table("users").Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 31, 16, 0, 0, 0, time.UTC)
	month := MonthStart(now)
	if err := record(store.DB, owners[0], 123, now); err != nil {
		t.Fatal(err)
	}
	if err := record(store.DB, owners[0], 456, month.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	store.Queries.Count.Store(0)
	usage, err := ReadUsages(store.DB, append(owners, owners[0], ""), now)
	if err != nil || len(usage) != 1000 {
		t.Fatal(len(usage), err)
	}
	if got := store.Queries.Count.Load(); got != 4 {
		t.Fatalf("1000 owners issued %d SQL queries, want 4", got)
	}
	first := usage[owners[0]]
	if first.MonthUsedBytes != 123 || first.MonthlyLimitBytes != -1 || !first.ResetAt.Equal(month.AddDate(0, 1, 0)) {
		t.Fatal("month boundary/usage changed", first)
	}
	store.Queries.Count.Store(0)
	if _, err := ReadUsages(store.DB, nil, now); err != nil || store.Queries.Count.Load() != 0 {
		t.Fatal("idle push queried SQL", err)
	}
}
