package devices

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestChatMaintenanceBlockedSettlementKeepsIndependentWorkLive(t *testing.T) {
	gateway, desktop, owner := maintenanceFixture(t)
	started, release := blockFirstSettlement(t, gateway, owner)
	gateway.traffic.record(30)
	gateway.sessions.hot.sessions["fixture-session"].traffic.upload.Store(30)
	completed := startObservedMaintenance(gateway)
	awaitMaintenance(t, started)
	observeIndependentMaintenance(t, desktop)
	for _, done := range completed {
		awaitMaintenance(t, done)
	}
	assertMaintenancePersistence(t, gateway)
	close(release)
	awaitSettledUsage(t, desktop, 30)
	gateway.maintenance.stop()
	if err := errors.Join(gateway.meter.Close(), gateway.traffic.flush()); err != nil {
		t.Fatal(err)
	}
	var bytes int64
	err := gateway.service.deps.DB.Table("chat_relay_user_months").Select("SUM(bytes)").Scan(&bytes).Error
	if err != nil || bytes != 30 {
		t.Fatalf("settlement or finalization duplicated/lost usage: bytes=%d error=%v", bytes, err)
	}
}

func blockFirstSettlement(t *testing.T, gateway *ChatGateway, owner string) (chan struct{}, chan struct{}) {
	t.Helper()
	db := gateway.service.deps.DB
	if err := gateway.meter.Transmit(t.Context(), owner, 30, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE chat_relay_budgets SET expires_at=?", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	seedMaintenanceLease(t, db, owner)
	started, release := make(chan struct{}), make(chan struct{})
	var blocked atomic.Bool
	if err := db.Callback().Query().Before("gorm:query").Register("fixture_slow_settlement", func(tx *gorm.DB) {
		if tx.Statement.Table != "chat_relay_budgets" || blocked.Swap(true) {
			return
		}
		close(started)
		select {
		case <-release:
			tx.AddError(errors.New("first settlement attempt failed"))
		case <-tx.Statement.Context.Done():
			tx.AddError(tx.Statement.Context.Err())
		}
	}); err != nil {
		t.Fatal(err)
	}
	return started, release
}

func startObservedMaintenance(gateway *ChatGateway) map[string]chan struct{} {
	tasks := gateway.maintenanceTasks()
	completed := map[string]chan struct{}{
		"traffic persistence": make(chan struct{}, 1), "bulk reconciliation": make(chan struct{}, 1),
	}
	for index := range tasks {
		tasks[index].interval = 20 * time.Millisecond
		if done := completed[tasks[index].name]; done != nil {
			tasks[index].run = observeMaintenanceRun(tasks[index].run, done)
		}
	}
	gateway.maintenance.start(tasks)
	return completed
}

func observeMaintenanceRun(run func(context.Context) error, done chan<- struct{}) func(context.Context) error {
	return func(ctx context.Context) error {
		if err := run(ctx); err != nil {
			return err
		}
		select {
		case done <- struct{}{}:
		default:
		}
		return nil
	}
}

func observeIndependentMaintenance(t *testing.T, desktop *peer) {
	t.Helper()
	counts := map[string]int{}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for counts["relay-traffic"] < 3 || counts["desktop-ice"] < 3 || counts["chat-policy"] < 1 {
		select {
		case frame := <-desktop.queue:
			var message platform.JSON
			if err := json.Unmarshal(frame.bytes, &message); err != nil {
				t.Fatal(err)
			}
			kind, _ := message["type"].(string)
			counts[kind]++
			if kind == "relay-usage" {
				t.Fatal("published usage before the settlement attempt finished")
			}
			if kind == "relay-traffic" && message["uploadBytes"] != float64(30) {
				t.Fatal("live byte count changed:", message)
			}
		case <-deadline.C:
			t.Fatal("slow settlement stalled independent work:", counts)
		}
	}
}

func awaitSettledUsage(t *testing.T, desktop *peer, expected int64) {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case frame := <-desktop.queue:
			var message platform.JSON
			if err := json.Unmarshal(frame.bytes, &message); err != nil {
				t.Fatal(err)
			}
			usage, _ := message["usage"].(map[string]interface{})
			if message["type"] == "relay-usage" && usage["monthUsedBytes"] == float64(expected) {
				return
			}
		case <-deadline.C:
			t.Fatal("settlement did not recover after the transient failure")
		}
	}
}

func seedMaintenanceLease(t *testing.T, db *gorm.DB, owner string) {
	t.Helper()
	err := db.Exec(`INSERT INTO chat_relay_bulk_leases
		(id,user_id,device_id,writer_id,fencing_epoch,hour_start,expires_at,bytes,reserved,state)
		VALUES (?,?,'fixture',?,'fixture',?,?,10,10,'reserved')`, uuid.NewString(), owner, uuid.NewString(),
		time.Now().UTC().Truncate(time.Hour), time.Now().Add(-time.Second)).Error
	if err != nil {
		t.Fatal(err)
	}
}

