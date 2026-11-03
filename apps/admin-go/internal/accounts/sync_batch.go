package accounts

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const syncReadBatchSize = 256

// Read existing records in bounded, owner-scoped queries, including tombstones.
// Lock existing rows for the transaction so simultaneous batches cannot overwrite a newer merge.
func loadSyncRows[T any](tx *gorm.DB, owner, column string, incoming []object) ([]T, error) {
	rows := []T{}
	for start := 0; start < len(incoming); start += syncReadBatchSize {
		end := min(start+syncReadBatchSize, len(incoming))
		ids := make([]string, 0, end-start)
		for _, row := range incoming[start:end] {
			ids = append(ids, str(row["id"]))
		}
		part := []T{}
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(`"ownerId" = ?`, owner).
			Where(clause.IN{Column: clause.Column{Name: column}, Values: stringValues(ids)}).
			Order("id").Find(&part).Error
		if err != nil {
			return nil, err
		}
		rows = append(rows, part...)
	}
	return rows, nil
}

func stringValues(values []string) []interface{} {
	result := make([]interface{}, len(values))
	for i, value := range values {
		result[i] = value
	}
	return result
}

func saveAccountBatch(tx *gorm.DB, owner string, incoming []object, bound map[string]systemAccount) (bool, error) {
	rows, err := loadSyncRows[account](tx, owner, "accountId", incoming)
	if err != nil {
		return false, err
	}
	existing := map[string]*account{}
	for i := range rows {
		existing[rows[i].AccountID] = &rows[i]
	}
	changed := false
	for _, in := range incoming {
		_, official := bound[str(in["id"])]
		merged, active, err := mergeSyncAccount(existing[str(in["id"])], owner, in, official)
		if err != nil {
			return false, err
		}
		if merged == nil {
			continue
		}
		if active && merged.Active {
			if err = deactivateSyncAccounts(tx, owner, existing); err != nil {
				return false, err
			}
		}
		if err = writeSyncRow(tx, merged, existing[merged.AccountID] != nil); err != nil {
			return false, err
		}
		existing[merged.AccountID] = merged
		changed = true
	}
	return changed, nil
}

func deactivateSyncAccounts(tx *gorm.DB, owner string, existing map[string]*account) error {
	err := tx.Model(&account{}).Where(`"ownerId" = ? AND active = true`, owner).
		Updates(object{"active": false, "updatedAt": now()}).Error
	if err != nil {
		return err
	}
	for _, row := range existing {
		row.Active = false
	}
	return nil
}

func mergeSyncAccount(old *account, owner string, in object, official bool) (*account, bool, error) {
	if !official {
		return mergeAccount(old, owner, in)
	}
	if !has(in, "privateDetails") || in["privateDetails"] == nil {
		return nil, false, nil
	}
	if old == nil {
		merged, _, err := mergeAccount(nil, owner, in)
		return merged, false, err
	}
	previous := versions(old.FieldModifiedAt, iso(old.LastModifiedAt), accountFields)
	next := versions(obj(in["fieldModifiedAt"]), in["lastModifiedAt"], accountFields)
	if !newer(next["privateDetails"], previous["privateDetails"]) {
		return nil, false, nil
	}
	row := *old
	row.PrivateDetails = preserveAccountAlias(obj(in["privateDetails"]), row.PrivateDetails)
	previous["privateDetails"] = next["privateDetails"]
	row.FieldModifiedAt = previous
	row.LastModifiedAt = date(latest(previous))
	row.DeletedAt = nil
	return &row, false, nil
}

func saveProviderBatch(tx *gorm.DB, owner string, incoming []object) (bool, error) {
	rows, err := loadSyncRows[provider](tx, owner, "providerId", incoming)
	if err != nil {
		return false, err
	}
	existing := map[string]*provider{}
	for i := range rows {
		existing[rows[i].ProviderID] = &rows[i]
	}
	changed := false
	for _, in := range incoming {
		merged, err := mergeProvider(existing[str(in["id"])], owner, in)
		if err != nil {
			return false, err
		}
		if merged == nil {
			continue
		}
		if err = writeSyncRow(tx, merged, existing[merged.ProviderID] != nil); err != nil {
			return false, err
		}
		existing[merged.ProviderID] = merged
		changed = true
	}
	return changed, nil
}

// New records use INSERT directly instead of GORM Save's unsuccessful UPDATE followed by INSERT.
func writeSyncRow[T any](tx *gorm.DB, row *T, exists bool) error {
	if !exists {
		return tx.Create(row).Error
	}
	return tx.Save(row).Error
}
