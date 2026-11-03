package chattraffic

import "context"

// Bound abandoned storage operations as well as active ones. go-redis socket
// reads may outlive context cancellation; never create an unbounded worker queue
// or let that delay a cancelled relay caller. No slot is held over a socket write.
const accountingConcurrency = 64

type reservationResult struct {
	value  budget
	ticket string
	err    error
}

func (meter *Meter) reserve(ctx context.Context, owner string, bytes int) (budget, string, error) {
	if err := meter.reservations.lock(ctx); err != nil {
		return budget{}, "", err
	}
	result := make(chan reservationResult)
	go func() {
		defer meter.reservations.unlock()
		value, ticket, err := meter.reserveBudget(ctx, owner, bytes)
		select {
		case result <- reservationResult{value, ticket, err}:
		case <-ctx.Done():
			if err == nil {
				// A confirmed, unattempted ticket can be refunded. An ambiguous
				// take remains pending for conservative, idempotent recovery.
				// Failed refunds follow that same durable recovery path.
				_ = finishReservation(meter.redis, value, ticket, false)
			}
		}
	}()
	select {
	case value := <-result:
		return value.value, value.ticket, value.err
	case <-ctx.Done():
		return budget{}, "", ctx.Err()
	}
}

func (meter *Meter) complete(ctx context.Context, value budget, ticket string, success bool) error {
	// Start cleanup even if the relay was just cancelled, provided capacity is
	// available. If saturated, the durable pending ticket remains recoverable.
	if !meter.completions.tryLock() {
		if err := meter.completions.lock(ctx); err != nil {
			return err
		}
	}
	result := make(chan error, 1)
	go func() {
		defer meter.completions.unlock()
		result <- finishReservation(meter.redis, value, ticket, success)
	}()
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
