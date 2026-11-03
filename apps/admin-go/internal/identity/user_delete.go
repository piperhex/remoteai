package identity

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *service) deleteUserRecord(u *user) error {
	var devices []string
	err := s.deps.DB.Transaction(func(tx *gorm.DB) error {
		// The user FK prevents new devices from appearing after this list and escaping invalidation.
		var locked user
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&locked, "id = ?", u.ID).Error; err != nil {
			return err
		}
		if err := tx.Table("remote_devices").Where(`"ownerId" = ?`, u.ID).Pluck("deviceId", &devices).Error; err != nil {
			return err
		}
		return tx.Delete(u).Error
	})
	if err == nil {
		platform.InvalidatePortMappings(s.deps, u.ID, devices...)
	}
	return err
}
