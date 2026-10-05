package chattraffic

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const budgetBytes int64 = 256 * 1024
const budgetLifetime = 5 * time.Second
const abandonedWriteGrace = time.Minute

type budget struct {
	ID, UserID           string
	HourStart, ExpiresAt time.Time
	Bytes                int64
	Closed               bool
}

func allocate(db *gorm.DB, owner string, required int) (budget, error) {
	now := time.Now()
	value := budget{ID: uuid.NewString(), UserID: owner, HourStart: now.UTC().Truncate(time.Hour),
		ExpiresAt: now.Add(budgetLifetime), Bytes: budgetBytes}
	// Never spend a previous month's grant, including the last five seconds before midnight.
	value.ExpiresAt = minTime(value.ExpiresAt, value.HourStart.Add(time.Hour))
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := lockUser(tx, owner); err != nil {
			return err
		}
		usage, err := ReadUsage(tx, owner, now)
		if err != nil {
			return err
		}
		if !Allowed(usage, required) {
			return ErrQuota
		}
		reserved, err := outstandingCredit(tx, owner, MonthStart(now))
		if err != nil {
			return err
		}
		usage.MonthUsedBytes += reserved
		if !Allowed(usage, required) {
			// Outstanding grants can be released without changing usage. Clients must retry this shortage.
			return ErrState
		}
		if usage.MonthlyLimitBytes != -1 {
			value.Bytes = min(value.Bytes, usage.MonthlyLimitBytes-usage.MonthUsedBytes)
		}
		if value.Bytes < int64(required) {
			return ErrQuota
		}
		return tx.Table("chat_relay_budgets").Create(&value).Error
	})
	return value, err
}

func minTime(left, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}

// Settlement is idempotent: a lost COMMIT response cannot charge a budget twice.
func settle(db *gorm.DB, value budget, spent int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := lockUser(tx, value.UserID); err != nil {
			return err
		}
		var current budget
		if err := tx.Table("chat_relay_budgets").Where("id=?", value.ID).Take(&current).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			} // Closed rows are eventually pruned.
			return err
		}
		if current.Closed {
			return nil
		}
		if spent < 0 || spent > current.Bytes {
			return ErrState
		}
		if spent > 0 {
			if err := record(tx, current.UserID, int(spent), current.HourStart); err != nil {
				return err
			}
		}
		return tx.Table("chat_relay_budgets").Where("id=?", value.ID).Update("closed", true).Error
	})
}
