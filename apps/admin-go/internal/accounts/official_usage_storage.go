package accounts

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

func lockUsageOwner(tx *gorm.DB, owner string) error {
	return tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`, "official-usage:"+owner).Error
}

func (s *service) storeUsageReport(owner, device string, report officialUsageReport) error {
	return s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := lockUsageOwner(tx, owner); err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO official_usage_v2_devices(owner_id,device_id,device_name,reported_at)
			VALUES(?,?,?,?) ON CONFLICT(owner_id,device_id) DO UPDATE
			SET device_name=excluded.device_name, reported_at=excluded.reported_at`,
			owner, device, report.DeviceName, time.Now().Unix()).Error; err != nil {
			return err
		}
		for _, account := range report.Accounts {
			if err := storeAccountUsage(tx, reportAccountOptions{Owner: owner, Device: device, Account: account}); err != nil {
				return err
			}
			if err := pruneUsageRecords(tx, owner, account.AccountID); err != nil {
				return err
			}
			if err := rebuildQuotaDeclines(tx, owner, account.AccountID); err != nil {
				return err
			}
		}
		return nil
	})
}

// Keep detailed minute/observation records within the supported reporting range.
// Historical decline summaries remain compact and retain the evidence used for prior estimates.
func pruneUsageRecords(tx *gorm.DB, owner, account string) error {
	cutoff := (time.Now().Unix() - usageRetentionSeconds) / usageMinuteSeconds * usageMinuteSeconds
	if err := tx.Exec(`DELETE FROM official_usage_v2_minutes
		WHERE owner_id=? AND account_id=? AND minute_ts<?`, owner, account, cutoff).Error; err != nil {
		return err
	}
	return tx.Exec(`DELETE FROM official_quota_v2_observations
		WHERE owner_id=? AND account_id=? AND ts<?`, owner, account, cutoff).Error
}

type reportAccountOptions struct {
	Owner   string
	Device  string
	Account accountUsageReport
}

func storeAccountUsage(tx *gorm.DB, options reportAccountOptions) error {
	owner, device, account := options.Owner, options.Device, options.Account
	if err := tx.Exec(`INSERT INTO official_usage_v2_accounts(owner_id,account_id,label) VALUES(?,?,?)
		ON CONFLICT(owner_id,account_id) DO UPDATE SET label=excluded.label`,
		owner, account.AccountID, account.AccountLabel).Error; err != nil {
		return err
	}
	for _, minute := range account.Minutes {
		if err := storeUsageMinute(tx, options, minute); err != nil {
			return err
		}
	}
	for _, point := range account.Quotas {
		if err := tx.Exec(`INSERT INTO official_quota_v2_observations(owner_id,account_id,device_id,ts,
			primary_remaining,secondary_remaining,primary_reset,secondary_reset) VALUES(?,?,?,?,?,?,?,?)
			ON CONFLICT(owner_id,account_id,device_id,ts) DO UPDATE SET
			primary_remaining=excluded.primary_remaining, secondary_remaining=excluded.secondary_remaining,
			primary_reset=excluded.primary_reset, secondary_reset=excluded.secondary_reset`, owner, account.AccountID,
			device, point.Ts, point.Primary, point.Secondary, point.PrimaryReset, point.SecondaryReset).Error; err != nil {
			return err
		}
	}
	return nil
}

func storeUsageMinute(tx *gorm.DB, options reportAccountOptions, minute usageMinute) error {
	var tokens int64
	var cost float64
	for _, sample := range minute.Samples {
		tokens += int64(sample[1])
		cost += sample[2]
	}
	samples, err := json.Marshal(minute.Samples)
	if err != nil {
		return err
	}
	// Absolute minute totals make retries idempotent and retain late completed requests in their original minute.
	return tx.Exec(`INSERT INTO official_usage_v2_minutes
		(owner_id,device_id,account_id,minute_ts,samples,total_tokens,cost_usd)
		VALUES(?,?,?,?,?::jsonb,?,?) ON CONFLICT(owner_id,device_id,account_id,minute_ts) DO UPDATE
		SET samples=excluded.samples, total_tokens=excluded.total_tokens, cost_usd=excluded.cost_usd`,
		options.Owner, options.Device, options.Account.AccountID, minute.Ts, string(samples), tokens, cost).Error
}

func rebuildQuotaDeclines(tx *gorm.DB, owner, account string) error {
	var points []quotaObservation
	if err := tx.Raw(`SELECT ts, primary_remaining AS "primary", secondary_remaining AS "secondary",
		primary_reset,secondary_reset FROM official_quota_v2_observations WHERE owner_id=? AND account_id=?
		AND ts>=? ORDER BY ts`, owner, account, time.Now().Unix()-usageRetentionSeconds).Scan(&points).Error; err != nil {
		return err
	}
	points = mergeQuotaObservations(points)
	if err := tx.Exec(`UPDATE official_quota_v2_declines SET is_current=false
		WHERE owner_id=? AND account_id=? AND is_current`, owner, account).Error; err != nil {
		return err
	}
	for _, window := range []quotaWindow{primaryQuota, secondaryQuota} {
		phase := latestQuotaDecline(points, window)
		if phase == nil {
			continue
		}
		minutes, err := readUsageMinutes(tx, owner, account, phase.StartTs)
		if err != nil {
			return err
		}
		for _, minute := range minutes {
			addMinuteToDecline(phase, minute)
		}
		if err := storeQuotaDecline(tx, declineOptions{owner, account, window}, *phase); err != nil {
			return err
		}
	}
	return nil
}

func readUsageMinutes(tx *gorm.DB, owner, account string, start int64) ([]usageMinute, error) {
	var rows []struct {
		MinuteTs int64
		Samples  string
	}
	if err := tx.Raw(`SELECT minute_ts,samples::text FROM official_usage_v2_minutes
		WHERE owner_id=? AND account_id=? AND minute_ts>=?`, owner, account, start/60*60).Scan(&rows).Error; err != nil {
		return nil, err
	}
	minutes := make([]usageMinute, 0, len(rows))
	for _, row := range rows {
		minute := usageMinute{Ts: row.MinuteTs}
		if err := json.Unmarshal([]byte(row.Samples), &minute.Samples); err != nil {
			return nil, err
		}
		minutes = append(minutes, minute)
	}
	return minutes, nil
}

type declineOptions struct {
	Owner   string
	Account string
	Window  quotaWindow
}

func storeQuotaDecline(tx *gorm.DB, options declineOptions, phase quotaDecline) error {
	return tx.Exec(`INSERT INTO official_quota_v2_declines(owner_id,account_id,quota_window,start_ts,end_ts,
		start_remaining,remaining,reset_at,decline_percent,consumed_usd) VALUES(?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(owner_id,account_id,quota_window,start_ts) DO UPDATE SET end_ts=excluded.end_ts,
		start_remaining=excluded.start_remaining,remaining=excluded.remaining,reset_at=excluded.reset_at,
		decline_percent=excluded.decline_percent,consumed_usd=excluded.consumed_usd,
		is_current=true`,
		options.Owner, options.Account, options.Window, phase.StartTs, phase.EndTs,
		phase.StartRemaining, phase.Remaining, phase.ResetAt,
		phase.DeclinePercent, phase.ConsumedUSD).Error
}
