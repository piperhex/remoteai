package providermarket

import (
	"strings"
	"testing"
)

func TestReviewPolicyAndValidation(t *testing.T) {
	for _, test := range []struct {
		official, published bool
		status              reviewStatus
	}{
		{false, true, reviewPending}, {false, false, reviewDraft},
		{true, true, reviewApproved}, {true, false, reviewApproved},
	} {
		value := item{Official: test.official, Published: test.published, ReviewStatus: reviewApproved, ReviewReason: "old"}
		resetReview(&value)
		if value.ReviewStatus != test.status || value.ReviewReason != "" ||
			isPublic(value) != (test.official && test.published) {
			t.Fatal("wrong publication policy", value)
		}
	}
	for _, input := range []reviewInput{
		{Revision: 1, Decision: reviewApproved}, {Revision: 1, Decision: reviewRejected, Reason: "Fix the page"},
	} {
		if !validReview(input) {
			t.Fatal("valid review refused", input)
		}
	}
	for _, input := range []reviewInput{
		{Decision: reviewApproved}, {Revision: 1, Decision: reviewPending},
		{Revision: 1, Decision: reviewApproved, Reason: "Unexpected"},
		{Revision: 1, Decision: reviewRejected, Reason: "  "},
		{Revision: 1, Decision: reviewRejected, Reason: strings.Repeat("x", maxReviewReasonLength+1)},
	} {
		if validReview(input) {
			t.Fatal("invalid review accepted", input)
		}
	}
}

func TestMarketingBadgeValidation(t *testing.T) {
	for _, badge := range []*marketingBadge{nil, {Text: "限时优惠", Tone: "orange"}, {Text: "Offer", Tone: "blue"}} {
		if !validBadge(badge) {
			t.Fatal("valid badge refused", badge)
		}
	}
	for _, badge := range []*marketingBadge{
		{Text: " ", Tone: "red"}, {Text: "Offer", Tone: "url(javascript:alert(1))"},
		{Text: "line\nbreak", Tone: "green"}, {Text: strings.Repeat("长", maxBadgeLength+1), Tone: "purple"},
	} {
		if validBadge(badge) {
			t.Fatal("invalid badge accepted", badge)
		}
	}
}
