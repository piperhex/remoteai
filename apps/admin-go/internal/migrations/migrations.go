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

//go:embed 011_official_usage_v2.sql
var officialUsageSchema string

//go:embed 012_provider_request_options.sql
var providerRequestOptionsSchema string

//go:embed 014_update_sharing.sql
var updateSharingSchema string

//go:embed 013_aggregate_sync.sql
var aggregateSyncSchema string

//go:embed 015_port_mappings.sql
var portMappingsSchema string

//go:embed 016_update_download_reports.sql
var updateDownloadReportsSchema string

//go:embed 017_ssh_profiles.sql
var sshProfilesSchema string

//go:embed 018_ssh_credentials.sql
var sshCredentialsSchema string

//go:embed 019_lounge_moderation.sql
var loungeModerationSchema string

//go:embed 020_lounge_blocks.sql
var loungeBlocksSchema string

//go:embed 021_lounge_direct_permissions.sql
var loungeDirectPermissionsSchema string

//go:embed 022_lounge_profiles.sql
var loungeProfilesSchema string

//go:embed 028_lounge_avatar_resolution.sql
var loungeAvatarResolutionSchema string

//go:embed 023_lounge_direct_reset.sql
var loungeDirectResetSchema string

//go:embed 024_lounge_names.sql
var loungeNamesSchema string

//go:embed 025_lounge_notifications.sql
var loungeNotificationsSchema string

//go:embed 026_provider_market.sql
var providerMarketSchema string

//go:embed 027_provider_market_page.sql
var providerMarketPageSchema string

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
		if err := tx.Exec(officialUsageSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(providerRequestOptionsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(aggregateSyncSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(updateSharingSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(portMappingsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(updateDownloadReportsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(sshProfilesSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(sshCredentialsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeModerationSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeBlocksSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeDirectPermissionsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeProfilesSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeAvatarResolutionSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeDirectResetSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeNamesSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(loungeNotificationsSchema).Error; err != nil {
			return err
		}
		if err := tx.Exec(providerMarketSchema).Error; err != nil {
			return err
		}
		return tx.Exec(providerMarketPageSchema).Error
	})
}
