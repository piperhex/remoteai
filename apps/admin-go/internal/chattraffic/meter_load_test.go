package chattraffic

import (
	"context"
	"fmt"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type commandHook func(context.Context, redis.Cmder, redis.ProcessHook) error

func (hook commandHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (hook commandHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (hook commandHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error { return hook(ctx, cmd, next) }
}

func waitDelay(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return ctx.Err()
	}
}

// Opt-in measurements use real Redis scripts and SQL transactions, with controlled
// client-side delays per command/statement. They are not a TURN or production benchmark.
func TestMeterControlledLatency(t *testing.T) {
	if os.Getenv("ADMIN_GO_TRAFFIC_LOAD_TEST") != "1" {
		t.Skip("controlled storage latency measurements are opt-in")
	}
	for _, delay := range []time.Duration{0, 2 * time.Millisecond} {
		for _, scenario := range []struct {
			name           string
			streams, bytes int
			distinct       bool
		}{
			{"one-stream", 1, 1200, false},
			{"same-account", 8, 1200, false},
			{"distinct-accounts", 8, 1200, true},
			{"same-account-renewal", 8, 16384, false},
		} {
			t.Run(fmt.Sprintf("%s/delay=%s", scenario.name, delay), func(t *testing.T) {
				db, owner := trafficFixture(t)
				meter := trafficMeter(t, db, owner)
				owners := make([]string, scenario.streams)
				for i := range owners {
					owners[i] = owner
					if scenario.distinct && i > 0 {
						_, owners[i] = trafficFixture(t)
						// Register key cleanup for each synthetic account.
						trafficMeter(t, db, owners[i])
					}
					if err := meter.Transmit(t.Context(), owners[i], 1, func() error { return nil }); err != nil {
						t.Fatal(err)
					}
				}
				installStorageDelay(t, meter, delay)
				measureTraffic(t, meter, owners, scenario.bytes)
				if err := meter.Close(); err != nil {
					t.Fatal(err)
				}
				for i, account := range owners {
					if scenario.distinct {
						recoverTrafficBudgets(t, meter, account)
						assertUsage(t, db, account, int64(16*scenario.bytes+1))
					} else if i == 0 {
						recoverTrafficBudgets(t, meter, account)
						assertUsage(t, db, account, int64(scenario.streams*(16*scenario.bytes+1)))
					}
				}
			})
		}
	}
}

func installStorageDelay(t *testing.T, meter *Meter, delay time.Duration) {
	t.Helper()
	meter.redis.AddHook(commandHook(func(ctx context.Context, cmd redis.Cmder, next redis.ProcessHook) error {
		if err := waitDelay(ctx, delay); err != nil {
			return err
		}
		return next(ctx, cmd)
	}))
	before := func(db *gorm.DB) { db.AddError(waitDelay(db.Statement.Context, delay)) }
	callbacks := meter.db.Callback()
	for _, err := range []error{
		callbacks.Raw().Before("gorm:raw").Register("test:latency", before),
		callbacks.Row().Before("gorm:row").Register("test:latency", before),
		callbacks.Create().Before("gorm:create").Register("test:latency", before),
		callbacks.Query().Before("gorm:query").Register("test:latency", before),
		callbacks.Update().Before("gorm:update").Register("test:latency", before),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func measureTraffic(t *testing.T, meter *Meter, owners []string, bytes int) {
	t.Helper()
	const frames = 16
	latencies := make([]time.Duration, len(owners)*frames)
	var workers sync.WaitGroup
	start := make(chan struct{})
	for stream, owner := range owners {
		workers.Go(func() {
			<-start
			for frame := range frames {
				started := time.Now()
				err := meter.Transmit(t.Context(), owner, bytes, func() error { return nil })
				latencies[stream*frames+frame] = time.Since(started)
				if err != nil {
					t.Error(err)
					return
				}
			}
		})
	}
	started := time.Now()
	close(start)
	workers.Wait()
	elapsed := time.Since(started)
	slices.Sort(latencies)
	count := len(latencies)
	t.Logf("streams=%d frames=%d bytes/frame=%d elapsed=%s frames/s=%.1f MiB/s=%.3f p50=%s p95=%s",
		len(owners), count, bytes, elapsed, float64(count)/elapsed.Seconds(),
		float64(count*bytes)/(1<<20)/elapsed.Seconds(), latencies[count/2], latencies[(count-1)*95/100])
}
