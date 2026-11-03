package turnquota

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/pion/stun/v3"
)

func TestInitialCoturnDefault(t *testing.T) {
	if os.Getenv("TURN_QUOTA_TEST_INITIAL") != "1" {
		t.Skip("requires fresh isolated coturn")
	}
	deps := integrationDeps(t)
	config, ok := configuration(deps.Config)
	if !ok {
		t.Fatal("missing test control configuration")
	}
	client, err := connect(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer client.conn.Close()
	quota, err := client.read(config.realm)
	if err != nil || quota.Default != 256 || quota.Current != 256 {
		t.Fatal(quota, err)
	}
	t.Log("Fresh pinned coturn instance uses default allocation quota 256")
}

// Run after the harness restarts its own coturn container. This test never writes
// the runtime setting: success must come from the persisted bootstrap snapshot.
func TestRestartedQuota(t *testing.T) {
	if os.Getenv("TURN_QUOTA_TEST_RESTARTED") != "1" {
		t.Skip("run explicitly after isolated coturn restart")
	}
	deps := integrationDeps(t)
	status, err := Snapshot(context.Background(), deps)
	deadline := time.Now().Add(10 * time.Second)
	for (err != nil || status.State != "applied") && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
		status, err = Snapshot(context.Background(), deps)
	}
	if err != nil || status.TotalQuota != 2 || status.State != "applied" {
		t.Fatal(status, err)
	}
	addresses := startMeteredProxy(t)
	first := allocation(t, addresses[0], "udp", "restart-one")
	second := allocation(t, addresses[0], "tcp", "restart-two")
	third := allocation(t, addresses[1], "tls", "restart-three")
	first.expect(t, stun.MethodAllocate, 600, 0)
	second.expect(t, stun.MethodAllocate, 600, 0)
	third.expect(t, stun.MethodAllocate, 600, 486)
	first.expect(t, stun.MethodRefresh, 0, 0)
	second.expect(t, stun.MethodRefresh, 0, 0)
	t.Log("Restart retained quota=2 before any reconciliation; third real Allocate rejected")
}
