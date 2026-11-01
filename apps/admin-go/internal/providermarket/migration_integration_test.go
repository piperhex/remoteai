package providermarket

import (
	"errors"
	"os"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func TestDatabaseReviewMigrationQueuesLegacyOnlyOnce(t *testing.T) {
	db := testDatabase(t)
	owner := testUser(t, db)
	script, err := os.ReadFile("../../sql/20261102_provider_market_review.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(string(script)), "BEGIN;"), "COMMIT;")
	rollback := errors.New("rollback migration fixture")
	err = db.Transaction(func(tx *gorm.DB) error {
		community, err := mutate(tx, change{Owner: owner, Input: saveInput{Draft: fixture(), Published: pointer(true)}})
		if err != nil {
			return err
		}
		official, err := mutate(tx, change{Official: true, Input: saveInput{Draft: fixture(), Published: pointer(true)}})
		if err != nil {
			return err
		}
		if err = tx.Exec(`ALTER TABLE provider_market_items DROP COLUMN review_status,
			DROP COLUMN review_reason, DROP COLUMN reviewed_by, DROP COLUMN reviewed_at, DROP COLUMN marketing_badge`).Error; err != nil {
			return err
		}
		if err = tx.Exec(sql).Error; err != nil {
			return err
		}
		community, err = findItem(tx, community.ID)
		if err != nil {
			return err
		}
		official, err = findItem(tx, official.ID)
		if err != nil {
			return err
		}
		if isPublic(community) || community.ReviewStatus != reviewPending || !isPublic(official) {
			return errors.New("migration did not queue legacy community content")
		}
		community, err = reviewItem(tx, community.ID, owner,
			reviewInput{Revision: community.Revision, Decision: reviewApproved})
		if err != nil {
			return err
		}
		if err = tx.Exec(sql).Error; err != nil {
			return err
		}
		community, err = findItem(tx, community.ID)
		if err != nil {
			return err
		}
		if !isPublic(community) {
			return errors.New("repeated migration revoked an approval")
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
}
