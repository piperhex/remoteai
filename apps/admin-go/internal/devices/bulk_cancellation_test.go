package devices

import (
	"context"
	"testing"

	"github.com/codex-switch/admin-go/internal/chattraffic"
)

type bulkMeterFunc func(context.Context, chattraffic.BulkLeaseScope, []chattraffic.BulkWrite) error

func (meter bulkMeterFunc) Transmit(ctx context.Context, scope chattraffic.BulkLeaseScope,
	writes []chattraffic.BulkWrite) error {
	return meter(ctx, scope, writes)
}

func TestBulkCancelledQueuedFramesAreNotBilledOrDelivered(t *testing.T) {
	for _, lease := range []bool{false, true} {
		target, _ := bulkBackpressurePeer(t)
		cancel := make(chan struct{})
		frame := outputFrame{bytes: fullBulkWire(t), sessionDone: cancel,
			sent:  func(int) { t.Error("cancelled frame counted as sent") },
			guard: func(int, func() error) error { t.Error("cancelled frame reached meter"); return nil }}
		if lease {
			frame.lease = &bulkWriter{meter: bulkMeterFunc(func(context.Context, chattraffic.BulkLeaseScope,
				[]chattraffic.BulkWrite) error {
				t.Error("cancelled batch reached meter")
				return nil
			})}
		}
		if !target.trySendBulk(frame, t.Name()) {
			t.Fatal("enqueue failed")
		}
		close(cancel)
		if !target.writeQueued(<-target.bulkQueue, true) || target.bulkBuffered.Load() != 0 {
			t.Fatal("cancelled frame closed transport or leaked bytes")
		}
	}
}

func TestBulkCancellationDuringAccountingIsNotSuccessfulDelivery(t *testing.T) {
	for _, lease := range []bool{false, true} {
		target, _ := bulkBackpressurePeer(t)
		cancel := make(chan struct{})
		frame := outputFrame{bytes: fullBulkWire(t), sessionDone: cancel,
			sent:  func(int) { t.Error("cancelled frame counted as sent") },
			guard: func(_ int, write func() error) error { close(cancel); return write() }}
		if lease {
			frame.lease = &bulkWriter{failure: func() { t.Error("cancellation reported as quota failure") },
				meter: bulkMeterFunc(func(_ context.Context, _ chattraffic.BulkLeaseScope,
					writes []chattraffic.BulkWrite) error {
					close(cancel)
					return writes[0].Write()
				})}
		}
		if !target.trySendBulk(frame, t.Name()) {
			t.Fatal("enqueue failed")
		}
		if !target.writeQueued(<-target.bulkQueue, true) || target.bulkBuffered.Load() != 0 {
			t.Fatal("cancelled authorized frame closed transport or leaked bytes")
		}
	}
}
