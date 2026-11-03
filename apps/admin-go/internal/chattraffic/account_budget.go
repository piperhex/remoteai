package chattraffic

import (
	"context"
	"sync/atomic"

	"github.com/google/uuid"
)

// Published grants are immutable. Redis, not the process-local coordinator,
// atomically arbitrates tickets against the durable SQL credit and quota epoch.
type budgetGrant struct {
	value budget
	epoch string
}

type accountBudget struct {
	current atomic.Pointer[budgetGrant]
	renew   contextGate
}

// Bound retries under rapid exhaustion/fencing; callers can retry ErrState.
const reservationAttempts = 3

type contextGate chan struct{}

func (gate contextGate) lock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case gate <- struct{}{}:
		if err := ctx.Err(); err != nil {
			gate.unlock()
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (gate contextGate) tryLock() bool {
	select {
	case gate <- struct{}{}:
		return true
	default:
		return false
	}
}

func (gate contextGate) unlock() { <-gate }

func (meter *Meter) reserveBudget(ctx context.Context, owner string, bytes int) (budget, string, error) {
	entry, _ := meter.accounts.LoadOrStore(owner, &accountBudget{renew: make(contextGate, 1)})
	account := entry.(*accountBudget)
	ticket := "ticket:" + uuid.NewString()
	for attempt := range reservationAttempts {
		if err := ctx.Err(); err != nil {
			return budget{}, "", err
		}
		grant := account.current.Load()
		if grant != nil {
			ok, err := meter.take(ctx, grant, bytes, ticket)
			if err != nil || ok {
				return grant.value, ticket, err
			}
		}
		if attempt == reservationAttempts-1 {
			return budget{}, "", ErrState
		}
		if err := meter.renewBudget(ctx, account, grant, budgetRequest{owner, bytes}); err != nil {
			return budget{}, "", err
		}
	}
	return budget{}, "", ErrState
}

type budgetRequest struct {
	owner string
	bytes int
}

func (meter *Meter) renewBudget(ctx context.Context, account *accountBudget,
	previous *budgetGrant, request budgetRequest) error {
	if err := account.renew.lock(ctx); err != nil {
		return err
	}
	defer account.renew.unlock()
	if account.current.Load() != previous {
		return nil // Another caller already replaced the exhausted or fenced grant.
	}
	if previous != nil {
		// Redis sealing is atomic with take: a racing take is either rejected or
		// included in pending. Settlement never releases an in-flight ticket.
		if err := meter.retire(ctx, previous.value); err != nil {
			return err
		}
		account.current.Store(nil)
	}
	value, epoch, err := meter.openBudget(ctx, request.owner, request.bytes)
	if err == nil {
		account.current.Store(&budgetGrant{value, epoch})
	}
	return err
}
