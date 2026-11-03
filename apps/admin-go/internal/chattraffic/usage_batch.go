package chattraffic

import (
	"time"

	"gorm.io/gorm"
)

const usageBatchSize = 256

// ReadUsages reads each account once in bounded batches, using one month boundary for the entire push.
// This is display data only; relay authorization continues to reserve durable credit separately.
func ReadUsages(db *gorm.DB, owners []string, now time.Time) (map[string]Usage, error) {
	result := make(map[string]Usage, len(owners))
	seen := make(map[string]bool, len(owners))
	unique := make([]string, 0, len(owners))
	for _, owner := range owners {
		if owner != "" && !seen[owner] {
			unique = append(unique, owner)
			seen[owner] = true
		}
	}
	month := MonthStart(now)
	for start := 0; start < len(unique); start += usageBatchSize {
		var rows []struct {
			UserID string
			Usage  `gorm:"embedded"`
		}
		err := db.Raw(`SELECT u.id AS user_id,COALESCE(l.monthly_limit_bytes,-1) AS monthly_limit_bytes,
 COALESCE(m.bytes,0) AS month_used_bytes FROM users u
 LEFT JOIN chat_relay_user_limits l ON l.user_id=u.id
 LEFT JOIN chat_relay_user_months m ON m.user_id=u.id AND m.month_start=? WHERE u.id IN ?`,
			month, unique[start:min(start+usageBatchSize, len(unique))]).Scan(&rows).Error
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			row.ResetAt = month.AddDate(0, 1, 0)
			result[row.UserID] = row.Usage
		}
	}
	return result, nil
}
