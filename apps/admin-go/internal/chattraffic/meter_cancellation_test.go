package chattraffic

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func recoverTrafficBudgets(t *testing.T, meter *Meter, owner string) {
	t.Helper()
	if err := meter.db.Table("chat_relay_budgets").Where("user_id=?", owner).
		Update("expires_at", time.Now().Add(-abandonedWriteGrace-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 { // Recovery must be idempotent even after uncertain outcomes.
		if err := meter.Flush(); err != nil {
			t.Fatal(err)
		}
	}
	var open int64
	if err := meter.db.Table("chat_relay_budgets").Where("user_id=? AND NOT closed", owner).
		Count(&open).Error; err != nil || open != 0 {
		t.Fatalf("unrecovered budgets=%d: %v", open, err)
	}
}

func waitAccountingIdle(t *testing.T, meter *Meter) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(meter.reservations)+len(meter.completions) > 0 {
		if time.Now().After(deadline) {
			t.Fatal("accounting workers did not drain")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestReservationWaitHonorsCancellation(t *testing.T) {
	for _, alreadyCancelled := range []bool{true, false} {
		t.Run(map[bool]string{true: "before-queue", false: "while-queued"}[alreadyCancelled], func(t *testing.T) {
			meter := NewMeter(nil, nil)
			account := &accountBudget{renew: make(contextGate, 1)}
			account.renew.tryLock()
			meter.accounts.Store("owner", account)
			defer account.renew.unlock()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if alreadyCancelled {
				cancel()
			}
			done := make(chan error, 1)
			go func() { _, _, err := meter.reserve(ctx, "owner", 1); done <- err }()
			if !alreadyCancelled {
				time.Sleep(10 * time.Millisecond)
				cancel()
			}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
			case <-time.After(150 * time.Millisecond):
				t.Fatal("cancelled reservation waited for account renewal")
			}
			waitAccountingIdle(t, meter)
		})
	}
}

func TestCancelledPrewriteRefundsConfirmedTicket(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	meter := trafficMeter(t, db, owner)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		err := next(ctx, cmd)
		if isTake(cmd) && err == nil {
			cancel() // Confirmed predebit, but the socket callback has not run.
		}
		return err
	}))
	err := meter.Transmit(ctx, owner, 100, func() error { t.Error("write after cancellation"); return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	waitAccountingIdle(t, meter)
	assertTicketState(t, meter, owner, 0, 0)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 0)
}

func TestCancelledBudgetInitializationRecoversUnusedCredit(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	meter := trafficMeter(t, db, owner)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		err := next(ctx, cmd)
		args := cmd.Args()
		if err == nil && len(args) > 1 && (args[1] == initializeScript.Hash() || args[1] == initializeGrant) {
			cancel()
		}
		return err
	}))
	err := meter.Transmit(ctx, owner, 100, func() error { t.Error("cancelled allocation wrote"); return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	waitAccountingIdle(t, meter)
	assertTicketState(t, meter, owner, 0, 0)
	recoverTrafficBudgets(t, meter, owner)
	assertUsage(t, db, owner, 0)
	replacement := trafficMeter(t, db, owner)
	if err := replacement.Transmit(t.Context(), owner, 100, func() error { return nil }); err != nil {
		t.Fatal("unused credit was not recovered:", err)
	}
	if err := replacement.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100)
}

func TestCancellationAfterWriteStillSettles(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	err := meter.Transmit(ctx, owner, 100, func() error { cancel(); return nil })
	if err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	waitAccountingIdle(t, meter)
	assertTicketState(t, meter, owner, 0, 100)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100)
}

func TestCancellationDuringCompletionDoesNotWaitForStorage(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		args := cmd.Args()
		if len(args) > 1 && (args[1] == finishScript.Hash() || args[1] == finishBudget) {
			once.Do(func() { close(started); <-release })
		}
		return next(ctx, cmd)
	}))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- meter.Transmit(ctx, owner, 100, func() error { return nil }) }()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Error(err)
		}
	case <-time.After(150 * time.Millisecond):
		t.Error("cancelled caller waited for completion storage")
	}
	close(release)
	waitAccountingIdle(t, meter)
	assertTicketState(t, meter, owner, 0, 100)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 100)
}

func TestAmbiguousPredebitIsRecoveredWithoutForwarding(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	meter := trafficMeter(t, db, owner)
	failure := errors.New("predebit reply lost")
	var once sync.Once
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		err := next(ctx, cmd)
		if isTake(cmd) && err == nil {
			once.Do(func() { err = failure })
		}
		return err
	}))
	err := meter.Transmit(t.Context(), owner, 100, func() error { t.Error("ambiguous take wrote"); return nil })
	if !errors.Is(err, failure) {
		t.Fatal(err)
	}
	assertTicketState(t, meter, owner, 100, 0)
	err = meter.Transmit(t.Context(), owner, 1, func() error { t.Error("uncertain credit reused"); return nil })
	if !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	recoverTrafficBudgets(t, meter, owner)
	assertUsage(t, db, owner, 100)
}

func isTake(cmd redis.Cmder) bool {
	args := cmd.Args()
	return len(args) > 1 && (args[1] == takeScript.Hash() || args[1] == takeBudget)
}

func assertTicketState(t *testing.T, meter *Meter, owner string, pending, spent int64) {
	t.Helper()
	entry, _ := meter.accounts.Load(owner)
	grant := entry.(*accountBudget).current.Load()
	key := budgetKey(grant.value)
	for field, expected := range map[string]int64{"pending": pending, "spent": spent} {
		got, err := meter.redis.HGet(t.Context(), key, field).Int64()
		if err != nil || got != expected {
			t.Fatalf("%s=%d, want %d: %v", field, got, expected, err)
		}
	}
	if pending == 0 {
		fields, err := meter.redis.HLen(t.Context(), key).Result()
		if err != nil || fields != 6 {
			t.Fatalf("ticket leaked: fields=%d: %v", fields, err)
		}
	}
}
