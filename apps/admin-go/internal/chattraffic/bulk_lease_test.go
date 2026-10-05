package chattraffic

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestBulkLeaseChargesSameWireBytesWithOneBatch(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := NewBulkMeter(trafficMeter(t, db, owner))
	scope := BulkLeaseScope{owner, "desktop", uuid.NewString()}
	var records []BulkWrite
	for range 16 {
		records = append(records, BulkWrite{100, func() error { return nil }})
	}
	if err := meter.Transmit(t.Context(), scope, records); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 1600)
	if meter.Measurements()["batches"] != 1 || meter.Measurements()["records"] != 16 {
		t.Fatal(meter.Measurements())
	}
}

func TestBulkLeaseUnavailableAuthorityNeverCallsWriter(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := NewBulkMeter(trafficMeter(t, db, owner))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	err := meter.Transmit(ctx, BulkLeaseScope{owner, "pc", uuid.NewString()}, []BulkWrite{{1, func() error {
		t.Fatal("wrote without authority")
		return nil
	}}})
	if err == nil {
		t.Fatal("unavailable authority accepted")
	}
	assertUsage(t, db, owner, 0)
}

func TestBulkLeasePartialWriteKeepsUnknownBytesAndRefundsOnlyUnattemptedBytes(t *testing.T) {
	db, owner := trafficFixture(t)
	baseline := trafficMeter(t, db, owner)
	meter := NewBulkMeter(baseline)
	setQuota(t, db, owner, 100)
	failure := errors.New("write outcome unknown")
	records := []BulkWrite{{30, func() error { return nil }}, {20, func() error { return failure }},
		{50, func() error { t.Fatal("wrote after failure"); return nil }}}
	if err := meter.Transmit(t.Context(), BulkLeaseScope{owner, "pc", uuid.NewString()}, records); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 30)
	var lease bulkLease
	db.Table("chat_relay_bulk_leases").Where("user_id=?", owner).Take(&lease)
	if lease.Reserved != 20 || lease.State != "uncertain" {
		t.Fatal(lease)
	}
	for range 2 {
		if err := settleBulkLease(db, lease, 30, 50); err != nil {
			t.Fatal(err)
		}
	}
	forged := lease
	forged.WriterID = uuid.NewString()
	if err := settleBulkLease(db, forged, 30, 30); !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	if err := baseline.Transmit(t.Context(), owner, 51, func() error { t.Fatal("spent held quota"); return nil }); !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	if err := baseline.Transmit(t.Context(), owner, 50, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := baseline.Close(); err != nil {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 80)
}

