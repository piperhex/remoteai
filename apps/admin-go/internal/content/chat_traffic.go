package content

import (
	"net/http"
	"time"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *service) chatTrafficRoutes(r *gin.Engine) {
	read := s.deps.RequirePermissions("admin.chat-traffic.read")
	r.GET("/admin/api/chat-traffic/users", read, noStore, s.chatTrafficUsers)
	r.GET("/admin/api/chat-traffic/users/:id", read, noStore, s.chatTrafficUser)
	r.PATCH("/admin/api/chat-traffic/users/:id/limit",
		s.deps.RequirePermissions("admin.chat-traffic.manage"), s.chatTrafficLimit)
}

func trafficMonth(c *gin.Context) (time.Time, bool) {
	value := c.DefaultQuery("month", time.Now().In(chattraffic.Beijing).Format("2006-01"))
	month, err := time.ParseInLocation("2006-01", value, chattraffic.Beijing)
	if err != nil || month.Year() < 2000 || month.Year() > 9999 {
		platform.Fail(c, 400, "请选择有效的月份。")
		return month, false
	}
	return month, true
}

func trafficUserID(c *gin.Context) (string, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		platform.Fail(c, 400, "用户无效。")
		return "", false
	}
	return id.String(), true
}

func trafficOrder(c *gin.Context) (clause.OrderByColumn, bool) {
	columns := map[string]string{
		"monthBytes":     "month_bytes",
		"totalBytes":     "total_bytes",
		"monthUsedBytes": "month_used_bytes",
	}
	column, valid := columns[c.DefaultQuery("sortBy", "monthBytes")]
	direction := c.DefaultQuery("sortOrder", "desc")
	if !valid || (direction != "asc" && direction != "desc") {
		platform.Fail(c, http.StatusBadRequest, "请选择有效的排序方式。")
		return clause.OrderByColumn{}, false
	}
	return clause.OrderByColumn{Column: clause.Column{Name: column}, Desc: direction == "desc"}, true
}

func (s *service) chatTrafficUsers(c *gin.Context) {
	month, valid := trafficMonth(c)
	if !valid {
		return
	}
	order, valid := trafficOrder(c)
	if !valid {
		return
	}
	p, size := page(c)
	if size > 100 {
		size = 100
	}
	if p > 1000000 {
		p = 1000000
	}
	summary, err := chattraffic.ReadUserSummary(s.deps.DB, month)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	query := searchQuery(c, chattraffic.UserQuery(s.deps.DB, month), []string{"u.email"})
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		platform.Respond(c, nil, err)
		return
	}
	items := []chattraffic.UserTraffic{}
	err = query.Order(order).Order("u.id ASC").Offset((p - 1) * size).Limit(size).Scan(&items).Error
	reset := chattraffic.MonthStart(time.Now()).AddDate(0, 1, 0)
	for index := range items {
		items[index].ResetAt = reset
	}
	platform.Respond(c, gin.H{"items": items, "total": total, "page": p, "pageSize": size, "summary": summary}, err)
}

func (s *service) chatTrafficUser(c *gin.Context) {
	month, valid := trafficMonth(c)
	if !valid {
		return
	}
	id, valid := trafficUserID(c)
	if !valid {
		return
	}
	var user chattraffic.UserTraffic
	result := chattraffic.UserQuery(s.deps.DB, month).Where("u.id=?", id).Scan(&user)
	if result.Error != nil {
		platform.Respond(c, nil, result.Error)
		return
	}
	if result.RowsAffected == 0 {
		platform.Fail(c, 404, "用户不存在。")
		return
	}
	user.ResetAt = chattraffic.MonthStart(time.Now()).AddDate(0, 1, 0)
	daily, err := chattraffic.ReadDaily(s.deps.DB, id, month)
	platform.Respond(c, gin.H{"user": user, "totalBytes": user.TotalBytes, "daily": daily}, err)
}

func (s *service) chatTrafficLimit(c *gin.Context) {
	id, valid := trafficUserID(c)
	if !valid {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		MonthlyLimitBytes *int64 `json:"monthlyLimitBytes"`
	}
	if !bind(c, &input) {
		return
	}
	if input.MonthlyLimitBytes == nil || *input.MonthlyLimitBytes < -1 ||
		*input.MonthlyLimitBytes > chattraffic.MaxLimitBytes {
		platform.Fail(c, 400, "请输入 -1 或非负整数流量额度。")
		return
	}
	err := s.saveTrafficLimit(c, id, *input.MonthlyLimitBytes)
	platform.Respond(c, gin.H{"monthlyLimitBytes": *input.MonthlyLimitBytes}, err)
}

func (s *service) saveTrafficLimit(c *gin.Context, id string, limit int64) error {
	return chattraffic.ChangeLimit(s.deps.DB.WithContext(c.Request.Context()), s.deps.Redis, id, func(tx *gorm.DB) error {
		var email string
		result := tx.Table("users").Select("email").Where("id=?", id).Scan(&email)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return platform.NewError(404, "用户不存在。")
		}
		if err := tx.Exec(`INSERT INTO chat_relay_user_limits(user_id,monthly_limit_bytes) VALUES (?,?)
 ON CONFLICT(user_id) DO UPDATE SET monthly_limit_bytes=EXCLUDED.monthly_limit_bytes`, id, limit).Error; err != nil {
			return err
		}
		return audit(tx, platform.User(c), auditOptions{Action: "chat-traffic.limit.update", TargetType: "user",
			TargetID: id, TargetEmail: &email, Metadata: gin.H{"monthlyLimitBytes": limit}})
	})
}
