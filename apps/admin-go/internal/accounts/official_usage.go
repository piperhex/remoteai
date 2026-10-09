package accounts

import (
	"math"
	"strconv"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

const usageMinuteSeconds = 60
const usageRetentionSeconds = 53 * 7 * 24 * 60 * 60

// A minute is a compact batch of [second offset, token total, USD cost].
// Retaining second offsets aligns costs exactly with quota observations without request IDs or model metadata.
type usageMinute struct {
	Ts      int64        `json:"ts"`
	Samples [][3]float64 `json:"samples"`
}
type quotaObservation struct {
	Ts                int64    `json:"ts"`
	Primary           *float64 `json:"primaryRemainingPercent"`
	Secondary         *float64 `json:"secondaryRemainingPercent"`
	PrimaryReset      *int64   `json:"primaryResetAt"`
	SecondaryReset    *int64   `json:"secondaryResetAt"`
	PrimaryObserved   bool     `json:"-" gorm:"-"`
	SecondaryObserved bool     `json:"-" gorm:"-"`
}
type accountUsageReport struct {
	AccountID    string             `json:"accountId"`
	AccountLabel string             `json:"accountLabel"`
	Minutes      []usageMinute      `json:"minutes"`
	Quotas       []quotaObservation `json:"quotas"`
}
type officialUsageReport struct {
	DeviceName string               `json:"deviceName"`
	Accounts   []accountUsageReport `json:"accounts"`
}

func (s *service) registerOfficialUsage(r *gin.RouterGroup, read gin.HandlerFunc) {
	// Account readers may report their own consumption without editing the account credentials.
	r.POST("/records", read, noStore, endpoint(s.reportOfficialUsage))
	r.GET("/summary", read, noStore, endpoint(s.getOfficialUsageSummary))
}

func usageInvalid() error { return platform.NewError(400, "Invalid official account usage") }

func (s *service) reportOfficialUsage(c *gin.Context) (interface{}, error) {
	var report officialUsageReport
	device := c.GetHeader("x-device-id")
	now := time.Now().Unix()
	if c.ShouldBindJSON(&report) != nil || !validUsageReport(report, device, now) {
		return nil, usageInvalid()
	}
	return object{"ok": true}, s.storeUsageReport(platform.User(c).ID, device, report)
}

func (s *service) getOfficialUsageSummary(c *gin.Context) (interface{}, error) {
	now := time.Now().Unix()
	start, err := strconv.ParseInt(c.DefaultQuery("startTs", "0"), 10, 64)
	if err != nil || start < 0 || start > now {
		return nil, usageInvalid()
	}
	start = max(start, now-usageRetentionSeconds)
	return s.officialUsageSummary(platform.User(c).ID, start, now)
}

func validUsageReport(report officialUsageReport, device string, now int64) bool {
	if device == "" || len(device) > 128 || len(report.DeviceName) > 256 || len(report.Accounts) > 1000 {
		return false
	}
	count := 0
	seen := map[string]bool{}
	for _, account := range report.Accounts {
		if account.AccountID == "" || len(account.AccountID) > 256 || len(account.AccountLabel) > 512 ||
			seen[account.AccountID] {
			return false
		}
		seen[account.AccountID] = true
		count += len(account.Minutes) + len(account.Quotas)
		if count > 2000 || !validAccountUsageReport(account, now) {
			return false
		}
	}
	return true
}

func validAccountUsageReport(account accountUsageReport, now int64) bool {
	seen := map[int64]bool{}
	for _, minute := range account.Minutes {
		if seen[minute.Ts] || !validUsageMinute(minute, now) {
			return false
		}
		seen[minute.Ts] = true
	}
	for _, point := range account.Quotas {
		if point.Ts < 0 || point.Ts > now || !validQuotaPercent(point.Primary) ||
			!validQuotaPercent(point.Secondary) {
			return false
		}
	}
	return true
}

func validUsageMinute(minute usageMinute, now int64) bool {
	if minute.Ts < 0 || minute.Ts > now || minute.Ts%usageMinuteSeconds != 0 ||
		len(minute.Samples) == 0 || len(minute.Samples) > 60 {
		return false
	}
	previous := -1.0
	for _, sample := range minute.Samples {
		if !finiteUsageNumber(sample[0], 59) || minute.Ts+int64(sample[0]) > now ||
			sample[0] <= previous || sample[0] != math.Trunc(sample[0]) ||
			!finiteUsageNumber(sample[1], 1e15) || sample[1] != math.Trunc(sample[1]) ||
			!finiteUsageNumber(sample[2], 1e9) {
			return false
		}
		previous = sample[0]
	}
	return true
}

func finiteUsageNumber(value, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= maximum
}
func validQuotaPercent(value *float64) bool { return value == nil || finiteUsageNumber(*value, 100) }
