package accounts

import (
	"context"
	"database/sql"
	"sort"

	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

type officialDeviceTotal struct {
	DeviceID   string  `json:"deviceId"`
	DeviceName string  `json:"deviceName"`
	Tokens     int64   `json:"tokens"`
	CostUSD    float64 `json:"costUsd" gorm:"column:cost_usd"`
	UpdatedAt  int64   `json:"updatedAt"`
}
type officialAccountTotal struct {
	AccountID    string                `json:"accountId"`
	AccountLabel string                `json:"accountLabel"`
	Tokens       int64                 `json:"tokens"`
	CostUSD      float64               `json:"costUsd"`
	RemainingUSD *float64              `json:"remainingUsd"`
	Primary      *quotaEstimate        `json:"primary"`
	Secondary    *quotaEstimate        `json:"secondary"`
	Devices      []officialDeviceTotal `json:"devices"`
}

func (s *service) officialUsageSummary(ctx context.Context, owner string, start, now int64) (interface{}, error) {
	var result interface{}
	ctx, cancel := platform.DatabaseContext(ctx)
	defer cancel()
	err := s.deps.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = readOfficialUsageSummary(tx, owner, start, now)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func readOfficialUsageSummary(tx *gorm.DB, owner string, start, now int64) (interface{}, error) {
	var accounts []struct {
		AccountID string
		Label     string
	}
	if err := tx.Raw(`SELECT account_id,label FROM official_usage_v2_accounts WHERE owner_id=?`, owner).
		Scan(&accounts).Error; err != nil {
		return nil, err
	}
	devices, err := readDeviceTotals(tx, usageSummaryRange{owner, start, now})
	if err != nil {
		return nil, err
	}
	phases, err := readCurrentDeclines(tx, owner, "")
	if err != nil {
		return nil, err
	}
	byAccount := groupQuotaDeclines(phases)
	totals := make([]officialAccountTotal, 0, len(accounts))
	for _, account := range accounts {
		total := officialAccountTotal{AccountID: account.AccountID, AccountLabel: account.Label,
			Devices: []officialDeviceTotal{}}
		if values := devices[account.AccountID]; len(values) > 0 {
			total.Devices = values
		}
		for _, device := range total.Devices {
			total.Tokens += device.Tokens
			total.CostUSD += device.CostUSD
		}
		fillQuotaEstimates(&total, byAccount[account.AccountID], now)
		totals = append(totals, total)
	}
	sort.Slice(totals, func(i, j int) bool { return totals[i].Tokens > totals[j].Tokens })
	return object{"accounts": totals, "status": "ready", "updatedAt": now}, nil
}

type usageSummaryRange struct {
	Owner string
	Start int64
	End   int64
}

func readDeviceTotals(tx *gorm.DB, options usageSummaryRange) (map[string][]officialDeviceTotal, error) {
	var rows []struct {
		AccountID string
		Total     officialDeviceTotal `gorm:"embedded"`
	}
	start, now := options.Start, options.End
	err := tx.Raw(`SELECT m.account_id,m.device_id,d.device_name,
            SUM(CASE WHEN m.minute_ts>=? AND m.minute_ts+59<=? THEN m.total_tokens
            ELSE (SELECT COALESCE(SUM((v->>1)::bigint),0) FROM jsonb_array_elements(m.samples) v
                WHERE m.minute_ts+(v->>0)::bigint BETWEEN ? AND ?) END) AS tokens,
            SUM(CASE WHEN m.minute_ts>=? AND m.minute_ts+59<=? THEN m.cost_usd
            ELSE (SELECT COALESCE(SUM((v->>2)::double precision),0) FROM jsonb_array_elements(m.samples) v
                WHERE m.minute_ts+(v->>0)::bigint BETWEEN ? AND ?) END) AS cost_usd,
            d.reported_at AS updated_at FROM official_usage_v2_minutes m
			JOIN official_usage_v2_devices d ON d.owner_id=m.owner_id AND d.device_id=m.device_id
			WHERE m.owner_id=? AND m.minute_ts>=? AND m.minute_ts<=?
			GROUP BY m.account_id,m.device_id,d.device_name,d.reported_at ORDER BY m.account_id,m.device_id`,
		start, now, start, now, start, now, start, now, options.Owner, start/60*60, now).Scan(&rows).Error
	result := make(map[string][]officialDeviceTotal)
	for _, row := range rows {
		result[row.AccountID] = append(result[row.AccountID], row.Total)
	}
	return result, err
}

func fillQuotaEstimates(total *officialAccountTotal, phases []storedQuotaDecline, now int64) {
	for _, phase := range phases {
		estimate := estimateQuotaDecline(phase.Phase, now)
		if phase.QuotaWindow == primaryQuota {
			total.Primary = &estimate
		} else {
			total.Secondary = &estimate
		}
	}
	total.RemainingUSD = availableOfficialQuota(total.Primary, total.Secondary)
}

func availableOfficialQuota(estimates ...*quotaEstimate) *float64 {
	var remaining *float64
	missing := false
	for _, estimate := range estimates {
		if estimate == nil {
			continue
		}
		if estimate.RemainingUSD == nil {
			missing = true
			continue
		}
		if *estimate.RemainingUSD == 0 {
			zero := 0.0
			return &zero
		}
		if remaining == nil || *estimate.RemainingUSD < *remaining {
			value := *estimate.RemainingUSD
			remaining = &value
		}
	}
	if missing {
		return nil
	}
	return remaining
}
