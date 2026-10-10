package accounts

import (
	"encoding/json"
	"slices"

	"gorm.io/gorm"
)

type minuteChange struct {
	previous, next usageMinute
}

type usageChanges struct {
	minutes []minuteChange
	quotas  []quotaObservation
}

func readUsageChanges(tx *gorm.DB, options reportAccountOptions) (usageChanges, error) {
	minutes, err := readMinuteChanges(tx, options)
	if err != nil {
		return usageChanges{}, err
	}
	quotas, err := readQuotaChanges(tx, options)
	return usageChanges{minutes, quotas}, err
}

func readMinuteChanges(tx *gorm.DB, options reportAccountOptions) ([]minuteChange, error) {
	if len(options.Account.Minutes) == 0 {
		return nil, nil
	}
	timestamps := make([]int64, 0, len(options.Account.Minutes))
	for _, minute := range options.Account.Minutes {
		timestamps = append(timestamps, minute.Ts)
	}
	var rows []struct {
		Ts      int64
		Samples string
	}
	err := tx.Raw(`SELECT minute_ts AS ts,samples::text FROM official_usage_v2_minutes
		WHERE owner_id=? AND account_id=? AND device_id=? AND minute_ts IN ?`,
		options.Owner, options.Account.AccountID, options.Device, timestamps).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	previous := make(map[int64]usageMinute, len(rows))
	for _, row := range rows {
		minute := usageMinute{Ts: row.Ts}
		if err := json.Unmarshal([]byte(row.Samples), &minute.Samples); err != nil {
			return nil, err
		}
		previous[row.Ts] = minute
	}
	changes := make([]minuteChange, 0, len(timestamps))
	for _, minute := range options.Account.Minutes {
		old := previous[minute.Ts]
		if !slices.Equal(old.Samples, minute.Samples) {
			changes = append(changes, minuteChange{old, minute})
		}
	}
	return changes, nil
}

func readQuotaChanges(tx *gorm.DB, options reportAccountOptions) ([]quotaObservation, error) {
	if len(options.Account.Quotas) == 0 {
		return nil, nil
	}
	timestamps := make([]int64, 0, len(options.Account.Quotas))
	// Sequential writes used the last observation when a batch repeated a timestamp.
	incoming := make(map[int64]quotaObservation)
	for _, point := range options.Account.Quotas {
		timestamps = append(timestamps, point.Ts)
		incoming[point.Ts] = point
	}
	var rows []quotaObservation
	err := tx.Raw(`SELECT ts,primary_remaining AS "primary",secondary_remaining AS "secondary",
		primary_reset,secondary_reset FROM official_quota_v2_observations
		WHERE owner_id=? AND account_id=? AND device_id=? AND ts IN ?`,
		options.Owner, options.Account.AccountID, options.Device, timestamps).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, old := range rows {
		if equalQuotaObservation(old, incoming[old.Ts]) {
			delete(incoming, old.Ts)
		}
	}
	changes := make([]quotaObservation, 0, len(incoming))
	for _, point := range incoming {
		changes = append(changes, point)
	}
	return changes, nil
}

func equalQuotaObservation(left, right quotaObservation) bool {
	return equalQuotaValue(left.Primary, right.Primary) && equalQuotaValue(left.Secondary, right.Secondary) &&
		equalQuotaValue(left.PrimaryReset, right.PrimaryReset) && equalQuotaValue(left.SecondaryReset, right.SecondaryReset)
}
