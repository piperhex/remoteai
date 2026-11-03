package platform

import (
	"context"
	"log/slog"

	"github.com/codex-switch/admin-go/internal/readcache"
)

func DeviceDirectoryCacheKey(owner string) string { return "client-read:v1:devices:" + owner }

// InvalidateDeviceDirectory is shared by device commands and account selection writes.
func InvalidateDeviceDirectory(deps *Dependencies, owner string) {
	if err := readcache.Invalidate(context.Background(), deps.Redis, DeviceDirectoryCacheKey(owner)); err != nil {
		slog.Warn("device directory cache invalidation failed", "error", err)
	}
}
