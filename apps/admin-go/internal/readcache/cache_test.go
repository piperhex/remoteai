package readcache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func cacheFixture(t *testing.T) Options {
	t.Helper()
	store := testfixture.Open(t)
	options := Options{Client: store.Redis, Key: "client-cache-test:" + uuid.NewString(), Lifetime: time.Minute}
	t.Cleanup(func() {
		if err := Invalidate(context.Background(), options.Client, options.Key); err != nil {
			t.Error(err)
		}
	})
	return options
}

func TestCacheCoalescesAndCopiesResponses(t *testing.T) {
	options := cacheFixture(t)
	var calls atomic.Int64
	read := func(context.Context) (map[string][]string, error) {
		calls.Add(1)
		time.Sleep(20 * time.Millisecond)
		return map[string][]string{"items": {"original"}}, nil
	}
	var group sync.WaitGroup
	for range 20 {
		group.Go(func() {
			value, err := Load(t.Context(), options, read)
			if err != nil || value["items"][0] != "original" {
				t.Error(value, err)
				return
			}
			value["items"][0] = "private mutation"
		})
	}
	group.Wait()
	if calls.Load() != 1 {
		t.Fatalf("SQL loads = %d, want 1", calls.Load())
	}
	if value, err := Load(t.Context(), options, read); err != nil || value["items"][0] != "original" {
		t.Fatal(value, err)
	}
}

func TestInvalidationFencesAnInFlightRead(t *testing.T) {
	options := cacheFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	read := func(context.Context) (string, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return "old", nil
		}
		return "new", nil
	}
	done := make(chan string, 1)
	go func() {
		value, err := Load(t.Context(), options, read)
		if err != nil {
			t.Error(err)
		}
		done <- value
	}()
	<-started
	if err := Invalidate(t.Context(), options.Client, options.Key); err != nil {
		t.Fatal(err)
	}
	close(release)
	if value := <-done; value != "new" {
		t.Fatal("stale fill survived invalidation", value)
	}
	if value, err := Load(t.Context(), options, read); err != nil || value != "new" || calls.Load() != 2 {
		t.Fatal(value, err, calls.Load())
	}
}

func TestCacheExpiryErrorsAndRedisFallback(t *testing.T) {
	options := cacheFixture(t)
	var calls int
	read := func(context.Context) (int, error) { calls++; return calls, nil }
	if value, err := Load(t.Context(), options, read); err != nil || value != 1 {
		t.Fatal(value, err)
	}
	if err := options.Client.PExpire(t.Context(), options.Key, time.Millisecond).Err(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	if value, err := Load(t.Context(), options, read); err != nil || value != 2 {
		t.Fatal(value, err)
	}
	if err := Invalidate(t.Context(), options.Client, options.Key); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("SQL unavailable")
	if _, err := Load(t.Context(), options, func(context.Context) (int, error) { return 0, failure }); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if value, err := Load(t.Context(), options, read); err != nil || value != 3 {
		t.Fatal(value, err)
	}
	options.Client = redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, ContextTimeoutEnabled: true})
	defer options.Client.Close()
	if value, err := Load(t.Context(), options, read); err != nil || value != 4 {
		t.Fatal(value, err)
	}
}
