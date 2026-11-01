// Package providermarket owns public Provider definitions, independently of personal Providers.
package providermarket

import "time"

type price struct {
	Input       *float64 `json:"input"`
	Output      *float64 `json:"output"`
	CachedInput *float64 `json:"cachedInput"`
}
type tier struct {
	price
	Multiplier           float64 `json:"multiplier"`
	LongContextThreshold *int64  `json:"longContextThreshold"`
	LongContext          price   `json:"longContext"`
}
type model struct {
	ID       string `json:"id"`
	Protocol string `json:"protocol"`
	Tiers    []tier `json:"tiers"`
}

// draft is an explicit public allowlist. No credential or arbitrary request-options fields belong here.
type draft struct {
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	BaseURL      string        `json:"baseUrl"`
	Currency     string        `json:"currency"`
	Unit         string        `json:"unit"`
	Models       []model       `json:"models"`
	BalanceQuery *balanceQuery `json:"balanceQuery"`
	PageLink     *PageLink     `json:"pageLink"`
}
type balanceQuery struct {
	URL    string `json:"url"`
	Auth   string `json:"auth"`
	Script string `json:"script"`
}
type item struct {
	ID             string          `gorm:"primaryKey" json:"id"`
	OwnerID        *string         `json:"ownerId"`
	Official       bool            `json:"official"`
	Published      bool            `json:"published"`
	Revision       int64           `json:"revision"`
	SortOrder      *int64          `json:"sortOrder"`
	Draft          draft           `gorm:"serializer:json;type:jsonb" json:"-"`
	CreatedAt      time.Time       `json:"-"`
	UpdatedAt      time.Time       `json:"-"`
	UserCount      int64           `gorm:"->;-:migration" json:"userCount"`
	ReviewStatus   reviewStatus    `json:"-"`
	ReviewReason   string          `json:"-"`
	ReviewedBy     *string         `json:"-"`
	ReviewedAt     *time.Time      `json:"-"`
	MarketingBadge *marketingBadge `gorm:"serializer:json;type:jsonb" json:"-"`
}

func (item) TableName() string { return "provider_market_items" }

type usage struct {
	ItemID     string `gorm:"primaryKey"`
	OwnerID    string `gorm:"primaryKey"`
	ProviderID string
	CreatedAt  time.Time
}

func (usage) TableName() string { return "provider_market_usage" }

type presentation struct {
	draft
	ID             string          `json:"id"`
	OwnerID        *string         `json:"ownerId"`
	Official       bool            `json:"official"`
	Published      bool            `json:"published"`
	Revision       int64           `json:"revision"`
	SortOrder      *int64          `json:"sortOrder"`
	UserCount      int64           `json:"userCount"`
	ReviewStatus   reviewStatus    `json:"reviewStatus"`
	ReviewReason   string          `json:"reviewReason"`
	MarketingBadge *marketingBadge `json:"marketingBadge"`
}

func present(value item) presentation {
	return presentation{draft: value.Draft, ID: value.ID, OwnerID: value.OwnerID, Official: value.Official,
		Published: value.Published, Revision: value.Revision, SortOrder: value.SortOrder, UserCount: value.UserCount,
		ReviewStatus: value.ReviewStatus, ReviewReason: value.ReviewReason, MarketingBadge: value.MarketingBadge}
}

type saveInput struct {
	Draft     draft `json:"draft"`
	Revision  int64 `json:"revision"`
	Published *bool `json:"published"`
}
