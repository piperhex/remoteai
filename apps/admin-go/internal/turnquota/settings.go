// Package turnquota manages the allocation quota of one coturn instance/default realm.
package turnquota

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

const (
	Default          = 256
	Minimum          = 1
	Maximum          = 65535
	settingsID       = "turn-relay"
	lockID     int64 = 710983131
)

var ErrInvalid = errors.New("invalid TURN allocation quota")

// Policy deliberately excludes zero: unlimited allocations are not a product option.
type Policy struct {
	TotalQuota int `json:"totalQuota"`
}

// Old records that predate this field inherit the product default, not unlimited.
func (p *Policy) UnmarshalJSON(data []byte) error {
	type plain Policy
	value := plain{TotalQuota: Default}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*p = Policy(value)
	return nil
}

type settingsRow struct {
	ID        string    `gorm:"column:id;primaryKey"`
	Policy    Policy    `gorm:"column:policy;serializer:json"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (settingsRow) TableName() string { return "chat_settings" }

func (p Policy) Validate() error {
	if p.TotalQuota < Minimum || p.TotalQuota > Maximum {
		return ErrInvalid
	}
	return nil
}

// Read uses a separate row so chat policy updates cannot erase the relay setting.
func Read(db *gorm.DB) (Policy, error) {
	row := settingsRow{Policy: Policy{TotalQuota: Default}}
	err := db.First(&row, "id = ?", settingsID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row.Policy, nil
	}
	if err != nil {
		return Policy{}, err
	}
	return row.Policy, row.Policy.Validate()
}

// Update commits the desired value and the existing admin audit record atomically.
func Update(ctx context.Context, db *gorm.DB, policy Policy, audit func(*gorm.DB) error) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	return locked(ctx, db, func(tx *gorm.DB) error {
		if err := tx.Save(&settingsRow{ID: settingsID, Policy: policy}).Error; err != nil {
			return err
		}
		return audit(tx)
	})
}

// The transaction lock serializes saves and reconciliation across admin processes.
func locked(ctx context.Context, db *gorm.DB, run func(*gorm.DB) error) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", lockID).Error; err != nil {
			return err
		}
		return run(tx)
	})
}
