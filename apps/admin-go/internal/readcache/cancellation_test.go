package readcache

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestCancelledLeaderDoesNotFailLiveWaiter(t *testing.T) {
	options := cacheFixture(t)
	leader, cancel := context.WithCancel(t.Context())
	defer cancel()
	started := make(chan struct{})
	finished := make(chan error, 1)
	var calls atomic.Int64
	read := func(ctx context.Context) (string, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			return "", ctx.Err()
		}
		return "current", nil
	}
	go func() {
		_, err := Load(leader, options, read)
		finished <- err
	}()
	<-started
	// Leave time for the live request to join the blocked leader's flight.
	timer := time.AfterFunc(50*time.Millisecond, cancel)
	defer timer.Stop()
	value, err := Load(t.Context(), options, read)
	if err != nil || value != "current" || calls.Load() != 2 {
		t.Fatal(value, err, calls.Load())
	}
	if err := <-finished; !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled request did not return its cancellation", err)
	}
	if value, err := Load(t.Context(), options, read); err != nil || value != "current" {
		t.Fatal("cancelled fill replaced the live result", value, err, calls.Load())
	}
}
