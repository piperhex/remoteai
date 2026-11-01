package providermarket

import (
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type reviewStatus string

const (
	reviewDraft           reviewStatus = "draft"
	reviewPending         reviewStatus = "pending"
	reviewApproved        reviewStatus = "approved"
	reviewRejected        reviewStatus = "rejected"
	maxBadgeLength                     = 24
	maxReviewReasonLength              = 400
)

type marketingBadge struct {
	Text string `json:"text"`
	Tone string `json:"tone"`
}

func validReviewStatus(status reviewStatus) bool {
	return status == reviewDraft || status == reviewPending || status == reviewApproved || status == reviewRejected
}

func isPublic(value item) bool { return value.Published && value.ReviewStatus == reviewApproved }

// Each publisher write replaces the candidate, so no unreviewed revision remains public.
func resetReview(value *item) {
	value.ReviewStatus = reviewPending
	if value.Official {
		value.ReviewStatus = reviewApproved
	} else if !value.Published {
		value.ReviewStatus = reviewDraft
	}
	value.ReviewReason, value.ReviewedBy, value.ReviewedAt = "", nil, nil
}

type reviewInput struct {
	Revision int64        `json:"revision"`
	Decision reviewStatus `json:"decision"`
	Reason   string       `json:"reason"`
}

func validReview(input reviewInput) bool {
	if input.Revision < 1 || !validText(input.Reason, maxReviewReasonLength) {
		return false
	}
	return input.Decision == reviewApproved && input.Reason == "" ||
		input.Decision == reviewRejected && strings.TrimSpace(input.Reason) != ""
}

func reviewItem(db *gorm.DB, id string, reviewer string, input reviewInput) (item, error) {
	var value item
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&value, "id = ?", id).Error; err != nil {
			return missingRecord(err)
		}
		if value.Revision != input.Revision {
			return conflict()
		}
		if value.Official || !value.Published ||
			(value.ReviewStatus != reviewPending && input.Decision == reviewApproved) {
			return invalid()
		}
		if input.Decision == reviewApproved && (validate(value.Draft) != nil || value.Draft.PageLink == nil) {
			return invalid()
		}
		now := time.Now()
		value.ReviewStatus, value.ReviewReason = input.Decision, strings.TrimSpace(input.Reason)
		value.ReviewedBy, value.ReviewedAt = &reviewer, &now
		value.Revision++
		return tx.Omit("UserCount").Save(&value).Error
	})
	return value, err
}

func (s service) review(c *gin.Context) {
	var input reviewInput
	if decode(c, &input) != nil || !validReview(input) || !validItemID(c.Param("id")) {
		platform.Respond(c, nil, invalid())
		return
	}
	value, err := reviewItem(s.deps.DB.WithContext(c.Request.Context()), c.Param("id"), platform.User(c).ID, input)
	platform.Respond(c, present(value), err)
}

func validBadge(badge *marketingBadge) bool {
	if badge == nil {
		return true
	}
	if strings.TrimSpace(badge.Text) == "" || !validText(badge.Text, maxBadgeLength) ||
		strings.ContainsAny(badge.Text, "\r\n") {
		return false
	}
	switch badge.Tone {
	case "blue", "green", "orange", "red", "purple":
		return true
	default:
		return false
	}
}

func updateBadge(db *gorm.DB, id string, revision int64, badge *marketingBadge) (item, error) {
	var value item
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&value, "id = ?", id).Error; err != nil {
			return missingRecord(err)
		}
		if value.Revision != revision {
			return conflict()
		}
		value.MarketingBadge = badge
		value.Revision++
		return tx.Omit("UserCount").Save(&value).Error
	})
	return value, err
}

func (s service) badge(c *gin.Context) {
	var input struct {
		Revision int64           `json:"revision"`
		Badge    *marketingBadge `json:"badge"`
	}
	if decode(c, &input) != nil || input.Revision < 1 || !validItemID(c.Param("id")) || !validBadge(input.Badge) {
		platform.Respond(c, nil, invalid())
		return
	}
	value, err := updateBadge(s.deps.DB.WithContext(c.Request.Context()), c.Param("id"), input.Revision, input.Badge)
	platform.Respond(c, present(value), err)
}
