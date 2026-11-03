package chattraffic

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestSameAccountTakesRunConcurrently(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	if err := meter.Transmit(t.Context(), owner, 1, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		if isTake(cmd) {
			blocked := false
			once.Do(func() { blocked = true; close(started) })
			if blocked {
				<-release // One Redis round trip stalls; a different stream must proceed.
			}
		}
		return next(ctx, cmd)
	}))
	done := make(chan error, 1)
	go func() { done <- meter.Transmit(t.Context(), owner, 1, func() error { return nil }) }()
	<-started
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	err := meter.Transmit(ctx, owner, 1, func() error { return nil })
	close(release)
	if err != nil {
		t.Error("independent take serialized behind slow Redis request:", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 3)
}

func TestCancelledStorageWorkIsBounded(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1})
	defer client.Close()
	meter := NewMeter(nil, client)
	account := &accountBudget{renew: make(contextGate, 1)}
	account.current.Store(&budgetGrant{value: budget{ID: "bounded", UserID: "owner"}})
	meter.accounts.Store("owner", account)
	started := make(chan struct{}, accountingConcurrency)
	release := make(chan struct{})
	var calls atomic.Int64
	client.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, _ redis.ProcessHook) error {
		calls.Add(1)
		started <- struct{}{}
		<-release // Deliberately emulate storage ignoring cancellation.
		return ctx.Err()
	}))
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, accountingConcurrency)
	for range accountingConcurrency {
		go func() { _, _, err := meter.reserve(ctx, "owner", 1); done <- err }()
	}
	for range accountingConcurrency {
		<-started
	}
	cancel()
	for range accountingConcurrency {
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Error(err)
		}
	}
	deadline, stop := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer stop()
	_, _, err := meter.reserve(deadline, "owner", 1)
	if !errors.Is(err, context.DeadlineExceeded) || calls.Load() != accountingConcurrency {
		t.Errorf("unbounded storage work: calls=%d err=%v", calls.Load(), err)
	}
	close(release)
	waitAccountingIdle(t, meter)
}

func TestRealRedisPauseHonorsRelayDeadline(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	if err := meter.Transmit(t.Context(), owner, 1, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := meter.redis.Do(t.Context(), "CLIENT", "PAUSE", 350, "ALL").Err(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := meter.Transmit(ctx, owner, 10, func() error { t.Error("wrote after Redis deadline"); return nil })
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 200*time.Millisecond {
		t.Fatalf("Redis pause delayed cancellation: %s %v", time.Since(started), err)
	}
	t.Logf("350ms real Redis pause: relay deadline returned in %s", time.Since(started))
	waitAccountingIdle(t, meter)
	assertTicketState(t, meter, owner, 0, 1)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 1)
}

func TestSQLRenewalWaitDoesNotBlockOtherAccounts(t *testing.T) {
	db, owner := trafficFixture(t)
	_, other := trafficFixture(t)
	setQuota(t, db, owner, 100)
	meter := trafficMeter(t, db, owner)
	trafficMeter(t, db, other) // Cleanup the second account's Redis keys.
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := lockUser(tx, owner); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- meter.Transmit(ctx, owner, 10, func() error { t.Error("cancelled SQL allocation wrote"); return nil })
	}()
	otherCtx, stop := context.WithTimeout(t.Context(), time.Second)
	defer stop()
	if err := meter.Transmit(otherCtx, other, 10, func() error { return nil }); err != nil {
		t.Error("other account blocked by SQL row lock:", err)
	}
	if err := <-done; !errors.Is(err, context.DeadlineExceeded) {
		t.Error(err)
	}
	waitAccountingIdle(t, meter)
	if err := tx.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	recoverTrafficBudgets(t, meter, owner)
	assertUsage(t, db, owner, 0)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, other, 10)
}
