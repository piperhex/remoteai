package accounts

import (
	"math"
	"time"

	"gorm.io/gorm"
)

type storedQuotaDecline struct {
	AccountID   string
	QuotaWindow quotaWindow
	Phase       quotaDecline `gorm:"embedded"`
}

func readCurrentDeclines(tx *gorm.DB, owner, account string) ([]storedQuotaDecline, error) {
	query := tx.Table("official_quota_v2_declines").Where("owner_id=? AND is_current", owner)
	if account != "" {
		query = query.Where("account_id=?", account)
	}
	var rows []storedQuotaDecline
	err := query.Find(&rows).Error
	return rows, err
}

func groupQuotaDeclines(phases []storedQuotaDecline) map[string][]storedQuotaDecline {
	result := make(map[string][]storedQuotaDecline)
	for _, phase := range phases {
		result[phase.AccountID] = append(result[phase.AccountID], phase)
	}
	return result
}

func updateQuotaDeclines(tx *gorm.DB, options reportAccountOptions, phases []storedQuotaDecline,
	changes usageChanges) error {
	cutoff := time.Now().Unix() - usageRetentionSeconds
	start := quotaReadStart(phases, changes.quotas, cutoff)
	expired := false
	for _, phase := range phases {
		expired = expired || phase.Phase.StartTs < cutoff
	}
	if len(changes.quotas) > 0 || expired {
		return rebuildQuotaDeclines(tx, options, start)
	}
	// Minute-only reports adjust absolute replacements, including late completions and other devices.
	// Idempotent retries never revisit quota history or historical minute samples.
	for _, current := range phases {
		phase := current.Phase
		for _, change := range changes.minutes {
			phase.ConsumedUSD += minuteCostAfter(change.next, phase.StartTs) -
				minuteCostAfter(change.previous, phase.StartTs)
		}
		phase.ConsumedUSD = math.Max(0, phase.ConsumedUSD)
		if phase.ConsumedUSD == current.Phase.ConsumedUSD {
			continue
		}
		if err := storeQuotaDecline(tx, declineOptions{options.Owner, options.Account.AccountID,
			current.QuotaWindow}, phase); err != nil {
			return err
		}
	}
	return nil
}

func minuteCostAfter(minute usageMinute, start int64) float64 {
	var cost float64
	for _, sample := range minute.Samples {
		if minute.Ts+int64(sample[0]) > start {
			cost += sample[2]
		}
	}
	return cost
}

func quotaReadStart(phases []storedQuotaDecline, changes []quotaObservation, cutoff int64) int64 {
	if len(phases) == 0 {
		return cutoff
	}
	start, end := phases[0].Phase.StartTs, phases[0].Phase.EndTs
	for _, phase := range phases {
		if phase.Phase.StartRemaining == nil {
			// Conflicting observations can preserve an observed window without a usable
			// baseline. Its evidence may precede StartTs, so a suffix alone is insufficient.
			return cutoff
		}
		start = min(start, phase.Phase.StartTs)
		end = max(end, phase.Phase.EndTs)
	}
	for _, point := range changes {
		if point.Ts <= end {
			// Correcting an old observation can erase a rebound or conflict at the baseline.
			// Only this exceptional path must reconsider older stages.
			return cutoff
		}
	}
	return max(start, cutoff)
}

func rebuildQuotaDeclines(tx *gorm.DB, options reportAccountOptions, start int64) error {
	owner, account := options.Owner, options.Account.AccountID
	var points []quotaObservation
	if err := tx.Raw(`SELECT ts, primary_remaining AS "primary", secondary_remaining AS "secondary",
		primary_reset,secondary_reset FROM official_quota_v2_observations WHERE owner_id=? AND account_id=?
		AND ts>=? ORDER BY ts`, owner, account, start).Scan(&points).Error; err != nil {
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
		cost, err := readDeclineCost(tx, owner, account, phase.StartTs)
		if err != nil {
			return err
		}
		phase.ConsumedUSD = cost
		if err := storeQuotaDecline(tx, declineOptions{owner, account, window}, *phase); err != nil {
			return err
		}
	}
	return nil
}

func readDeclineCost(tx *gorm.DB, owner, account string, start int64) (float64, error) {
	var cost float64
	// Only the boundary minute needs JSON expansion; complete minutes use their stored totals.
	err := tx.Raw(`SELECT COALESCE(SUM(CASE WHEN minute_ts>? THEN cost_usd
		ELSE (SELECT COALESCE(SUM((v->>2)::double precision),0) FROM jsonb_array_elements(samples) v
		WHERE minute_ts+(v->>0)::bigint>?) END),0) FROM official_usage_v2_minutes
		WHERE owner_id=? AND account_id=? AND minute_ts>=?`,
		start, start, owner, account, start/usageMinuteSeconds*usageMinuteSeconds).Scan(&cost).Error
	return cost, err
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
		is_current=true`, options.Owner, options.Account, options.Window, phase.StartTs, phase.EndTs,
		phase.StartRemaining, phase.Remaining, phase.ResetAt, phase.DeclinePercent, phase.ConsumedUSD).Error
}
