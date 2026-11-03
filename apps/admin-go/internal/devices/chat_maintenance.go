package devices

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

const chatMaintenanceInterval = 5 * time.Second
const chatPolicyLockRetryInterval = 10 * time.Millisecond

type chatMaintenanceTask struct {
	name     string
	interval time.Duration
	run      func(context.Context) error
}

// Each task owns one worker and one ticker. Slow runs coalesce ticks instead of
// spawning overlapping work; every worker receives cancellation before we wait.
type chatMaintenance struct {
	ctx     context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
}

func newChatMaintenance() *chatMaintenance {
	ctx, cancel := context.WithCancel(context.Background())
	return &chatMaintenance{ctx: ctx, cancel: cancel}
}

func (maintenance *chatMaintenance) start(tasks []chatMaintenanceTask) {
	for _, task := range tasks {
		maintenance.workers.Go(func() { task.maintain(maintenance.ctx) })
	}
}

func (maintenance *chatMaintenance) stop() {
	maintenance.cancel()
	maintenance.workers.Wait()
}

func (task chatMaintenanceTask) maintain(ctx context.Context) {
	ticker := time.NewTicker(task.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if ctx.Err() != nil {
				return
			}
			if err := task.run(ctx); err != nil && ctx.Err() == nil {
				slog.Warn("chat maintenance will be retried", "task", task.name, "error", err)
			}
		}
	}
}

func (g *ChatGateway) maintenanceTasks() []chatMaintenanceTask {
	tasks := []chatMaintenanceTask{
		{"sessions and traffic", chatMaintenanceInterval, maintenanceAction(g.maintainSessions)},
		{"settlement and usage", chatMaintenanceInterval, g.settleAndPublishUsage},
		{"policy", chatMaintenanceInterval, maintenanceAction(g.refreshPolicy)},
		{"traffic persistence", chatMaintenanceInterval, g.traffic.flushContext},
		{"desktop ICE", desktopCredentialLifetime / 2, maintenanceAction(g.refreshDesktopICE)},
	}
	if g.bulkMeter != nil {
		tasks = append(tasks, chatMaintenanceTask{"bulk reconciliation", chatMaintenanceInterval,
			func(parent context.Context) error {
				ctx, cancel := context.WithTimeout(parent, chatMaintenanceInterval)
				defer cancel()
				return g.bulkMeter.ReconcileExpired(ctx)
			}})
	}
	return tasks
}

func (g *ChatGateway) maintainSessions() {
	// Keep expired-session removal ahead of its live counters, without any storage wait.
	g.sessions.prune()
	g.sessions.publishTraffic()
}

func maintenanceAction(run func()) func(context.Context) error {
	return func(context.Context) error { run(); return nil }
}

func (g *ChatGateway) maintenanceContext() context.Context {
	if g.maintenance == nil {
		return context.Background()
	}
	return g.maintenance.ctx
}

func (g *ChatGateway) lockPolicyForRefresh() bool {
	ctx := g.maintenanceContext()
	if ctx.Err() != nil {
		return false
	}
	if g.policyMu.TryLock() {
		return true
	}
	// Handshakes and saved-policy callbacks retain the same serialization. A
	// queued periodic refresh must still be able to leave during shutdown.
	retry := time.NewTicker(chatPolicyLockRetryInterval)
	defer retry.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-retry.C:
			if ctx.Err() == nil && g.policyMu.TryLock() {
				return true
			}
		}
	}
}

func (g *ChatGateway) settleAndPublishUsage(ctx context.Context) error {
	err := g.meter.FlushContext(ctx)
	if ctx.Err() != nil {
		return err
	}
	// SQL usage excludes open grants. Preserve settlement-before-usage (including
	// its existing failure fallback); live session bytes run independently of SQL.
	return errors.Join(err, g.publishUsage(ctx))
}
