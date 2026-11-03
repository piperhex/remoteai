package platform

import (
	"context"
	"log/slog"

	"github.com/codex-switch/admin-go/internal/readcache"
)

func PortMappingsCacheKey(owner, device string) string {
	return "client-read:v1:port-mappings:" + owner + ":" + device
}

// InvalidatePortMappings fences older reads after configuration writes and cascading device/user deletes.
func InvalidatePortMappings(deps *Dependencies, owner string, devices ...string) {
	keys := make([]string, 0, len(devices))
	for _, device := range devices {
		keys = append(keys, PortMappingsCacheKey(owner, device))
	}
	if err := readcache.Invalidate(context.Background(), deps.Redis, keys...); err != nil {
		slog.Warn("port mapping cache invalidation failed", "error", err)
	}
}
