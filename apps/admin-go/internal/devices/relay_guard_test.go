package devices

import (
	"context"
	"errors"
	"testing"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
)

type relayMeterFunc func(context.Context, string, int, func() error) error

func (meter relayMeterFunc) Transmit(ctx context.Context, owner string, bytes int, write func() error) error {
	return meter(ctx, owner, bytes, write)
}

func TestRelayWriteFailureClosesSocketWithoutBlockingQuota(t *testing.T) {
	for _, test := range []struct {
		name            string
		settlementError error
	}{
		{"settled", nil}, {"unsettled", errors.New("settlement unavailable")},
	} {
		t.Run(test.name, func(t *testing.T) {
			source, _ := bulkBackpressurePeer(t)
			target, _ := bulkBackpressurePeer(t)
			if err := target.conn.Close(); err != nil {
				t.Fatal(err)
			}
			completed := false
			meter := relayMeterFunc(func(_ context.Context, _ string, _ int, write func() error) error {
				err := write()
				if err == nil {
					t.Fatal("closed socket unexpectedly accepted a write")
				}
				completed = true
				return errors.Join(err, test.settlementError)
			})
			delivery := relayDelivery{owner: "owner", sessionID: "session", source: source, target: target}
			sent := 0
			target.sendGuarded(platform.JSON{"type": "relay"}, func(bytes int) { sent += bytes }, delivery.guard(meter))
			if target.writeQueued(<-target.queue, false) || !target.closed.Load() {
				t.Fatal("failed relay write must terminate the socket immediately")
			}
			if !completed || sent != 0 || target.buffered.Load() != 0 {
				t.Fatal("failed write was counted as delivered or did not finish accounting")
			}
			if len(source.queue) != 0 || len(target.queue) != 0 || source.closed.Load() {
				t.Fatal("socket failure must not announce blocked quota or close the healthy peer")
			}
		})
	}
}

func TestRelayAccountingFailurePreservesSocketAndReportsQuota(t *testing.T) {
	for _, test := range []struct {
		name, reason string
		err          error
	}{
		{"exhausted", "quota", chattraffic.ErrQuota},
		{"unavailable", "unavailable", chattraffic.ErrState},
	} {
		t.Run(test.name, func(t *testing.T) {
			source, _ := bulkBackpressurePeer(t)
			target, receiver := bulkBackpressurePeer(t)
			meter := relayMeterFunc(func(_ context.Context, _ string, _ int, _ func() error) error {
				return test.err
			})
			delivery := relayDelivery{owner: "owner", sessionID: "session", source: source, target: target}
			sent := 0
			target.sendGuarded(platform.JSON{"type": "relay"}, func(bytes int) { sent += bytes }, delivery.guard(meter))
			if !target.writeQueued(<-target.queue, false) || target.closed.Load() || sent != 0 {
				t.Fatal("accounting failure must skip delivery and preserve the socket")
			}
			if len(source.queue) != 1 || len(target.queue) != 1 {
				t.Fatal("both peers must receive the accounting state")
			}
			if !target.writeQueued(<-target.queue, false) {
				t.Fatal("quota notification could not be sent")
			}
			var message platform.JSON
			if err := receiver.ReadJSON(&message); err != nil {
				t.Fatal(err)
			}
			if message["type"] != "relay-quota" || message["reason"] != test.reason || message["blocked"] != true {
				t.Fatalf("unexpected accounting state: %v", message)
			}
		})
	}
}

func TestRelaySuccessfulWriteDeliversAndCountsBytes(t *testing.T) {
	source, _ := bulkBackpressurePeer(t)
	target, receiver := bulkBackpressurePeer(t)
	meter := relayMeterFunc(func(ctx context.Context, owner string, bytes int, write func() error) error {
		if _, bounded := ctx.Deadline(); !bounded || owner != "owner" || bytes <= 0 {
			t.Fatal("missing accounting identity, size or deadline")
		}
		return write()
	})
	delivery := relayDelivery{owner: "owner", sessionID: "session", source: source, target: target}
	sent := 0
	target.sendGuarded(platform.JSON{"type": "relay", "payload": "encrypted"},
		func(bytes int) { sent += bytes }, delivery.guard(meter))
	if !target.writeQueued(<-target.queue, false) || target.closed.Load() || sent == 0 {
		t.Fatal("successful relay write must remain connected and count delivered bytes")
	}
	var message platform.JSON
	if err := receiver.ReadJSON(&message); err != nil {
		t.Fatal(err)
	}
	if message["type"] != "relay" || message["payload"] != "encrypted" || len(source.queue) != 0 {
		t.Fatalf("relay frame was not delivered intact: %v", message)
	}
}
