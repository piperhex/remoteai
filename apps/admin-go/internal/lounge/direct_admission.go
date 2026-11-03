package lounge

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type directAdmission struct{ Mutual, Changed bool }

// Established conversations only need a fresh generation check. Keep opening/reply/reset
// transitions in the existing locked transaction; never cache a revocable permission.
func (p postgresDirectPolicy) AdmitMessage(ctx context.Context, request directPermission) (directAdmission, error) {
	var generation int64
	result := p.db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).WithContext(ctx).
		Raw(`SELECT generation FROM lounge_direct_permissions
 WHERE first_user=? AND second_user=? AND initiator IS NULL AND NOT fresh`,
			request.FirstUser, request.SecondUser).Scan(&generation)
	if result.Error != nil {
		return directAdmission{}, result.Error
	}
	if result.RowsAffected == 1 {
		if generation != request.Generation {
			return directAdmission{}, errDirectReset
		}
		return directAdmission{}, nil
	}
	mutual, err := p.AdmitWithContact(ctx, request)
	return directAdmission{Mutual: mutual, Changed: err == nil}, err
}
