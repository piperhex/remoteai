package devices

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/codex-switch/admin-go/internal/chattraffic"
)

type bulkWriter struct {
	session string
	meter   *chattraffic.BulkMeter
	scope   chattraffic.BulkLeaseScope
	failure func()
}

// Drain only records already queued, never wait to build a batch. Each batch is smaller than
// both the lease cap and connection queue cap; control is checked before every socket write.
func (p *peer) collectBulk(first outputFrame) []outputFrame {
	frames := []outputFrame{first}
	size := len(first.bytes)
	for len(frames) < 16 && size < bulkConnectionQueue {
		select {
		case frame := <-p.bulkQueue:
			if frame.lease == nil || frame.lease.scope != first.lease.scope || frame.lease.session != first.lease.session ||
				size+len(frame.bytes) > bulkConnectionQueue {
				p.pendingBulk = &frame
				return frames
			}
			frames = append(frames, frame)
			size += len(frame.bytes)
		default:
			return frames
		}
	}
	return frames
}

func (p *peer) writeBulkBatch(first outputFrame) bool {
	frames := p.collectBulk(first)
	defer func() {
		for _, frame := range frames {
			frame.release()
		}
	}()
	writes := make([]chattraffic.BulkWrite, 0, len(frames))
	for _, frame := range frames {
		writes = append(writes, chattraffic.BulkWrite{Bytes: len(frame.bytes), Write: func() error {
			if p.closed.Load() {
				return errors.New("closed download socket")
			}
			// This is the sole socket writer. Service a bounded control quantum between records.
			if err := p.writeBulkControl(); err != nil {
				return err
			}
			frame.guard = nil
			err := p.writeFrame(frame)
			if err != nil {
				p.terminate()
			}
			return err
		}})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*heartbeatInterval)
	defer cancel()
	if err := first.lease.meter.Transmit(ctx, first.lease.scope, writes); err != nil {
		slog.Warn("bulk lease stopped", "error", err)
		first.lease.failure()
	}
	return !p.closed.Load()
}

func (p *peer) writeBulkControl() error {
	until := time.Now().Add(2 * time.Millisecond)
	for count := 0; count < 4 && time.Now().Before(until); count++ {
		select {
		case frame := <-p.queue:
			if !p.writeQueued(frame, false) {
				return errors.New("control socket failed")
			}
		default:
			return nil
		}
	}
	return nil
}
