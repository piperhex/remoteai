package accounts

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
)

func effectiveCacheKey(owner string) string { return "client-read:v1:accounts:" + owner }

func (s *service) effectiveCached(owner string) (object, error) {
	ctx, cancel := platform.DatabaseContext(context.Background())
	defer cancel()
	result, err := readcache.Load(ctx, readcache.Options{Client: s.deps.Redis, Key: effectiveCacheKey(owner),
		Lifetime: time.Minute}, func(ctx context.Context) (object, error) {
		deps := *s.deps
		deps.DB = deps.DB.WithContext(ctx)
		reader := &service{deps: &deps}
		return reader.effective(owner)
	})
	if err != nil {
		return nil, err
	}
	// Redis decodes arrays into []interface{}; callers always work on their own response copy.
	if _, ok := result["accounts"].([]object); !ok {
		result["accounts"] = objects(result["accounts"])
	}
	return result, nil
}

func (s *service) cachedAccount(owner, id string) (object, error) {
	data, err := s.effectiveCached(owner)
	if err != nil {
		return nil, err
	}
	for _, row := range data["accounts"].([]object) {
		if row["id"] == id {
			return row, nil
		}
	}
	return nil, platform.NewError(404, "Synced account not found")
}
