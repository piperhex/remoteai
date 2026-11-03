package chattraffic

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestConcurrentBaselineMetersCannotOverspend(t *testing.T) {
	db, owner := trafficFixture(t)
	const quota = 1000
	setQuota(t, db, owner, quota)
	meters := []*Meter{trafficMeter(t, db, owner), trafficMeter(t, db, owner), trafficMeter(t, db, owner)}
	var workers sync.WaitGroup
	var sent atomic.Int64
	for index := range 120 {
		workers.Go(func() {
			err := meters[index%len(meters)].Transmit(t.Context(), owner, 10, func() error {
				sent.Add(10)
				return nil
			})
			if err != nil && !errors.Is(err, ErrState) && !errors.Is(err, ErrQuota) {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	if sent.Load() > quota || sent.Load() == 0 {
		t.Fatalf("sent=%d quota=%d", sent.Load(), quota)
	}
	for _, meter := range meters {
		if err := meter.Close(); err != nil {
			t.Fatal(err)
		}
	}
	recoverTrafficBudgets(t, meters[0], owner)
	assertUsage(t, db, owner, sent.Load())
}

func TestCompletionFailureRecoversWithoutReusingCredit(t *testing.T) {
	for _, lostReply := range []bool{false, true} {
		t.Run(map[bool]string{false: "not-executed", true: "reply-lost"}[lostReply], func(t *testing.T) {
			db, owner := trafficFixture(t)
			setQuota(t, db, owner, 100)
			meter := trafficMeter(t, db, owner)
			failure := errors.New("completion unavailable")
			meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
				args := cmd.Args()
				if len(args) < 2 || (args[1] != finishScript.Hash() && args[1] != finishBudget) {
					return next(ctx, cmd)
				}
				if lostReply {
					if err := next(ctx, cmd); err != nil {
						return err
					}
				}
				return failure
			}))
			if err := meter.Transmit(t.Context(), owner, 100, func() error { return nil }); !errors.Is(err, failure) {
				t.Fatal(err)
			}
			err := meter.Transmit(t.Context(), owner, 1, func() error { t.Error("reused written bytes"); return nil })
			if !errors.Is(err, ErrState) && !errors.Is(err, ErrQuota) {
				t.Fatal(err)
			}
			recoverTrafficBudgets(t, meter, owner)
			assertUsage(t, db, owner, 100)
		})
	}
}

func TestExpiredPreviousMonthGrantCannotFundCurrentTraffic(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 1)
	meter := trafficMeter(t, db, owner)
	previousHour := MonthStart(time.Now()).Add(-time.Hour).UTC()
	value := budget{ID: uuid.NewString(), UserID: owner, Bytes: 10,
		HourStart: previousHour, ExpiresAt: previousHour.Add(time.Hour)}
	if err := db.Table("chat_relay_budgets").Create(&value).Error; err != nil {
		t.Fatal(err)
	}
	epoch, err := readEpoch(t.Context(), meter.redis, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := initializeBudget(t.Context(), meter.redis, value); err != nil {
		t.Fatal(err)
	}
	if err := meter.redis.HSet(t.Context(), budgetKey(value), "spent", 7, "remaining", 3).Err(); err != nil {
		t.Fatal(err)
	}
	account := &accountBudget{renew: make(contextGate, 1)}
	account.current.Store(&budgetGrant{value, epoch})
	meter.accounts.Store(owner, account)
	if err := meter.Transmit(t.Context(), owner, 1, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	current := account.current.Load().value
	if !current.HourStart.Equal(time.Now().UTC().Truncate(time.Hour)) || current.ExpiresAt.After(current.HourStart.Add(time.Hour)) {
		t.Fatal("new grant crossed the hourly boundary:", current)
	}
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 1)
	previous, err := ReadUsage(db, owner, previousHour)
	if err != nil || previous.MonthUsedBytes != 7 {
		t.Fatalf("previous month settlement=%+v: %v", previous, err)
	}
}

func TestRedisUnavailableNeverCallsWriter(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1})
	defer client.Close()
	meter := NewMeter(nil, client)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	err := meter.Transmit(ctx, "owner", 10, func() error { t.Error("wrote without Redis authority"); return nil })
	if err == nil {
		t.Fatal("unavailable Redis accepted")
	}
	waitAccountingIdle(t, meter)
}

func TestExpiredPredebitReplyCannotStartWrite(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := trafficMeter(t, db, owner)
	value, epoch, err := meter.openBudget(t.Context(), owner, 10)
	if err != nil {
		t.Fatal(err)
	}
	// Shorten the caller's validity window, then delay the confirmed Redis reply.
	// The real Redis grant remains backed by the same durable allocation.
	value.ExpiresAt = time.Now().Add(30 * time.Millisecond)
	account := &accountBudget{renew: make(contextGate, 1)}
	account.current.Store(&budgetGrant{value, epoch})
	meter.accounts.Store(owner, account)
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		err := next(ctx, cmd)
		if isTake(cmd) && err == nil {
			time.Sleep(60 * time.Millisecond)
		}
		return err
	}))
	err = meter.Transmit(t.Context(), owner, 10, func() error { t.Error("expired predebit wrote"); return nil })
	if !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	assertTicketState(t, meter, owner, 0, 0)
	if err := meter.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 0)
}
