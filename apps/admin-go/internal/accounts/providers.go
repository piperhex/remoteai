package accounts

import (
	"errors"
	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

func (s *service) providers(owner string) (object, error) {
	if cached, err := s.cached(owner, "providers"); err != nil {
		return nil, err
	} else if cached != nil {
		cached["providers"] = objects(cached["providers"])
		if cached["deletedProviderIds"] == nil {
			cached["deletedProviderIds"] = []string{}
		}
		return cached, nil
	}
	rows := []provider{}
	if err := s.deps.DB.Where(`"ownerId" = ?`, owner).Order("name ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := []object{}
	deleted := []string{}
	for _, row := range rows {
		if row.DeletedAt != nil {
			deleted = append(deleted, row.ProviderID)
		} else {
			items = append(items, providerDTO(row))
		}
	}
	result := object{"providers": items, "deletedProviderIds": deleted}
	return result, s.cache(owner, "providers", result)
}

func (s *service) upsertProviders(owner string, incoming []object) (interface{}, error) {
	changed := false
	err := s.deps.DB.Transaction(func(tx *gorm.DB) error {
		var e error
		changed, e = saveProviderBatch(tx, owner, incoming)
		return e
	})
	if err != nil {
		return nil, err
	}
	if changed {
		err = s.invalidate(owner, true)
	}
	return object{"count": len(incoming)}, err
}

func saveIncomingProvider(tx *gorm.DB, owner string, in object) error {
	_, err := saveProviderBatch(tx, owner, []object{in})
	return err
}

func (s *service) deleteProvider(owner, id string) (interface{}, error) {
	err := s.deps.DB.Model(&provider{}).
		Where(`"ownerId" = ? AND "providerId" = ?`, owner, id).
		Updates(object{"deletedAt": now(), "updatedAt": now()}).
		Error
	if err != nil {
		return nil, err
	}
	return object{"id": id}, s.invalidate(owner, true)
}

func (s *service) deleted(owner string, providers bool) (interface{}, error) {
	items := []object{}
	if providers {
		rows := []provider{}
		err := s.deps.DB.Where(`"ownerId" = ? AND "deletedAt" IS NOT NULL`, owner).
			Order(`"deletedAt" DESC`).
			Find(&rows).
			Error
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			items = append(
				items,
				object{
					"id":        r.ProviderID,
					"name":      r.Name,
					"baseUrl":   r.BaseURL,
					"model":     r.Model,
					"deletedAt": iso(*r.DeletedAt),
				},
			)
		}
		return object{"providers": items}, nil
	}
	rows := []account{}
	err := s.deps.DB.Where(`"ownerId" = ? AND "deletedAt" IS NOT NULL`, owner).
		Order(`"deletedAt" DESC`).
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		items = append(
			items,
			object{
				"id":        r.AccountID,
				"email":     r.Email,
				"note":      r.Note,
				"expiresAt": r.ExpiresAt,
				"plan":      r.Plan,
				"deletedAt": iso(*r.DeletedAt),
			},
		)
	}
	return object{"accounts": items}, nil
}

func (s *service) restore(owner, id string, providers bool) (object, error) {
	if providers {
		row := provider{}
		err := s.deps.DB.Where(`"ownerId" = ? AND "providerId" = ? AND "deletedAt" IS NOT NULL`, owner, id).
			First(&row).
			Error
		if err != nil {
			return nil, notFound(err, "Deleted provider not found")
		}
		row.DeletedAt = nil
		if err = s.deps.DB.Save(&row).Error; err != nil {
			return nil, err
		}
		return providerDTO(row), s.invalidate(owner, true)
	}
	row := account{}
	err := s.deps.DB.Where(`"ownerId" = ? AND "accountId" = ? AND "deletedAt" IS NOT NULL`, owner, id).First(&row).Error
	if err != nil {
		return nil, notFound(err, "Deleted account not found")
	}
	row.DeletedAt = nil
	row.Active = false
	if err = s.deps.DB.Save(&row).Error; err != nil {
		return nil, err
	}
	return accountDTO(row), s.invalidate(owner, false)
}

func (s *service) getVault(owner string) (interface{}, error) {
	row := vault{}
	err := s.deps.DB.Where(`"ownerId" = ?`, owner).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return object{"entries": []object{}, "tombstones": []object{}, "modifiedAt": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	return mergeVault(&row, nil), nil
}

func (s *service) putVault(owner string, in object) (interface{}, error) {
	var result object
	err := s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", owner).Error; e != nil {
			return e
		}
		row := vault{}
		e := tx.Where(`"ownerId" = ?`, owner).First(&row).Error
		var existing *vault
		if e == nil {
			existing = &row
		} else if !errors.Is(e, gorm.ErrRecordNotFound) {
			return e
		}
		result = mergeVault(existing, in)
		if row.ID == "" {
			row.ID = newID()
			row.OwnerID = owner
		}
		row.Entries = result["entries"].([]object)
		row.Tombstones = result["tombstones"].([]object)
		row.ModifiedAt = date(result["modifiedAt"])
		return tx.Save(&row).Error
	})
	return result, err
}

func (s *service) ensureUser(id string) (object, error) {
	row := struct {
		ID    string `gorm:"column:id"`
		Email string `gorm:"column:email"`
	}{}
	err := s.deps.DB.Table("users").Where("id = ?", id).Take(&row).Error
	if err != nil {
		return nil, notFound(err, "User not found")
	}
	return object{"id": row.ID, "email": row.Email}, nil
}

func mismatch(kind string) error {
	return platform.NewError(400, "Route "+kind+" id does not match request body")
}
