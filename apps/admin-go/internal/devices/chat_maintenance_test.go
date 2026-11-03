package devices

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

func TestChatMaintenanceCoalescesSlowTasks(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		maintenance := newChatMaintenance()
		defer maintenance.stop()
		release := make(chan struct{})
		var slow, fast atomic.Int64
		maintenance.start([]chatMaintenanceTask{
			{"slow", time.Second, func(ctx context.Context) error {
				slow.Add(1)
				select {
				case <-release:
				case <-ctx.Done():
				}
				return ctx.Err()
			}},
			{"fast", time.Second, func(context.Context) error { fast.Add(1); return nil }},
		})
		synctest.Wait()
		for range 100 {
			time.Sleep(time.Second)
			synctest.Wait()
		}
		if slow.Load() != 1 || fast.Load() != 100 {
			t.Fatalf("slow=%d fast=%d; slow ticks must coalesce without delaying fast work", slow.Load(), fast.Load())
		}
		close(release)
		synctest.Wait()
		if slow.Load() > 2 {
			t.Fatalf("slow task replayed a backlog: %d calls", slow.Load())
		}
		maintenance.stop()
		before := fast.Load()
		time.Sleep(10 * time.Second)
		synctest.Wait()
		if fast.Load() != before {
			t.Fatal("work continued after stop returned")
		}
	}) // synctest also fails if any worker survives the test bubble.
}

func TestChatMaintenanceCancelsAllBeforeWaiting(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		maintenance := newChatMaintenance()
		release, stopped := make(chan struct{}), make(chan struct{})
		var exited atomic.Int64
		maintenance.start([]chatMaintenanceTask{
			{"delayed return", time.Second, func(ctx context.Context) error {
				<-ctx.Done()
				<-release
				return ctx.Err()
			}},
			{"independent", time.Second, func(ctx context.Context) error {
				<-ctx.Done()
				exited.Add(1)
				return ctx.Err()
			}},
		})
		synctest.Wait()
		time.Sleep(time.Second)
		synctest.Wait()
		go func() { maintenance.stop(); close(stopped) }()
		synctest.Wait()
		if exited.Load() != 1 {
			t.Error("slow task prevented another task from exiting")
		}
		select {
		case <-stopped:
			t.Error("stop failed to join the delayed worker")
		default:
		}
		close(release)
		<-stopped
	})
}

func TestChatMaintenanceRetriesAfterFailure(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		maintenance := newChatMaintenance()
		defer maintenance.stop()
		var calls atomic.Int64
		maintenance.start([]chatMaintenanceTask{{"transient failure", time.Second, func(context.Context) error {
			if calls.Add(1) == 1 {
				return errors.New("fixture unavailable")
			}
			return nil
		}}})
		synctest.Wait()
		for range 2 {
			time.Sleep(time.Second)
			synctest.Wait()
		}
		if calls.Load() != 2 {
			t.Fatal("failure stopped future maintenance")
		}
	})
}

func TestChatMaintenanceAlreadyStoppedDoesNotRun(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		maintenance := newChatMaintenance()
		maintenance.cancel()
		maintenance.start([]chatMaintenanceTask{{"cancelled", time.Second, func(context.Context) error {
			t.Error("started a task after cancellation")
			return nil
		}}})
		maintenance.stop()
	})
}

func TestTrafficFlushGateHonorsCancellation(t *testing.T) {
	counter := newTrafficCounter(nil)
	counter.flushGate <- struct{}{}
	defer func() { <-counter.flushGate }()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := counter.flushContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled flush waited for another writer:", err)
	}
}

func TestChatMaintenancePolicyLockWaitIsCancellable(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gateway := &ChatGateway{maintenance: newChatMaintenance()}
		gateway.policyMu.Lock()
		defer gateway.policyMu.Unlock()
		gateway.maintenance.start([]chatMaintenanceTask{
			{"policy", time.Second, maintenanceAction(gateway.refreshPolicy)},
		})
		synctest.Wait()
		time.Sleep(time.Second)
		synctest.Wait()
		gateway.maintenance.stop() // Must join before the handshake releases policyMu.
	})
}
