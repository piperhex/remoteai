package chattraffic

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const BulkLeaseBytes = 1024 * 1024
const bulkConcurrentLeases = 4
const bulkUnresolvedLeases = 64
const bulkLeaseLifetime = 2 * time.Second

// BulkLeaseScope is derived exclusively from authenticated relay session ownership.
// A writer never hands a lease to another socket or process, even after a reconnect.
type BulkLeaseScope struct{ Owner, Device, Writer string }

type bulkLease struct {
	Claimed, Reported                            bool
	ID, UserID, DeviceID, WriterID, FencingEpoch string
	HourStart, ExpiresAt                         time.Time
	Bytes, Reserved, Sent                        int64
	State                                        string
}

func outstandingCredit(db *gorm.DB, owner string, month time.Time) (int64, error) {
	var held int64
	err := db.Raw(`SELECT
      COALESCE((SELECT SUM(bytes) FROM chat_relay_budgets WHERE user_id=? AND hour_start>=? AND NOT closed),0)
      + COALESCE((SELECT SUM(reserved) FROM chat_relay_bulk_leases WHERE user_id=? AND hour_start>=?
        AND state<>'closed'),0)`, owner, month, owner, month).Scan(&held).Error
	return held, err
}

func reserveBulkLease(db *gorm.DB, lease bulkLease) (bulkLease, error) {
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := lockUser(tx, lease.UserID); err != nil {
			return err
		}
		var previous bulkLease
		err := tx.Table("chat_relay_bulk_leases").Where("id=?", lease.ID).Take(&previous).Error
		if err == nil {
			if previous.UserID != lease.UserID || previous.DeviceID != lease.DeviceID ||
				previous.WriterID != lease.WriterID || previous.FencingEpoch != lease.FencingEpoch ||
				previous.Bytes != lease.Bytes {
				return ErrState
			}
			lease = previous
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := authorizeBulkLease(tx, lease); err != nil {
			return err
		}
		return tx.Table("chat_relay_bulk_leases").Create(&lease).Error
	})
	return lease, err
}

func authorizeBulkLease(db *gorm.DB, lease bulkLease) error {
	usage, err := ReadUsage(db, lease.UserID, lease.HourStart)
	if err != nil {
		return err
	}
	if !Allowed(usage, int(lease.Bytes)) {
		return ErrQuota
	}
	held, err := outstandingCredit(db, lease.UserID, MonthStart(lease.HourStart))
	if err != nil {
		return err
	}
	usage.MonthUsedBytes += held
	if !Allowed(usage, int(lease.Bytes)) {
		return ErrState
	}
	var count int64
	if err := db.Table("chat_relay_bulk_leases").Where("user_id=? AND state IN ('reserved','writing')",
		lease.UserID).Count(&count).Error; err != nil {
		return err
	}
	if count >= bulkConcurrentLeases {
		return ErrState
	}
	if err := db.Table("chat_relay_bulk_leases").Where("user_id=? AND state<>'closed'", lease.UserID).
		Count(&count).Error; err != nil {
		return err
	}
	if count >= bulkUnresolvedLeases {
		return ErrState
	}
	return nil
}

// Settlement uses a cumulative high-water mark. Failed/ambiguous socket writes remain reserved;
// only the writer's durable final report can release bytes it proves it never attempted.
func settleBulkLease(db *gorm.DB, lease bulkLease, sent, attempted int64) error {
	if sent < 0 || attempted < sent || attempted > lease.Bytes {
		return ErrState
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := lockUser(tx, lease.UserID); err != nil {
			return err
		}
		var current bulkLease
		if err := tx.Table("chat_relay_bulk_leases").Where("id=?", lease.ID).Take(&current).Error; err != nil {
			return err
		}
		if current.WriterID != lease.WriterID || current.FencingEpoch != lease.FencingEpoch {
			return ErrState
		}
		if current.Reported {
			if current.Sent == sent && current.Reserved == attempted-sent {
				return nil
			}
			return ErrState
		}
		if !current.Claimed || (current.State != "writing" && current.State != "uncertain") || sent < current.Sent {
			return ErrState
		}
		if sent > current.Sent {
			if err := record(tx, current.UserID, int(sent-current.Sent), current.HourStart); err != nil {
				return err
			}
		}
		state := "closed"
		if attempted > sent {
			state = "uncertain"
		}
		return tx.Table("chat_relay_bulk_leases").Where("id=?", current.ID).Updates(map[string]interface{}{
			"sent": sent, "reserved": attempted - sent, "state": state, "reported": true,
		}).Error
	})
}
