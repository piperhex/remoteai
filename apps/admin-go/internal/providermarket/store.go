package providermarket

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const countSQL = `(SELECT count(*) FROM provider_market_usage u WHERE u.item_id = provider_market_items.id)`
const marketOrder = `sort_order ASC NULLS LAST, user_count DESC, created_at DESC, id ASC`

func queryItems(db *gorm.DB) *gorm.DB {
	return db.Model(&item{}).Select("provider_market_items.*, " + countSQL + " AS user_count")
}
func findItem(db *gorm.DB, id string) (item, error) {
	if !validItemID(id) {
		return item{}, invalid()
	}
	var value item
	err := queryItems(db).Where("id = ?", id).Take(&value).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = missing()
	}
	return value, err
}
func owns(value item, owner string, official bool) bool {
	if official {
		return value.Official
	}
	return !value.Official && value.OwnerID != nil && *value.OwnerID == owner
}

type change struct {
	ID       string
	Owner    string
	Official bool
	Delete   bool
	Input    saveInput
}

func mutate(db *gorm.DB, request change) (item, error) {
	var result item
	err := db.Transaction(func(tx *gorm.DB) error {
		if request.ID == "" {
			result = item{ID: uuid.NewString(), Revision: 1, Official: request.Official}
			if !request.Official {
				result.OwnerID = &request.Owner
			}
		} else {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&result, "id = ?", request.ID).Error; err != nil {
				return missingRecord(err)
			}
			if !owns(result, request.Owner, request.Official) {
				return denied()
			}
			if result.Revision != request.Input.Revision {
				return conflict()
			}
			result.Revision++
		}
		if request.Delete {
			return tx.Delete(&result).Error
		}
		result.Draft, result.Published = request.Input.Draft, *request.Input.Published
		resetReview(&result)
		return tx.Omit("UserCount").Save(&result).Error
	})
	return result, err
}
func missingRecord(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return missing()
	}
	return err
}
func updateOrder(db *gorm.DB, id string, revision int64, order *int64) (item, error) {
	updated := db.Model(&item{}).Where("id = ? AND revision = ?", id, revision).
		Updates(map[string]interface{}{"sort_order": order, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()})
	if updated.Error != nil {
		return item{}, updated.Error
	}
	if updated.RowsAffected != 1 {
		return item{}, conflict()
	}
	return findItem(db, id)
}

// recordUsage counts only a real, successfully persisted personal cloud Provider, never a client increment.
// Anonymous and cloud-sync-disabled local additions remain available but are excluded from this metric.
func recordUsage(db *gorm.DB, owner, id, providerID string) (bool, error) {
	counted := false
	err := db.Transaction(func(tx *gorm.DB) error {
		value, err := findItem(tx, id)
		if err != nil {
			return err
		}
		if !isPublic(value) {
			return missing()
		}
		models := make([]string, len(value.Draft.Models))
		for index, m := range value.Draft.Models {
			models[index] = m.ID
		}
		var count int64
		err = tx.Table("synced_providers").Where(`"ownerId" = ? AND "providerId" = ? AND "deletedAt" IS NULL
			AND rtrim("baseUrl", '/') = rtrim(?, '/') AND model IN ? AND "apiKey" <> ''`,
			owner, providerID, value.Draft.BaseURL, models).
			Count(&count).Error
		if err != nil || count == 0 {
			return err
		}
		row := usage{ItemID: id, OwnerID: owner, ProviderID: providerID}
		err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
		counted = err == nil
		return err
	})
	return counted, err
}
