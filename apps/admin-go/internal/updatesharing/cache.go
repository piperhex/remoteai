package updatesharing

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
)

// CacheKey is invalidated by the settings writer after its SQL transaction commits.
const CacheKey = "client-read:v1:update-sharing"

func ReadCached(deps *platform.Dependencies) (Settings, error) {
	ctx, cancel := platform.DatabaseContext(context.Background())
	defer cancel()
	return readcache.Load(ctx, readcache.Options{Client: deps.Redis, Key: CacheKey,
		Lifetime: 5 * time.Second}, func(ctx context.Context) (Settings, error) {
		return Read(deps.DB.WithContext(ctx))
	})
}
