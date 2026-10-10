package devices

import (
	"context"
	"errors"
	"log/slog"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
)

var errRelaySkipped = errors.New("relay frame skipped")

type relayTrafficMeter interface {
	Transmit(context.Context, string, int, func() error) error
}

func (delivery relayDelivery) guard(meter relayTrafficMeter) func(int, func() error) error {
	return func(bytes int, write func() error) error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*heartbeatInterval)
		defer cancel()
		var writeErr error
		err := meter.Transmit(ctx, delivery.owner, bytes, func() error {
			writeErr = write()
			return writeErr
		})
		// Socket failures must reach the writer so it closes the transport and permits recovery.
		// They do not mean that the account's relay allowance is unavailable.
		if writeErr != nil {
			return writeErr
		}
		if err == nil {
			return nil
		}
		if !errors.Is(err, chattraffic.ErrQuota) {
			slog.Warn("relay accounting unavailable", "error", err)
		}
		message := platform.JSON{"type": "relay-quota", "sessionId": delivery.sessionID, "blocked": true,
			"reason": "quota"}
		if !errors.Is(err, chattraffic.ErrQuota) {
			message["reason"] = "unavailable"
		}
		delivery.source.send(message, nil)
		delivery.target.send(message, nil)
		return errRelaySkipped
	}
}