func assertMaintenancePersistence(t *testing.T, gateway *ChatGateway) {
	t.Helper()
	var bytes int64
	err := gateway.service.deps.DB.Table("chat_relay_traffic").Select("SUM(bytes)").Scan(&bytes).Error
	if err != nil || bytes != 30 {
		t.Fatalf("traffic flush stalled: bytes=%d error=%v", bytes, err)
	}
	var state string
	err = gateway.service.deps.DB.Table("chat_relay_bulk_leases").Select("state").Scan(&state).Error
	if err != nil || state != "uncertain" {
		t.Fatalf("bulk reconciliation stalled: state=%s error=%v", state, err)
	}
}

func TestChatMaintenanceStorageWorkersCancelAndJoin(t *testing.T) {
	for _, name := range []string{"settlement and usage", "policy", "traffic persistence", "bulk reconciliation"} {
		t.Run(name, func(t *testing.T) {
			gateway, _, _ := maintenanceFixture(t)
			gateway.traffic.record(1)
			started, exited := make(chan struct{}), make(chan struct{})
			block := func(tx *gorm.DB) {
				close(started)
				<-tx.Statement.Context.Done()
				tx.AddError(tx.Statement.Context.Err())
				close(exited)
			}
			callbacks := gateway.service.deps.DB.Callback()
			for _, register := range []func(string, func(*gorm.DB)) error{
				callbacks.Query().Before("gorm:query").Register, callbacks.Raw().Before("gorm:raw").Register,
				callbacks.Update().Before("gorm:update").Register,
			} {
				if err := register("fixture_cancel_storage", block); err != nil {
					t.Fatal(err)
				}
			}
			for _, task := range gateway.maintenanceTasks() {
				if task.name == name {
					task.interval = time.Millisecond
					gateway.maintenance.start([]chatMaintenanceTask{task})
				}
			}
			awaitMaintenance(t, started)
			stopped := make(chan struct{})
			go func() { gateway.maintenance.stop(); close(stopped) }()
			awaitMaintenance(t, stopped)
			awaitMaintenance(t, exited)
		})
	}
}

func TestTrafficFlushCancellationRetainsConcurrentBytes(t *testing.T) {
	gateway, _, _ := maintenanceFixture(t)
	counter := gateway.traffic
	started := make(chan struct{})
	var blocked atomic.Bool
	if err := counter.db.Callback().Raw().Before("gorm:raw").Register("fixture_cancel_flush", func(tx *gorm.DB) {
		if blocked.Swap(true) {
			return
		}
		close(started)
		<-tx.Statement.Context.Done()
		tx.AddError(tx.Statement.Context.Err())
	}); err != nil {
		t.Fatal(err)
	}
	counter.record(10)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- counter.flushContext(ctx) }()
	awaitMaintenance(t, started)
	counter.record(20)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	for range 2 {
		if err := counter.flush(); err != nil {
			t.Fatal(err)
		}
	}
	var bytes int64
	if err := counter.db.Table("chat_relay_traffic").Select("SUM(bytes)").Scan(&bytes).Error; err != nil || bytes != 30 {
		t.Fatalf("retry duplicated/lost concurrent bytes: bytes=%d error=%v", bytes, err)
	}
}

func TestChatMaintenanceRuntimeCloseJoinsBeforeFinalFlush(t *testing.T) {
	gateway, _, _ := maintenanceFixture(t)
	gateway.connections = map[*peer]*chatConnection{}
	gateway.traffic.record(42)
	started := make(chan struct{})
	var first, active atomic.Bool
	if err := gateway.traffic.db.Callback().Raw().Before("gorm:raw").Register("fixture_shutdown", func(tx *gorm.DB) {
		if first.Swap(true) {
			if active.Load() || tx.Statement.Context.Err() != nil {
				t.Error("final flush overlapped maintenance or reused its cancelled context")
			}
			return
		}
		active.Store(true)
		close(started)
		<-tx.Statement.Context.Done()
		active.Store(false)
		tx.AddError(tx.Statement.Context.Err())
	}); err != nil {
		t.Fatal(err)
	}
	gateway.maintenance.start([]chatMaintenanceTask{
		{"traffic persistence", time.Millisecond, gateway.traffic.flushContext},
	})
	awaitMaintenance(t, started)
	runtime := &Runtime{control: newControlGateway(nil), chat: gateway}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	var bytes int64
	err := gateway.traffic.db.Table("chat_relay_traffic").Select("SUM(bytes)").Scan(&bytes).Error
	if err != nil || bytes != 42 {
		t.Fatalf("shutdown lost the final snapshot: bytes=%d error=%v", bytes, err)
	}
}
