package accounts

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

func lockUsageOwner(tx *gorm.DB, owner string) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "official-usage:"+owner).Error
}

func (s *service) storeUsageReport(ctx context.Context, owner, device string, report officialUsageReport) error {
	ctx, cancel := platform.DatabaseContext(ctx)
	defer cancel()
	return s.deps.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockUsageOwner(tx, owner); err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO official_usage_v2_devices(owner_id,device_id,device_name,reported_at) "+
			"VALUES(?,?,?,?) ON CONFLICT(owner_id,device_id) DO UPDATE "+
			"SET device_name=excluded.device_name, reported_at=excluded.reported_at",
			owner, device, report.DeviceName, time.Now().Unix()).Error; err != nil {
			return err
		}
		for _, account := range report.Accounts {
			if err := storeAccountUsage(tx, reportAccountOptions{owner, device, account}); err != nil {
				return err
			}
		}
		return nil
	})
}

// Historical decline summaries retain evidence after detailed records leave the reporting range.
func pruneUsageRecords(tx *gorm.DB, owner, account string) error {
	cutoff := (time.Now().Unix() - usageRetentionSeconds) / usageMinuteSeconds * usageMinuteSeconds
	if err := tx.Exec("DELETE FROM official_usage_v2_minutes WHERE owner_id=? AND account_id=? AND minute_ts<?",
		owner, account, cutoff).Error; err != nil {
		return err
	}
	return tx.Exec("DELETE FROM official_quota_v2_observations WHERE owner_id=? AND account_id=? AND ts<?",
		owner, account, cutoff).Error
}

type reportAccountOptions struct {
	Owner   string
	Device  string
	Account accountUsageReport
}

func storeAccountUsage(tx *gorm.DB, options reportAccountOptions) error {
	owner, account := options.Owner, options.Account.AccountID
	phases, err := readCurrentDeclines(tx, owner, account)
	if err != nil {
		return err
	}
	changes, err := readUsageChanges(tx, options)
	if err != nil {
		return err
	}
	if err := tx.Exec("INSERT INTO official_usage_v2_accounts(owner_id,account_id,label) VALUES(?,?,?) "+
		"ON CONFLICT(owner_id,account_id) DO UPDATE SET label=excluded.label "+
		"WHERE official_usage_v2_accounts.label IS DISTINCT FROM excluded.label",
		owner, account, options.Account.AccountLabel).Error; err != nil {
		return err
	}
	if err := writeUsageChanges(tx, options, changes); err != nil {
		return err
	}
	if err := pruneUsageRecords(tx, owner, account); err != nil {
		return err
	}
	return updateQuotaDeclines(tx, options, phases, changes)
}
