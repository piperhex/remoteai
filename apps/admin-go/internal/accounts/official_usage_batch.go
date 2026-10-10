package accounts

import (
	"encoding/json"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type usageMinuteRow struct {
	OwnerID, DeviceID, AccountID string
	MinuteTs                     int64
	Samples                      string `gorm:"type:jsonb"`
	TotalTokens                  int64
	CostUSD                      float64 `gorm:"column:cost_usd"`
}

type quotaObservationRow struct {
	OwnerID, AccountID, DeviceID         string
	Ts                                   int64
	PrimaryRemaining, SecondaryRemaining *float64
	PrimaryReset, SecondaryReset         *int64
}

func writeUsageChanges(tx *gorm.DB, options reportAccountOptions, changes usageChanges) error {
	if err := writeUsageMinutes(tx, options, changes.minutes); err != nil {
		return err
	}
	if len(changes.quotas) == 0 {
		return nil
	}
	rows := make([]quotaObservationRow, 0, len(changes.quotas))
	for _, point := range changes.quotas {
		rows = append(rows, quotaObservationRow{options.Owner, options.Account.AccountID, options.Device,
			point.Ts, point.Primary, point.Secondary, point.PrimaryReset, point.SecondaryReset})
	}
	return tx.Table("official_quota_v2_observations").Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "owner_id"}, {Name: "account_id"}, {Name: "device_id"}, {Name: "ts"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"primary_remaining", "secondary_remaining", "primary_reset", "secondary_reset"}),
	}).Create(&rows).Error
}

func writeUsageMinutes(tx *gorm.DB, options reportAccountOptions, changes []minuteChange) error {
	if len(changes) == 0 {
		return nil
	}
	rows := make([]usageMinuteRow, 0, len(changes))
	for _, change := range changes {
		minute := change.next
		encoded, err := json.Marshal(minute.Samples)
		if err != nil {
			return err
		}
		row := usageMinuteRow{OwnerID: options.Owner, DeviceID: options.Device,
			AccountID: options.Account.AccountID, MinuteTs: minute.Ts, Samples: string(encoded)}
		for _, sample := range minute.Samples {
			row.TotalTokens += int64(sample[1])
			row.CostUSD += sample[2]
		}
		rows = append(rows, row)
	}
	// Absolute totals preserve retries and late completions; batch writes avoid per-minute round trips.
	return tx.Table("official_usage_v2_minutes").Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "owner_id"}, {Name: "device_id"}, {Name: "account_id"}, {Name: "minute_ts"}},
		DoUpdates: clause.AssignmentColumns([]string{"samples", "total_tokens", "cost_usd"}),
	}).Create(&rows).Error
}
