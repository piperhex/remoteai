package providermarket

import (
	"strconv"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

type service struct{ deps *platform.Dependencies }

func Register(r *gin.Engine, deps *platform.Dependencies) error {
	s := service{deps}
	r.GET("/provider-market", s.list)
	r.GET("/provider-market/mine", deps.RequireAuth(), s.list)
	r.GET("/provider-market/:id", s.get)
	r.POST("/provider-market", deps.RequireAuth(), s.save(false))
	r.PUT("/provider-market/:id", deps.RequireAuth(), s.save(false))
	r.DELETE("/provider-market/:id", deps.RequireAuth(), s.remove(false))
	r.POST("/provider-market/:id/usage", deps.RequireAuth(), s.usage)
	a := r.Group("/admin/api/provider-market", deps.RequirePermissions("admin.provider-market.read"))
	a.GET("", s.list)
	a.POST("", deps.RequirePermissions("admin.provider-market.manage"), s.save(true))
	a.PUT("/:id", deps.RequirePermissions("admin.provider-market.manage"), s.save(true))
	a.DELETE("/:id", deps.RequirePermissions("admin.provider-market.manage"), s.remove(true))
	a.PATCH("/:id/order", deps.RequirePermissions("admin.provider-market.order"), s.order)
	a.PATCH("/:id/review", deps.RequirePermissions("admin.provider-market.review"), s.review)
	a.PATCH("/:id/badge", deps.RequirePermissions("admin.provider-market.promote"), s.badge)
	return nil
}
func (s service) list(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	query := queryItems(s.deps.DB.WithContext(c.Request.Context()))
	switch c.FullPath() {
	case "/provider-market/mine":
		query = query.Where("owner_id = ? AND official = false", platform.User(c).ID)
	case "/admin/api/provider-market":
		status := reviewStatus(c.Query("reviewStatus"))
		if status != "" && status != "all" {
			if !validReviewStatus(status) {
				platform.Respond(c, nil, invalid())
				return
			}
			query = query.Where("review_status = ?", status)
		}
	default:
		query = query.Where("published = true AND review_status = ?", reviewApproved)
	}
	if scope := c.Query("scope"); scope == "official" || scope == "community" {
		query = query.Where("official = ?", scope == "official")
	}
	search := strings.TrimSpace(c.Query("search"))
	if len(search) > 160 {
		platform.Respond(c, nil, invalid())
		return
	}
	if search != "" {
		query = query.Where("draft->>'name' ILIKE ?", "%"+search+"%")
	}
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		platform.Respond(c, nil, invalid())
		return
	}
	var total int64
	err := query.Count(&total).Error
	rows := []item{}
	if err == nil {
		err = query.Order(marketOrder).Limit(40).Offset((page - 1) * 40).Find(&rows).Error
	}
	items := make([]presentation, 0, len(rows))
	for _, row := range rows {
		items = append(items, present(row))
	}
	platform.Respond(c, gin.H{"items": items, "total": total}, err)
}
func (s service) get(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	value, err := findItem(s.deps.DB.WithContext(c.Request.Context()), c.Param("id"))
	if err == nil && !isPublic(value) {
		err = missing()
	}
	platform.Respond(c, present(value), err)
}
func (s service) save(official bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body saveInput
		if decode(c, &body) != nil || body.Published == nil || validate(body.Draft) != nil ||
			(*body.Published && body.Draft.PageLink == nil) ||
			(c.Param("id") != "" && (!validItemID(c.Param("id")) || body.Revision < 1)) ||
			(c.Param("id") == "" && body.Revision != 0) {
			platform.Respond(c, nil, invalid())
			return
		}
		value, err := mutate(s.deps.DB.WithContext(c.Request.Context()), change{ID: c.Param("id"),
			Owner: platform.User(c).ID, Official: official, Input: body})
		platform.Respond(c, present(value), err)
	}
}
func (s service) remove(official bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Revision int64 `json:"revision"`
		}
		if decode(c, &body) != nil || body.Revision < 1 || !validItemID(c.Param("id")) {
			platform.Respond(c, nil, invalid())
			return
		}
		_, err := mutate(s.deps.DB.WithContext(c.Request.Context()), change{ID: c.Param("id"),
			Owner: platform.User(c).ID, Official: official, Delete: true, Input: saveInput{Revision: body.Revision}})
		platform.Respond(c, gin.H{"ok": err == nil}, err)
	}
}
func (s service) order(c *gin.Context) {
	var body struct {
		Revision  int64  `json:"revision"`
		SortOrder *int64 `json:"sortOrder"`
	}
	if decode(c, &body) != nil || body.Revision < 1 || !validItemID(c.Param("id")) ||
		(body.SortOrder != nil && (*body.SortOrder < 0 || *body.SortOrder > 1_000_000)) {
		platform.Respond(c, nil, invalid())
		return
	}
	value, err := updateOrder(s.deps.DB.WithContext(c.Request.Context()), c.Param("id"), body.Revision, body.SortOrder)
	platform.Respond(c, present(value), err)
}
func (s service) usage(c *gin.Context) {
	var body struct {
		ProviderID string `json:"providerId"`
	}
	if decode(c, &body) != nil || !safeID.MatchString(body.ProviderID) || !validItemID(c.Param("id")) {
		platform.Respond(c, nil, invalid())
		return
	}
	counted, err := recordUsage(s.deps.DB.WithContext(c.Request.Context()), platform.User(c).ID,
		c.Param("id"), body.ProviderID)
	platform.Respond(c, gin.H{"ok": err == nil, "counted": counted}, err)
}
