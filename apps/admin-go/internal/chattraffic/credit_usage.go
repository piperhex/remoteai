package chattraffic

import (
	"time"

	"gorm.io/gorm"
)

// The caller holds lockUser for its entire allocation transaction. Credit is authoritative:
// combine used/reserved reads into one round trip without caching or increasing crash exposure.
func readCreditUsage(db *gorm.DB, owner string, now time.Time) (Usage, int64, error) {
	month := MonthStart(now)
	var row struct {
		Usage    `gorm:"embedded"`
		Reserved int64
	}
	err := db.Raw(`SELECT COALESCE(l.monthly_limit_bytes,-1) AS monthly_limit_bytes,
 COALESCE(m.bytes,0) AS month_used_bytes,
 COALESCE((SELECT SUM(bytes) FROM chat_relay_budgets WHERE user_id=u.id AND hour_start>=? AND NOT closed),0)
 + COALESCE((SELECT SUM(reserved) FROM chat_relay_bulk_leases
   WHERE user_id=u.id AND hour_start>=? AND state<>'closed'),0) AS reserved
 FROM users u LEFT JOIN chat_relay_user_limits l ON l.user_id=u.id
 LEFT JOIN chat_relay_user_months m ON m.user_id=u.id AND m.month_start=? WHERE u.id=?`,
		month, month, month, owner).Scan(&row).Error
	row.ResetAt = month.AddDate(0, 1, 0)
	return row.Usage, row.Reserved, err
}
