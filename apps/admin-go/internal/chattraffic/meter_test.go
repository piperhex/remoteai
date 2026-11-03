package chattraffic

import (
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestSlowSocketDoesNotHoldQuotaLock(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		done <- meter.Transmit(t.Context(), owner, 10, func() error {
			close(started)
			<-release
			return nil
		})
	}()
	<-started
	fast := make(chan error, 1)
	go func() { fast <- meter.Transmit(t.Context(), owner, 20, func() error { return nil }) }()
	select {
	case err := <-fast:
		if err != nil {
			t.Error(err)
		}
	case <-time.After(2 * time.Second):
		t.Error("independent write waited for slow socket")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 30)
}

func TestRedisLossCannotReissueUnsettledQuota(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	meter := trafficMeter(t, db, owner)
	if err := meter.Transmit(t.Context(), owner, 10, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	entry, _ := meter.accounts.Load(owner)
	value := entry.(*accountBudget).current.Load().value
	if err := meter.redis.Del(t.Context(), budgetKey(value), epochKey(owner)).Err(); err != nil {
		t.Fatal(err)
	}
	err := meter.Transmit(t.Context(), owner, 10, func() error { t.Error("lost credit was reused"); return nil })
	if !errors.Is(err, ErrQuota) {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100) // Unknown outcomes conservatively consume the durable grant.
}

func TestLimitChangeRevokesOldGrantsAndSettlementIsIdempotent(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	if err := meter.Transmit(t.Context(), owner, 10, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	err := ChangeLimit(db.WithContext(t.Context()), meter.redis, owner, func(tx *gorm.DB) error {
		return tx.Exec("UPDATE chat_relay_user_limits SET monthly_limit_bytes=10 WHERE user_id=?", owner).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	err = meter.Transmit(t.Context(), owner, 1, func() error { t.Error("revoked grant used"); return nil })
	if !errors.Is(err, ErrQuota) {
		t.Fatal(err)
	}
	if err = meter.Close(); err != nil {
		t.Fatal(err)
	}
	if err = meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 10)
}

func TestMultipleMetersShareQuotaAndRecoverExpiredGrants(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	first, second := trafficMeter(t, db, owner), trafficMeter(t, db, owner)
	if err := first.Transmit(t.Context(), owner, 40, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := second.Transmit(t.Context(), owner, 70, func() error { return nil }); !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE chat_relay_budgets SET expires_at=? WHERE user_id=?",
		time.Now().Add(-time.Second), owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := second.Flush(); err != nil {
		t.Fatal(err)
	}
	if err := second.Transmit(t.Context(), owner, 60, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100)
}

func TestPendingGrantShortageCanRetryWithoutUsageChanging(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	first, second := trafficMeter(t, db, owner), trafficMeter(t, db, owner)
	value, ticket, err := first.reserve(t.Context(), owner, 100)
	if err != nil {
		t.Fatal(err)
	}
	err = second.Transmit(t.Context(), owner, 1, func() error { t.Error("reserved quota reused"); return nil })
	if !errors.Is(err, ErrState) || errors.Is(err, ErrQuota) {
		t.Fatalf("temporary shortage must not permanently block clients: %v", err)
	}
	if err := finishReservation(first.redis, value, ticket, false); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 0)
	if err := second.Transmit(t.Context(), owner, 100, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100)
}

func assertUsage(t *testing.T, db *gorm.DB, owner string, expected int64) {
	t.Helper()
	usage, err := ReadUsage(db, owner, time.Now())
	if err != nil || usage.MonthUsedBytes != expected {
		t.Fatalf("usage=%+v error=%v", usage, err)
	}
}

func TestReservationAndCompletionRetriesAreIdempotent(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	value, ticket, err := meter.reserve(t.Context(), owner, 10)
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := meter.accounts.Load(owner)
	grant := entry.(*accountBudget).current.Load()
	if ok, err := meter.take(t.Context(), grant, 10, ticket); err != nil || !ok {
		t.Fatal(ok, err)
	}
	for range 2 {
		if err := finishReservation(meter.redis, value, ticket, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 10)
}

func TestManyFramesUseOneDatabaseGrant(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	for range 100 {
		if err := meter.Transmit(t.Context(), owner, 100, func() error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	if err := db.Table("chat_relay_budgets").Where("user_id=?", owner).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("100 frames allocated %d SQL budgets", count)
	}
	assertUsage(t, db, owner, 0)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 10000)
}

func TestRedisRestartCannotReuseAnOlderPersistentCounter(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	meter := trafficMeter(t, db, owner)
	if err := meter.Transmit(t.Context(), owner, 10, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	entry, _ := meter.accounts.Load(owner)
	value := entry.(*accountBudget).current.Load().value
	// Simulate restoration of an older counter from a different Redis process, without restarting the fixture.
	if err := meter.redis.HSet(t.Context(), budgetKey(value), "server", "previous-redis-process",
		"remaining", 100, "spent", 0).Err(); err != nil {
		t.Fatal(err)
	}
	err := meter.Transmit(t.Context(), owner, 10, func() error { t.Error("restored credit reused"); return nil })
	if !errors.Is(err, ErrQuota) {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100)
}
