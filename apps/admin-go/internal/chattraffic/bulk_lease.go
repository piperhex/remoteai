package chattraffic

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// BulkWrite is a validated, already rate-limited record. Length includes the existing relay envelope.
type BulkWrite struct {
	Bytes int
	Write func() error
}

// BulkMeter deliberately keeps Transmit as the default. The opt-in path reserves one bounded
// writer batch, not a transferable reusable grant; a crashed writer can never reclaim its lease.
type BulkMeter struct {
	meter                                     *Meter
	batches, records, wireBytes, elapsedNanos atomic.Int64
}

func NewBulkMeter(meter *Meter) *BulkMeter { return &BulkMeter{meter: meter} }

func (meter *BulkMeter) Transmit(ctx context.Context, scope BulkLeaseScope, records []BulkWrite) error {
	started := time.Now()
	defer func() { meter.elapsedNanos.Add(time.Since(started).Nanoseconds()) }()
	bytes, err := bulkBatchBytes(records)
	if err != nil {
		return err
	}
	if meter.meter.redis == nil {
		return ErrState
	}
	if scope.Owner == "" || scope.Device == "" || len(scope.Device) > 128 || uuid.Validate(scope.Writer) != nil {
		return ErrState
	}
	epoch, err := readEpoch(ctx, meter.meter.redis, scope.Owner)
	if err != nil {
		return err
	}
	now := time.Now()
	lease, err := reserveBulkLease(meter.meter.db.WithContext(ctx), bulkLease{
		ID: uuid.NewString(), UserID: scope.Owner, DeviceID: scope.Device, WriterID: scope.Writer,
		FencingEpoch: epoch, Bytes: bytes, Reserved: bytes, State: "reserved",
		HourStart: now.UTC().Truncate(time.Hour),
		ExpiresAt: minTime(now.Add(bulkLeaseLifetime), now.UTC().Truncate(time.Hour).Add(time.Hour)),
	})
	if err != nil {
		return err
	}
	if err := meter.claim(ctx, lease); err != nil {
		return err
	}
	meter.batches.Add(1)
	sent, attempted, writeErr := meter.write(ctx, lease, records)
	settleContext, cancel := context.WithTimeout(context.Background(), settlementTimeout)
	defer cancel()
	return errors.Join(writeErr, settleBulkLease(meter.meter.db.WithContext(settleContext), lease, sent, attempted))
}

func bulkBatchBytes(records []BulkWrite) (int64, error) {
	if len(records) == 0 || len(records) > 128 {
		return 0, ErrState
	}
	var bytes int64
	for _, record := range records {
		if record.Bytes <= 0 || record.Bytes > BulkLeaseBytes || record.Write == nil {
			return 0, ErrState
		}
		bytes += int64(record.Bytes)
		if bytes > BulkLeaseBytes {
			return 0, ErrState
		}
	}
	return bytes, nil
}

func (meter *BulkMeter) claim(ctx context.Context, lease bulkLease) error {
	// Check the shared quota fence immediately before claiming. A claim is one-shot, even when
	// its SQL response is lost; no retry can authorize a second writer for the same bytes.
	epoch, err := readEpoch(ctx, meter.meter.redis, lease.UserID)
	if err != nil {
		return err
	}
	if epoch != lease.FencingEpoch {
		return ErrState
	}
	result := meter.meter.db.WithContext(ctx).Table("chat_relay_bulk_leases").
		Where("id=? AND writer_id=? AND fencing_epoch=? AND state='reserved' AND expires_at>?",
			lease.ID, lease.WriterID, epoch, time.Now()).Updates(map[string]interface{}{
		"state": "writing", "claimed": true,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrState
	}
	return nil
}

func (meter *BulkMeter) write(ctx context.Context, lease bulkLease, records []BulkWrite) (int64, int64, error) {
	var sent, attempted int64
	for _, record := range records {
		if err := ctx.Err(); err != nil {
			return sent, attempted, err
		}
		if !time.Now().Before(lease.ExpiresAt) {
			return sent, attempted, ErrState
		}
		attempted += int64(record.Bytes)
		if err := record.Write(); err != nil {
			return sent, attempted, err
		}
		sent += int64(record.Bytes)
		meter.records.Add(1)
		meter.wireBytes.Add(int64(record.Bytes))
	}
	return sent, attempted, nil
}

// ReconcileExpired only marks ambiguous grants for audit; expiry never refunds them.
func (meter *BulkMeter) ReconcileExpired(ctx context.Context) error {
	db := meter.meter.db.WithContext(ctx)
	if err := db.Table("chat_relay_bulk_leases").
		Where("state IN ('reserved','writing') AND expires_at<=?", time.Now()).Update("state", "uncertain").Error; err != nil {
		return err
	}
	// Uncertain rows are retained for operator reconciliation. Only terminal receipts age out.
	return db.Exec(`DELETE FROM chat_relay_bulk_leases WHERE id IN
		(SELECT id FROM chat_relay_bulk_leases WHERE state='closed' AND expires_at<? LIMIT 256)`,
		time.Now().Add(-30*24*time.Hour)).Error
}

func (meter *BulkMeter) Measurements() map[string]int64 {
	return map[string]int64{"batches": meter.batches.Load(), "records": meter.records.Load(),
		"wireBytes": meter.wireBytes.Load(), "elapsedNanos": meter.elapsedNanos.Load()}
}
