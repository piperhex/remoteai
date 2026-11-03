// Package readcache caches disposable read models, never authorization decisions or quota credit.
package readcache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

const operationTimeout = 200 * time.Millisecond

// Options identifies a shared read model. Writers must delete Key after committing changes.
// A short lifetime also bounds staleness when invalidation cannot reach Redis.
type Options struct {
	Client   *redis.Client
	Key      string
	Lifetime time.Duration
}

var loads singleflight.Group
var snapshot = redis.NewScript(`
local revision = redis.call('HGET', KEYS[1], 'revision')
if not revision then
  revision = ARGV[1]
  redis.call('HSET', KEYS[1], 'revision', revision)
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return {revision, redis.call('HGET', KEYS[1], 'value') or ''}
`)
var publish = redis.NewScript(`
if redis.call('HGET', KEYS[1], 'revision') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'value', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`)

// Load coalesces misses and decodes a private copy for every caller. A deleted or expired
// key gets a new generation, so an older SQL read cannot repopulate an invalidated entry.
// Redis failures fall back to SQL; errors and cancelled reads are never cached.
func Load[T any](ctx context.Context, options Options, read func(context.Context) (T, error)) (T, error) {
	if options.Client == nil {
		return read(ctx)
	}
	for range 2 {
		state, err := readSnapshot(ctx, options)
		if err != nil {
			return read(ctx)
		}
		var value T
		if state[1] != "" && json.Unmarshal([]byte(state[1]), &value) == nil {
			return value, nil
		}
		key := fmt.Sprintf("%p:%s:%s", options.Client, options.Key, state[0])
		pending := loads.DoChan(key, func() (interface{}, error) {
			return fill(ctx, options, state[0], read)
		})
		select {
		case <-ctx.Done():
			return value, ctx.Err()
		case result := <-pending:
			if result.Err != nil {
				// A cancelled leader must not fail other callers whose requests are still live.
				if ctx.Err() == nil && cancelled(result.Err) {
					continue
				}
				return value, result.Err
			}
			if result.Val == nil {
				continue
			}
			err := json.Unmarshal(result.Val.([]byte), &value)
			return value, err
		}
	}
	return read(ctx)
}

func cancelled(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func readSnapshot(ctx context.Context, options Options) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	return snapshot.Run(ctx, options.Client, []string{options.Key}, uuid.NewString(),
		options.Lifetime.Milliseconds()).StringSlice()
}

func fill[T any](ctx context.Context, options Options, revision string,
	read func(context.Context) (T, error)) (interface{}, error) {
	// A previous flight may finish between the caller's miss and joining this flight.
	// Recheck before SQL, including invalidation/expiry that changed the generation.
	if state, err := readSnapshot(ctx, options); err == nil {
		if state[0] != revision {
			return nil, nil
		}
		var cached T
		if state[1] != "" && json.Unmarshal([]byte(state[1]), &cached) == nil {
			return []byte(state[1]), nil
		}
	}
	value, err := read(ctx)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	cacheCtx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	stored, err := publish.Run(cacheCtx, options.Client, []string{options.Key}, revision,
		string(raw), options.Lifetime.Milliseconds()).Int()
	if err == nil && stored == 0 {
		return nil, nil
	}
	return raw, nil // A cache outage must not hide a successful database read.
}

// Invalidate fences in-flight fills as well as removing the current value.
func Invalidate(ctx context.Context, client *redis.Client, keys ...string) error {
	if client == nil || len(keys) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	return client.Del(ctx, keys...).Err()
}
