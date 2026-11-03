package content

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
)

const chatPolicyCacheKey = "client-read:v1:chat-policy"

// CachedChatPolicy shares settings across sockets and instances. Readers receive independent maps.
// Five seconds matches the existing policy refresh cadence, including invalidation outages.
func CachedChatPolicy(deps *platform.Dependencies) (map[string]interface{}, error) {
	ctx, cancel := platform.DatabaseContext(context.Background())
	defer cancel()
	return readcache.Load(ctx, readcache.Options{Client: deps.Redis, Key: chatPolicyCacheKey,
		Lifetime: 5 * time.Second}, func(ctx context.Context) (map[string]interface{}, error) {
		return ReadChatPolicy(deps.DB.WithContext(ctx))
	})
}
