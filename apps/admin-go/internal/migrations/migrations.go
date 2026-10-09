// Package migrations initializes new databases with the exact legacy PostgreSQL schema.
package migrations

import (
	_ "embed"
	"strings"

	"gorm.io/gorm"
)

//go:embed 001_legacy_schema.sql
var initialSchema string

//go:embed 002_token_cost_presets.sql
var tokenPricingSchema string

//go:embed 003_user_login_locks.sql
var loginLockSchema string

//go:embed 004_chat_user_traffic.sql
var chatUserTrafficSchema string

//go:embed 005_chat_relay_budgets.sql
var chatRelayBudgetsSchema string

//go:embed 006_device_gui_model_selection.sql
var deviceGuiModelSchema string

//go:embed 007_chat_push.sql
var chatPushSchema string

//go:embed 008_desktop_service.sql
var desktopServiceSchema string

//go:embed 009_chat_bulk_leases.sql
var bulkLeaseSchema string

//go:embed 010_official_usage.sql
var officialUsageSchema string

// InitializeEmpty never changes existing tables, constraints, indexes, or customer data.
// Existing deployments continue to apply the versioned apps/admin-go/sql migrations.
func InitializeEmpty(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(710983103)).Error; err != nil {
			return err
		}
		var exists bool
		if err := tx.Raw("SELECT to_regclass('public.users') IS NOT NULL").Scan(&exists).Error; err != nil {
			return err
		}
		if exists {
			return nil
		}
		schema := strings.ReplaceAll(initialSchema, "\nSET ", "\nSET LOCAL ")
		schema = strings.ReplaceAll(schema, "set_config('search_path', '', false)", "set_config('search_path', 'public', true)")
		if err := tx.Exec(schema).Error; err != nil {
			return err
		}
		if err := tx.Exec(tokenPricingSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loginLockSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(chatUserTrafficSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(chatRelayBudgetsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(deviceGuiModelSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(chatPushSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(desktopServiceSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(bulkLeaseSchema).Error; err != nil {
			return err
		}
		return tx.Exec(officialUsageSchema).Error
	})
}
