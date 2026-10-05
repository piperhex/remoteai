package chattraffic

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMonthlyBoundaryAndAllowance(t *testing.T) {
	now := time.Date(2026, 9, 30, 16, 0, 0, 0, time.UTC)
	if got := MonthStart(now).Format(time.RFC3339); got != "2026-10-01T00:00:00+08:00" {
		t.Fatal(got)
	}
	for _, test := range []struct {
		used, limit int64
		bytes       int
		allowed     bool
	}{
		{100, -1, 10, true}, {0, 0, 1, false}, {9, 10, 1, true}, {9, 10, 2, false},
		{11, 10, 1, false}, {0, -1, 0, false},
	} {
		if Allowed(Usage{MonthUsedBytes: test.used, MonthlyLimitBytes: test.limit}, test.bytes) != test.allowed {
			t.Fatalf("unexpected allowance: %+v", test)
		}
	}
}

func TestDailyIncludesEveryHourInBeijing(t *testing.T) {
	month := time.Date(2024, 2, 1, 0, 0, 0, 0, Beijing)
	rows := []Hour{{month.UTC(), 10}, {month.UTC().Add(23 * time.Hour), 20}, {month.UTC().Add(24 * time.Hour), 30}}
	days := Daily(rows, month)
	if len(days) != 29 || len(days[0].HourlyBytes) != 24 || days[0].Bytes != 30 || days[1].Bytes != 30 {
		t.Fatal(days)
	}
	if days[0].HourlyBytes[23] != 20 || days[2].Bytes != 0 {
		t.Fatal("hour boundary or zero filling")
	}
}

// Integration tests use only the repository's fixed, local PostgreSQL fixture.
func trafficFixture(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	if os.Getenv("ADMIN_GO_TRAFFIC_DB_TEST") != "1" {
		t.Skip("local PostgreSQL fixture is opt-in")
	}
	db, err := gorm.Open(postgres.Open(
		"host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=admin_go sslmode=disable"))
	if err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../migrations/004_chat_user_traffic.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	budgets, err := os.ReadFile("../migrations/005_chat_relay_budgets.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(string(budgets)).Error; err != nil {
		t.Fatal(err)
	}
	leases, err := os.ReadFile("../migrations/009_chat_bulk_leases.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(string(leases)).Error; err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	if err = db.Exec(`INSERT INTO users(id,email,"passwordHash",role) VALUES(?,?,?,'user')`,
		id, id+"@traffic-fixture.test", "unused").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Exec("DELETE FROM users WHERE id=?", id).Error; err != nil {
			t.Error(err)
		}
		pool, err := db.DB()
		if err == nil {
			err = pool.Close()
		}
		if err != nil {
			t.Error(err)
		}
	})
	return db, id
}

func TestConcurrentQuotaAndFailedWrites(t *testing.T) {
	db, id := trafficFixture(t)
	meter := trafficMeter(t, db, id)
	setQuota(t, db, id, 100)
	failure := errors.New("socket write failed")
	if err := meter.Transmit(t.Context(), id, 25, func() error { return failure }); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	var sent atomic.Int64
	var workers sync.WaitGroup
	for range 20 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			err := meter.Transmit(t.Context(), id, 10, func() error { sent.Add(10); return nil })
			if err != nil && !errors.Is(err, ErrQuota) && !errors.Is(err, ErrState) {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	usage, err := ReadUsage(db, id, time.Now())
	if err != nil || sent.Load() != 100 || usage.MonthUsedBytes != 100 {
		t.Fatalf("%+v %d %v", usage, sent.Load(), err)
	}
	daily, err := ReadDaily(db, id, MonthStart(time.Now()))
	var total int64
	for _, day := range daily {
		total += day.Bytes
	}
	if err != nil || total != 100 {
		t.Fatalf("hourly total: %d %v", total, err)
	}
}

func TestUnlimitedAndNextMonth(t *testing.T) {
	db, id := trafficFixture(t)
	meter := trafficMeter(t, db, id)
	if err := meter.Transmit(t.Context(), id, 4096, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	usage, err := ReadUsage(db, id, time.Now())
	if err != nil || usage.MonthlyLimitBytes != -1 || usage.MonthUsedBytes != 4096 {
		t.Fatalf("%+v %v", usage, err)
	}
	nextMonth := MonthStart(time.Now()).AddDate(0, 1, 0)
	usage, err = ReadUsage(db, id, nextMonth)
	if err != nil || usage.MonthUsedBytes != 0 {
		t.Fatalf("new month: %+v %v", usage, err)
	}
	rows := []UserTraffic{}
	if err := UserQuery(db, MonthStart(time.Now())).Where("u.id=?", id).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TotalBytes != 4096 {
		t.Fatal(rows)
	}
}

func trafficMeter(t *testing.T, db *gorm.DB, owner string) *Meter {
	t.Helper()
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:16380"})
	if err := client.Ping(t.Context()).Err(); err != nil {
		t.Fatal(err)
	}
	meter := NewMeter(db, client)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		keys, err := client.Keys(ctx, "chat:budget:{"+owner+"}:*").Result()
		if err == nil && len(keys) > 0 {
			err = client.Del(ctx, keys...).Err()
		}
		if err != nil {
			t.Error(err)
		}
		if err := client.Close(); err != nil {
			t.Error(err)
		}
	})
	return meter
}

func setQuota(t *testing.T, db *gorm.DB, owner string, limit int64) {
	t.Helper()
	err := db.Exec("INSERT INTO chat_relay_user_limits(user_id,monthly_limit_bytes) VALUES(?,?)", owner, limit).Error
	if err != nil {
		t.Fatal(err)
	}
}
