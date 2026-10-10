package platform

import (
	"context"
	"net/url"
	"testing"
)

func TestDatabaseOptionsDefaultsAndOverrides(t *testing.T) {
	defaults, err := readDatabaseOptions(Config{})
	if err != nil || defaults.maxOpen != 30 || defaults.maxIdle != 10 ||
		defaults.statementTimeout != 30000 || defaults.lockTimeout != 5000 {
		t.Fatal(defaults, err)
	}
	config := Config{"POSTGRES_MAX_OPEN_CONNS": "40", "POSTGRES_MAX_IDLE_CONNS": "0",
		"POSTGRES_STATEMENT_TIMEOUT_MS": "12000", "POSTGRES_LOCK_TIMEOUT_MS": "2000"}
	options, err := readDatabaseOptions(config)
	if err != nil || options.maxOpen != 40 || options.maxIdle != 0 {
		t.Fatal(options, err)
	}
	dsn, err := url.Parse(postgresDSN(config, options))
	if err != nil || dsn.Query().Get("statement_timeout") != "12000" ||
		dsn.Query().Get("lock_timeout") != "2000" || dsn.Query().Get("connect_timeout") != "10" {
		t.Fatal("database deadlines missing from DSN", err)
	}
}

func TestDatabaseOptionsRejectUnboundedOrInvalidLimits(t *testing.T) {
	for _, config := range []Config{
		{"POSTGRES_MAX_OPEN_CONNS": "0"}, {"POSTGRES_MAX_OPEN_CONNS": "invalid"},
		{"POSTGRES_MAX_IDLE_CONNS": "-1"}, {"POSTGRES_MAX_IDLE_CONNS": "31"},
		{"POSTGRES_STATEMENT_TIMEOUT_MS": "0"}, {"POSTGRES_LOCK_TIMEOUT_MS": "-1"},
	} {
		if _, err := readDatabaseOptions(config); err == nil {
			t.Fatalf("accepted invalid database limits: %v", config)
		}
	}
}

func TestDatabaseContextPreservesCancellation(t *testing.T) {
	parent, stop := context.WithCancel(context.Background())
	ctx, cancel := DatabaseContext(parent)
	defer cancel()
	if _, exists := ctx.Deadline(); !exists {
		t.Fatal("pool waits need a deadline")
	}
	stop()
	if ctx.Err() != context.Canceled {
		t.Fatal("client cancellation was lost")
	}
}
