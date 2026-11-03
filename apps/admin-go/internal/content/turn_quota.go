package content

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/turnquota"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (s *service) turnQuotaRoutes(r *gin.Engine) {
	const path = "/admin/api/chat-settings/turn-relay"
	r.GET(path, s.deps.RequirePermissions("admin.chat-settings.read"), noStore, s.turnQuota)
	r.PATCH(path, s.deps.RequirePermissions("admin.chat-settings.manage"), s.updateTurnQuota)
	r.POST(path+"/retry", s.deps.RequirePermissions("admin.chat-settings.manage"), s.retryTurnQuota)
}

func (s *service) turnQuota(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	status, err := turnquota.Snapshot(ctx, s.deps)
	platform.Respond(c, status, err)
}

func (s *service) updateTurnQuota(c *gin.Context) {
	var input struct {
		TotalQuota *int `json:"totalQuota"`
	}
	if !bind(c, &input) {
		return
	}
	policy := turnquota.Policy{}
	if input.TotalQuota != nil {
		policy.TotalQuota = *input.TotalQuota
	}
	if err := policy.Validate(); err != nil {
		c.AbortWithStatusJSON(400, gin.H{"code": "turn_quota_invalid", "minimum": turnquota.Minimum,
			"maximum": turnquota.Maximum})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	err := turnquota.Update(ctx, s.deps.DB, policy, func(tx *gorm.DB) error {
		return audit(tx, platform.User(c), auditOptions{Action: "turn-quota.update", TargetType: "turn-quota",
			TargetID: "turn-relay", Metadata: policy})
	})
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	// Persistence success is distinct from runtime success. The UI displays both.
	s.reconcileTurnQuota(c)
}

func (s *service) retryTurnQuota(c *gin.Context) {
	err := audit(s.deps.DB.WithContext(c.Request.Context()), platform.User(c),
		auditOptions{Action: "turn-quota.retry", TargetType: "turn-quota", TargetID: "turn-relay"})
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	s.reconcileTurnQuota(c)
}

func (s *service) reconcileTurnQuota(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	status, err := turnquota.Reconcile(ctx, s.deps)
	platform.Respond(c, status, err)
}