func TestBulkLeaseCrashExpiryNeverReissuesCreditAndFencesWriterReplay(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := NewBulkMeter(trafficMeter(t, db, owner))
	setQuota(t, db, owner, 100)
	epoch, err := readEpoch(t.Context(), meter.meter.redis, owner)
	if err != nil {
		t.Fatal(err)
	}
	lease := bulkLease{ID: uuid.NewString(), UserID: owner, DeviceID: "pc", WriterID: uuid.NewString(),
		FencingEpoch: epoch, HourStart: time.Now().UTC().Truncate(time.Hour), ExpiresAt: time.Now().Add(time.Minute),
		Bytes: 100, Reserved: 100, State: "reserved"}
	for range 2 {
		if _, err := reserveBulkLease(db, lease); err != nil {
			t.Fatal(err)
		}
	}
	if err := meter.claim(t.Context(), lease); err != nil {
		t.Fatal(err)
	}
	if err := meter.claim(t.Context(), lease); !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	if err := db.Table("chat_relay_bulk_leases").Where("id=?", lease.ID).
		Update("expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := meter.ReconcileExpired(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := meter.meter.Transmit(t.Context(), owner, 1, func() error { t.Fatal("refunded unknown bytes"); return nil }); !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
	assertUsage(t, db, owner, 0) // Unknown is held for audit, never silently relabelled successful traffic.
}

func TestConcurrentBulkMetersAndBaselineShareAccountQuota(t *testing.T) {
	db, owner := trafficFixture(t)
	setQuota(t, db, owner, 100)
	first := NewBulkMeter(trafficMeter(t, db, owner))
	second := NewBulkMeter(trafficMeter(t, db, owner))
	var workers sync.WaitGroup
	var sent atomic.Int64
	for index := range 20 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			meter := first
			if index%2 != 0 {
				meter = second
			}
			err := meter.Transmit(t.Context(), BulkLeaseScope{owner, "pc", uuid.NewString()},
				[]BulkWrite{{10, func() error { sent.Add(10); return nil }}})
			if err != nil && !errors.Is(err, ErrQuota) && !errors.Is(err, ErrState) {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	if sent.Load() > 100 {
		t.Fatal(sent.Load())
	}
	assertUsage(t, db, owner, sent.Load())
}

func TestBulkLeaseRejectsOversizeAndOldQuotaFenceBeforeWriting(t *testing.T) {
	if _, err := bulkBatchBytes([]BulkWrite{{BulkLeaseBytes + 1, func() error { return nil }}}); err == nil {
		t.Fatal("oversized lease")
	}
	db, owner := trafficFixture(t)
	meter := NewBulkMeter(trafficMeter(t, db, owner))
	epoch, err := readEpoch(t.Context(), meter.meter.redis, owner)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := reserveBulkLease(db, bulkLease{ID: uuid.NewString(), UserID: owner, DeviceID: "pc",
		WriterID: uuid.NewString(), FencingEpoch: epoch, HourStart: time.Now().UTC().Truncate(time.Hour),
		ExpiresAt: time.Now().Add(time.Minute), Bytes: 100, Reserved: 100, State: "reserved"})
	if err != nil {
		t.Fatal(err)
	}
	if err := meter.meter.redis.Set(t.Context(), epochKey(owner), "blocked:"+uuid.NewString(), 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := meter.claim(t.Context(), lease); !errors.Is(err, ErrState) {
		t.Fatal(err)
	}
}

func TestExpiredClaimedLeaseAcceptsOneLateFinalReceiptWithoutReauthorizingTheWriter(t *testing.T) {
	db, owner := trafficFixture(t)
	meter := NewBulkMeter(trafficMeter(t, db, owner))
	epoch, err := readEpoch(t.Context(), meter.meter.redis, owner)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := reserveBulkLease(db, bulkLease{ID: uuid.NewString(), UserID: owner, DeviceID: "pc",
		WriterID: uuid.NewString(), FencingEpoch: epoch, HourStart: time.Now().UTC().Truncate(time.Hour),
		ExpiresAt: time.Now().Add(time.Minute), Bytes: 100, Reserved: 100, State: "reserved"})
	if err != nil {
		t.Fatal(err)
	}
	if err := meter.claim(t.Context(), lease); err != nil {
		t.Fatal(err)
	}
	if err := db.Table("chat_relay_bulk_leases").Where("id=?", lease.ID).
		Update("expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := meter.ReconcileExpired(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := meter.claim(t.Context(), lease); !errors.Is(err, ErrState) {
		t.Fatal("claimed twice", err)
	}
	for range 2 {
		if err := settleBulkLease(db, lease, 60, 60); err != nil {
			t.Fatal(err)
		}
	}
	if err := settleBulkLease(db, lease, 80, 80); !errors.Is(err, ErrState) {
		t.Fatal("changed final receipt", err)
	}
	assertUsage(t, db, owner, 60)
	var receipt bulkLease
	if err := db.Table("chat_relay_bulk_leases").Where("id=?", lease.ID).Take(&receipt).Error; err != nil {
		t.Fatal(err)
	}
	if receipt.Reserved != 0 || !receipt.Reported || receipt.State != "closed" {
		t.Fatal(receipt)
	}
}
