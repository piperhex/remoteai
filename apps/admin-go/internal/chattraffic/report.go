package chattraffic

import (
	"time"

	"gorm.io/gorm"
)

type UserTraffic struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	TotalBytes int64  `json:"totalBytes"`
	MonthBytes int64  `json:"monthBytes"`
	Usage
}

// UserSummary aggregates relay usage across all users, independent of search and pagination.
type UserSummary struct {
	MonthBytes       int64 `json:"monthBytes"`
	TotalBytes       int64 `json:"totalBytes"`
	MonthActiveUsers int64 `json:"monthActiveUsers"`
	TotalActiveUsers int64 `json:"totalActiveUsers"`
}

type Day struct {
	Date        string  `json:"date"`
	Bytes       int64   `json:"bytes"`
	HourlyBytes []int64 `json:"hourlyBytes"`
}

type Hour struct {
	HourStart time.Time
	Bytes     int64
}

func Daily(rows []Hour, month time.Time) []Day {
	hours := map[int64]int64{}
	for _, row := range rows {
		hours[row.HourStart.Unix()] += row.Bytes
	}
	days := []Day{}
	for date := month; date.Before(month.AddDate(0, 1, 0)); date = date.AddDate(0, 0, 1) {
		day := Day{Date: date.Format("2006-01-02"), HourlyBytes: make([]int64, 24)}
		for hour := range day.HourlyBytes {
			day.HourlyBytes[hour] = hours[date.Add(time.Duration(hour)*time.Hour).Unix()]
			day.Bytes += day.HourlyBytes[hour]
		}
		days = append(days, day)
	}
	return days
}

func UserQuery(db *gorm.DB, month time.Time) *gorm.DB {
	current := MonthStart(time.Now())
	return db.Table("users u").Select(`u.id,u.email,COALESCE(t.bytes,0) AS total_bytes,
 COALESCE(m.bytes,0) AS month_bytes,COALESCE(c.bytes,0) AS month_used_bytes,
 COALESCE(l.monthly_limit_bytes,-1) AS monthly_limit_bytes`).
		Joins(`LEFT JOIN (SELECT user_id,SUM(bytes) AS bytes FROM chat_relay_user_months GROUP BY user_id) t
 ON t.user_id=u.id`).
		Joins("LEFT JOIN chat_relay_user_months m ON m.user_id=u.id AND m.month_start=?", month).
		Joins("LEFT JOIN chat_relay_user_months c ON c.user_id=u.id AND c.month_start=?", current).
		Joins("LEFT JOIN chat_relay_user_limits l ON l.user_id=u.id")
}

// ReadUserSummary counts a user as active only when their relay usage is greater than zero.
func ReadUserSummary(db *gorm.DB, month time.Time) (UserSummary, error) {
	var summary UserSummary
	err := db.Table("chat_relay_user_months").Select(`COALESCE(SUM(bytes),0) AS total_bytes,
 COALESCE(SUM(bytes) FILTER (WHERE month_start=?),0) AS month_bytes,
 COUNT(DISTINCT user_id) FILTER (WHERE month_start=? AND bytes>0) AS month_active_users,
 COUNT(DISTINCT user_id) FILTER (WHERE bytes>0) AS total_active_users`, month, month).Scan(&summary).Error
	return summary, err
}

func ReadDaily(db *gorm.DB, owner string, month time.Time) ([]Day, error) {
	rows := []Hour{}
	err := db.Table("chat_relay_user_hours").Where("user_id=? AND hour_start>=? AND hour_start<?",
		owner, month, month.AddDate(0, 1, 0)).Find(&rows).Error
	return Daily(rows, month), err
}
