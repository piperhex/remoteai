package providermarket

import (
	"sort"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxBatchItems = 40

type itemRevision struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

type batchInput struct {
	Items []itemRevision `json:"items"`
}

type batchReviewInput struct {
	Items    []itemRevision `json:"items"`
	Decision reviewStatus   `json:"decision"`
	Reason   string         `json:"reason"`
}

func validBatch(items []itemRevision) bool {
	if len(items) == 0 || len(items) > maxBatchItems {
		return false
	}
	seen := make(map[string]bool, len(items))
	for _, entry := range items {
		if !validItemID(entry.ID) || entry.Revision < 1 || seen[entry.ID] {
			return false
		}
		seen[entry.ID] = true
	}
	return true
}

// A consistent lock order prevents overlapping batches from deadlocking. The transaction
// rolls back every change if any selected revision has changed or is no longer eligible.
func mutateBatch(db *gorm.DB, items []itemRevision, apply func(*gorm.DB, itemRevision) error) error {
	if !validBatch(items) {
		return invalid()
	}
	ordered := append([]itemRevision(nil), items...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	return db.Transaction(func(tx *gorm.DB) error {
		for _, entry := range ordered {
			if err := apply(tx, entry); err != nil {
				return err
			}
		}
		return nil
	})
}

func deleteMarketItem(tx *gorm.DB, entry itemRevision) error {
	var value item
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&value, "id = ?", entry.ID).Error; err != nil {
		return missingRecord(err)
	}
	if value.Revision != entry.Revision {
		return conflict()
	}
	return tx.Delete(&value).Error
}

func (s service) batchDelete(c *gin.Context) {
	var input batchInput
	if decode(c, &input) != nil || !validBatch(input.Items) {
		platform.Respond(c, nil, invalid())
		return
	}
	err := mutateBatch(s.deps.DB.WithContext(c.Request.Context()), input.Items, deleteMarketItem)
	platform.Respond(c, gin.H{"ok": err == nil}, err)
}

func (s service) batchReview(c *gin.Context) {
	var input batchReviewInput
	reviewer := platform.User(c).ID
	if decode(c, &input) != nil || !validBatch(input.Items) || !validReview(reviewInput{
		Revision: 1, Decision: input.Decision, Reason: input.Reason,
	}) {
		platform.Respond(c, nil, invalid())
		return
	}
	err := mutateBatch(s.deps.DB.WithContext(c.Request.Context()), input.Items,
		func(tx *gorm.DB, entry itemRevision) error {
			var value item
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&value, "id = ?", entry.ID).Error; err != nil {
				return missingRecord(err)
			}
			if value.Revision != entry.Revision {
				return conflict()
			}
			if value.ReviewStatus != reviewPending {
				return invalid()
			}
			_, err := reviewItem(tx, entry.ID, reviewer, reviewInput{
				Revision: entry.Revision, Decision: input.Decision, Reason: input.Reason,
			})
			return err
		})
	platform.Respond(c, gin.H{"ok": err == nil}, err)
}
