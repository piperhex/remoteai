package accounts

import (
	"errors"
	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

func (s *service) upsertAccounts(options writeOptions, incoming []object) (interface{}, error) {
	for _, row := range incoming {
		if err := normalizeAccountAlias(obj(row["privateDetails"])); err != nil {
			return nil, err
		}
	}
	// Bindings and metadata permissions are always checked against current database state.
	bound, err := s.boundAccounts(options.Owner)
	if err != nil {
		return nil, err
	}
	byID := map[string]systemAccount{}
	for _, row := range bound {
		byID[row.SyncAccountID] = row
	}
	for _, row := range incoming {
		if system, ok := byID[str(row["id"])]; ok {
			if err = s.updateBoundMetadata(options, system, row); err != nil {
				return nil, err
			}
		}
	}
	changed := false
	err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
		var e error
		changed, e = saveAccountBatch(tx, options.Owner, incoming, byID)
		return e
	})
	if err != nil {
		return nil, err
	}
	if changed {
		if err = s.invalidate(options.Owner, false); err != nil {
			return nil, err
		}
	}
	return object{"count": len(incoming)}, s.updateSyncDevice(options, incoming)
}

func (s *service) updateBoundMetadata(options writeOptions, system systemAccount, in object) error {
	changed := system.Note != str(in["note"]) || system.ExpiresAt != str(in["expiresAt"])
	if changed && !options.Editable && options.RejectMetadata {
		return platform.NewError(403, "You cannot edit official account notes or expiration dates")
	}
	if changed && options.Editable {
		_, err := s.updateSystem(system.ID, object{"note": in["note"], "expiresAt": in["expiresAt"]}, "")
		return err
	}
	return nil
}

func (s *service) updateSyncDevice(options writeOptions, incoming []object) error {
	if !deviceIDPattern.MatchString(options.Device) {
		return nil
	}
	for _, row := range incoming {
		if row["active"] != true {
			continue
		}
		result := s.deps.DB.Table("remote_devices").
			Where(`"ownerId" = ? AND "deviceId" = ?`, options.Owner, options.Device).
			Where(`"activeAccountId" IS DISTINCT FROM ?`, row["id"]).
			Updates(object{"activeAccountId": row["id"], "lastSeenAt": now()})
		if result.Error == nil && result.RowsAffected > 0 {
			platform.InvalidateDeviceDirectory(s.deps, options.Owner)
		}
		return result.Error
	}
	return nil
}

func (s *service) deleteAccount(owner, id string) (interface{}, error) {
	bound, err := s.boundAccounts(owner)
	if err != nil {
		return nil, err
	}
	deleted := now()
	for _, system := range bound {
		if system.SyncAccountID != id {
			continue
		}
		row := account{}
		err = s.deps.DB.Where(`"ownerId" = ? AND "accountId" = ?`, owner, id).First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			dto := systemSyncDTO(system)
			rowPtr, _, e := mergeAccount(nil, owner, dto)
			if e != nil {
				return nil, e
			}
			row = *rowPtr
		} else if err != nil {
			return nil, err
		}
		row.Active = false
		row.DeletedAt = &deleted
		if err = s.deps.DB.Save(&row).Error; err != nil {
			return nil, err
		}
		err = s.deps.DB.Where(`"systemAccountId" = ? AND "userId" = ?`, system.ID, owner).Delete(&binding{}).Error
		if err != nil {
			return nil, err
		}
		break
	}
	err = s.deps.DB.Model(&account{}).
		Where(`"ownerId" = ? AND "accountId" = ?`, owner, id).
		Updates(object{"active": false, "deletedAt": deleted, "updatedAt": deleted}).
		Error
	if err != nil {
		return nil, err
	}
	return object{"id": id}, s.invalidate(owner, false)
}

func (s *service) updateAdmin(owner, id string, patch object, editable bool) (object, error) {
	bound, err := s.boundAccounts(owner)
	if err != nil {
		return nil, err
	}
	for _, system := range bound {
		if system.SyncAccountID != id {
			continue
		}
		if !editable {
			return nil, platform.NewError(403, "You cannot edit official account notes or expiration dates")
		}
		metadata := object{}
		for _, k := range []string{"note", "expiresAt"} {
			if has(patch, k) {
				metadata[k] = valueOr(patch[k], "")
			}
		}
		return s.updateSystem(system.ID, metadata, "")
	}
	row := account{}
	err = s.deps.DB.Where(`"ownerId" = ? AND "accountId" = ? AND "deletedAt" IS NULL`, owner, id).First(&row).Error
	if err != nil {
		return nil, notFound(err, "Synced account not found")
	}
	row, err = applyAdminPatch(row, patch)
	if err != nil {
		return nil, err
	}
	if patch["active"] == true {
		err = s.deps.DB.Model(&account{}).Where(`"ownerId" = ?`, owner).
			Updates(object{"active": false, "updatedAt": now()}).Error
		if err != nil {
			return nil, err
		}
	}
	if err = s.deps.DB.Save(&row).Error; err != nil {
		return nil, err
	}
	return accountDTO(row), s.invalidate(owner, false)
}

func applyAdminPatch(row account, patch object) (account, error) {
	patch, err := normalizeAdminPatch(patch)
	if err != nil {
		return account{}, err
	}
	values := encodeMap(row)
	v := versions(row.FieldModifiedAt, iso(row.LastModifiedAt), accountFields)
	modified := timestamp(patch["lastModifiedAt"])
	for key, value := range patch {
		target := key
		if key == "accountId" {
			target = "codexAccountId"
		}
		values[target] = value
		versionKey := key
		if key == "email" || key == "plan" || key == "accountId" {
			versionKey = "auth"
		}
		for _, field := range accountFields {
			if versionKey == field {
				v[field] = modified
			}
		}
	}
	values["fieldModifiedAt"] = v
	values["lastModifiedAt"] = latest(v)
	// Decode into a fresh value so replacing a JSON object removes all previous keys.
	updated := account{}
	err = decodeMap(values, &updated)
	return updated, err
}

func normalizeAdminPatch(patch object) (object, error) {
	result := copyObject(patch)
	for key, value := range result {
		if value != nil {
			continue
		}
		switch key {
		case "note", "expiresAt":
			result[key] = ""
		case "usage":
			result[key] = object{}
		case "email", "plan", "active", "auth":
			// Legacy DTOs allow optional null values, but persistence rejects null required fields.
			return nil, errors.New("synced account required field cannot be null")
		}
	}
	return result, nil
}
