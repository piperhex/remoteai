// Package content implements public content, marketplace, feedback and analytics APIs.
package content

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/telemetryguard"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type service struct {
	deps      *platform.Dependencies
	currency  *currencyCache
	telemetry *telemetryguard.Guard
}

func Register(router *gin.Engine, deps *platform.Dependencies) error {
	guard, err := telemetryguard.New(deps)
	if err != nil {
		return err
	}
	s := &service{deps: deps, currency: &currencyCache{}, telemetry: guard}
	s.announcementRoutes(router)
	s.marketRoutes(router)
	s.feedbackRoutes(router)
	s.settingsRoutes(router)
	s.turnQuotaRoutes(router)
	s.updateSharingRoutes(router)
	s.tokenPricingRoutes(router)
	s.analyticsRoutes(router)
	s.chatTrafficRoutes(router)
	return nil
}

func newID() string {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		panic(err)
	} // OS entropy failure is unrecoverable.
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	value := hex.EncodeToString(id[:])
	return value[:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:]
}

func iso(value time.Time) string { return value.UTC().Format("2006-01-02T15:04:05.000Z") }
func dateOrNil(value time.Time) interface{} {
	if value.IsZero() {
		return nil
	}
	return iso(value)
}
func ptr[T any](value T) *T { return &value }
func ok() gin.H             { return gin.H{"ok": true} }
func missing(err error, message string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return platform.NewError(404, message)
	}
	return err
}
func bind(c *gin.Context, target interface{}) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		platform.Fail(c, 400, "Bad Request")
		return false
	}
	return true
}
func page(c *gin.Context) (int, int) {
	p := queryInteger(c, "page", 1)
	size := queryInteger(c, "pageSize", 20)
	if p < 1 {
		p = 1
	}
	if size < 1 {
		size = 20
	}
	return p, size
}
func queryInteger(c *gin.Context, key string, fallback int) int {
	value := platform.Query(c)[key]
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		number, err := strconv.ParseFloat(typed, 64)
		if err == nil {
			return int(number)
		}
	}
	return fallback
}
func paginate[T any](c *gin.Context, query *gorm.DB, order string) (gin.H, error) {
	p, size := page(c)
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return nil, err
	}
	rows := make([]T, 0)
	err := query.Order(order).Offset((p - 1) * size).Limit(size).Find(&rows).Error
	return gin.H{"items": rows, "total": count, "page": p, "pageSize": size}, err
}
func noStore(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() }
func searchQuery(c *gin.Context, query *gorm.DB, columns []string) *gorm.DB {
	value := strings.TrimSpace(c.Query("search"))
	if value == "" {
		return query
	}
	conditions := make([]string, len(columns))
	values := make([]interface{}, len(columns))
	for index, column := range columns {
		conditions[index] = column + " ILIKE ?"
		values[index] = "%" + value + "%"
	}
	return query.Where("("+strings.Join(conditions, " OR ")+")", values...)
}

type auditEntry struct {
	Id          string      `gorm:"column:id;primaryKey"`
	ActorId     *string     `gorm:"column:actorId"`
	ActorEmail  string      `gorm:"column:actorEmail"`
	Action      string      `gorm:"column:action"`
	TargetType  string      `gorm:"column:targetType"`
	TargetId    *string     `gorm:"column:targetId"`
	TargetEmail *string     `gorm:"column:targetEmail"`
	Metadata    interface{} `gorm:"column:metadata;serializer:json"`
	CreatedAt   time.Time   `gorm:"column:createdAt;autoCreateTime"`
}

func (auditEntry) TableName() string { return "admin_audit_logs" }

type auditOptions struct {
	Action, TargetType, TargetID string
	TargetEmail                  *string
	Metadata                     interface{}
}

func audit(db *gorm.DB, actor *platform.Principal, options auditOptions) error {
	return db.Create(&auditEntry{Id: newID(), ActorId: ptr(actor.ID), ActorEmail: actor.Email,
		Action: options.Action, TargetType: options.TargetType, TargetId: ptr(options.TargetID),
		TargetEmail: options.TargetEmail, Metadata: options.Metadata}).Error
}
