package content

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
	"github.com/codex-switch/admin-go/internal/updatesharing"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *service) updateSharingRoutes(r *gin.Engine) {
	s.updateDownloadRoutes(r)
	r.GET("/update-sharing/settings", noStore, s.readUpdateSharing)
	r.GET("/admin/api/update-sharing", s.deps.RequirePermissions("admin.update-sharing.read"),
		noStore, s.readUpdateSharing)
	r.PATCH("/admin/api/update-sharing", s.deps.RequirePermissions("admin.update-sharing.manage"), s.saveUpdateSharing)
}

func (s *service) readUpdateSharing(c *gin.Context) {
	settings, err := updatesharing.ReadCached(s.deps)
	platform.Respond(c, settings, err)
}

// All fields are required so incomplete forms cannot silently reset global policy.
func parseUpdateSharing(data []byte) (updatesharing.Settings, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return updatesharing.Settings{}, err
	}
	for _, key := range []string{"scope", "uploadKibPerSecond", "unmeteredOnly", "prepareAndroid"} {
		if value, ok := fields[key]; !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return updatesharing.Settings{}, platform.NewError(400, "请填写完整的下载设置。")
		}
	}
	var settings updatesharing.Settings
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&settings); err != nil {
		return settings, err
	}
	return settings, settings.Validate()
}

func (s *service) saveUpdateSharing(c *gin.Context) {
	const maxSettingsBytes = 4096
	data, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxSettingsBytes))
	if err != nil {
		platform.Fail(c, 400, "请检查下载设置后重试。")
		return
	}
	settings, err := parseUpdateSharing(data)
	if err != nil {
		platform.Fail(c, 400, "请填写完整的下载设置，上传速度可设为不限或 64–8192 KiB/s。")
		return
	}
	row := updatesharing.Record{ID: "current", Policy: settings}
	err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error; err != nil {
			return err
		}
		return audit(tx, platform.User(c), auditOptions{Action: "update-sharing.update",
			TargetType: "update-sharing", TargetID: "current", Metadata: settings})
	})
	if err == nil {
		if cacheErr := readcache.Invalidate(context.Background(), s.deps.Redis, updatesharing.CacheKey); cacheErr != nil {
			slog.Warn("download sharing cache invalidation will expire shortly", "error", cacheErr)
		}
	}
	platform.Respond(c, settings, err)
}
