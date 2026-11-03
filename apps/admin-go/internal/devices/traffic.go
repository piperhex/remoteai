package devices

import (
	"context"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/bandwidth"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type trafficCounter struct {
	bandwidth *bandwidth.Monitor
	db        *gorm.DB
	reporter  string
	mu        sync.Mutex
	flushGate chan struct{}
	totals    map[time.Time]int64
	pending   map[time.Time]bool
}

func newTrafficCounter(db *gorm.DB) *trafficCounter {
	return &trafficCounter{
		bandwidth: bandwidth.New(),
		db:        db,
		reporter:  uuid.NewString(),
		flushGate: make(chan struct{}, 1),
		totals:    map[time.Time]int64{},
		pending:   map[time.Time]bool{},
	}
}

func (counter *trafficCounter) record(bytes int) {
	if bytes <= 0 {
		return
	}
	counter.bandwidth.Record(bytes)
	hour := time.Now().UTC().Truncate(time.Hour)
	counter.mu.Lock()
	defer counter.mu.Unlock()
	counter.totals[hour] += int64(bytes)
	counter.pending[hour] = true
}

func (counter *trafficCounter) flush() error {
	return counter.flushContext(context.Background())
}

func (counter *trafficCounter) flushContext(parent context.Context) error {
	ctx, cancel := platform.DatabaseContext(parent)
	defer cancel()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case counter.flushGate <- struct{}{}:
	}
	defer func() { <-counter.flushGate }()
	if err := ctx.Err(); err != nil {
		return err
	}
	return counter.flushPending(ctx)
}

func (counter *trafficCounter) flushPending(ctx context.Context) error {
	counter.mu.Lock()
	snapshot := map[time.Time]int64{}
	for hour := range counter.pending {
		snapshot[hour] = counter.totals[hour]
	}
	counter.mu.Unlock()
	if len(snapshot) == 0 {
		return nil
	}
	err := counter.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for hour, bytes := range snapshot {
			if err := tx.Exec(`INSERT INTO chat_relay_traffic (reporter_id, hour_start, bytes) VALUES (?, ?, ?)
				ON CONFLICT (hour_start, reporter_id) DO UPDATE SET bytes = GREATEST(chat_relay_traffic.bytes, EXCLUDED.bytes)`,
				counter.reporter, hour, bytes).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	counter.mu.Lock()
	defer counter.mu.Unlock()
	for hour, bytes := range snapshot {
		if counter.totals[hour] == bytes {
			delete(counter.pending, hour)
		}
	}
	return nil
}
