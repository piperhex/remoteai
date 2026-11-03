package chattraffic

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

const settlementBatchSize = 256
const settlementTimeout = 10 * time.Second

// Settled metadata only needs to outlive pending socket writes and their recovery grace.
const budgetRetention = 10 * time.Minute

// Meter reserves bounded SQL budgets, spends them atomically in Redis and settles in batches.
// No accounting lock is held across a network write. Unknown crash outcomes consume reserved credit.
type Meter struct {
	db           *gorm.DB
	redis        *redis.Client
	accounts     sync.Map
	flushGate    contextGate
	reservations contextGate
	completions  contextGate
}

func NewMeter(db *gorm.DB, client *redis.Client) *Meter {
	return &Meter{db: db, redis: client, flushGate: make(contextGate, 1),
		reservations: make(contextGate, accountingConcurrency), completions: make(contextGate, accountingConcurrency)}
}

func (meter *Meter) Transmit(ctx context.Context, owner string, bytes int, write func() error) error {
	if bytes <= 0 || int64(bytes) > budgetBytes || meter.redis == nil {
		return ErrState
	}
	value, ticket, err := meter.reserve(ctx, owner, bytes)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return errors.Join(err, meter.complete(ctx, value, ticket, false))
	}
	if !time.Now().Before(value.ExpiresAt) {
		// A delayed predebit reply must not authorize a new write in a later hour/month.
		return errors.Join(ErrState, meter.complete(ctx, value, ticket, false))
	}
	if err := write(); err != nil {
		// The callback cannot prove that zero bytes reached the peer. Keep this
		// ticket pending; recovery conservatively charges it after the write grace.
		return err
	}
	return meter.complete(ctx, value, ticket, true)
}

func (meter *Meter) openBudget(ctx context.Context, owner string, bytes int) (budget, string, error) {
	epoch, err := readEpoch(ctx, meter.redis, owner)
	if err != nil {
		return budget{}, "", err
	}
	value, err := allocate(meter.db.WithContext(ctx), owner, bytes)
	if err != nil {
		return budget{}, "", err
	}
	return value, epoch, initializeBudget(ctx, meter.redis, value)
}

func (meter *Meter) take(ctx context.Context, grant *budgetGrant, bytes int, ticket string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	value, err := takeScript.Run(ctx, meter.redis,
		[]string{budgetKey(grant.value), epochKey(grant.value.UserID)}, grant.epoch, bytes, ticket).Int()
	return value == 1, err
}

func (meter *Meter) retire(ctx context.Context, value budget) error {
	state, err := sealScript.Run(ctx, meter.redis, []string{budgetKey(value)}).Int64Slice()
	if err != nil {
		return err
	}
	if len(state) != 2 {
		return ErrState
	}
	spent, pending := state[0], state[1]
	if pending > 0 && time.Now().Before(value.ExpiresAt.Add(abandonedWriteGrace)) {
		return nil
	}
	if spent < 0 {
		spent = value.Bytes
	} else {
		spent += pending
	}
	if err := settle(meter.db.WithContext(ctx), value, spent); err != nil {
		return err
	}
	// Keep a tombstone so a delayed completion cannot recreate credit after SQL settlement.
	return meter.redis.Expire(ctx, budgetKey(value), abandonedWriteGrace).Err()
}

// Flush also recovers allocations from stopped processes. Only expired grants are touched.
func (meter *Meter) Flush() error {
	return meter.FlushContext(context.Background())
}

// FlushContext preserves the settlement deadline while allowing maintenance shutdown to interrupt storage waits.
func (meter *Meter) FlushContext(parent context.Context) error {
	if meter.redis == nil {
		return ErrState
	}
	ctx, cancel := context.WithTimeout(parent, settlementTimeout)
	defer cancel()
	if err := meter.flushGate.lock(ctx); err != nil {
		return err
	}
	defer meter.flushGate.unlock()
	var values []budget
	if err := meter.db.WithContext(ctx).Table("chat_relay_budgets").
		Where("NOT closed AND expires_at <= ?", time.Now()).Order("expires_at").
		Limit(settlementBatchSize).Find(&values).Error; err != nil {
		return err
	}
	for _, value := range values {
		if err := meter.retire(ctx, value); err != nil {
			return err
		}
	}
	meter.forgetIdle()
	return meter.db.WithContext(ctx).Exec(`DELETE FROM chat_relay_budgets
 WHERE closed AND expires_at < ?`, time.Now().Add(-budgetRetention)).Error
}

func (meter *Meter) forgetIdle() {
	meter.accounts.Range(func(owner, entry interface{}) bool {
		account := entry.(*accountBudget)
		if !account.renew.tryLock() {
			return true
		}
		defer account.renew.unlock()
		grant := account.current.Load()
		if grant == nil || time.Now().After(grant.value.ExpiresAt.Add(abandonedWriteGrace)) {
			// Every grant is durable; an in-flight caller retaining this entry is still recoverable.
			meter.accounts.CompareAndDelete(owner, entry)
		}
		return true
	})
}

// Close retires this process's grants; unfinished writes are recovered by the next maintenance pass.
func (meter *Meter) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), settlementTimeout)
	defer cancel()
	var result error
	meter.accounts.Range(func(_, entry interface{}) bool {
		account := entry.(*accountBudget)
		if err := account.renew.lock(ctx); err != nil {
			result = errors.Join(result, err)
			return false
		}
		defer account.renew.unlock()
		if grant := account.current.Load(); grant != nil {
			result = errors.Join(result, meter.retire(ctx, grant.value))
		}
		return true
	})
	return result
}
