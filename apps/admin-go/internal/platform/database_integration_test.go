//go:build integration

package platform

import (
	"testing"
)

func TestDatabasePoolAndStatementDeadline(t *testing.T) {
	// Fixed, disposable local parity dependencies; never read deployment credentials.
	config := Config{"POSTGRES_HOST": "127.0.0.1", "POSTGRES_PORT": "15432", "POSTGRES_USER": "parity",
		"POSTGRES_PASSWORD": "local-parity-only", "POSTGRES_DB": "admin_go",
		"REDIS_HOST": "127.0.0.1", "REDIS_PORT": "16380",
		"POSTGRES_STATEMENT_TIMEOUT_MS": "100", "POSTGRES_LOCK_TIMEOUT_MS": "50"}
	deps, err := OpenDependencies(config)
	if err != nil {
		t.Fatal(err)
	}
	defer deps.Redis.Close()
	pool, err := deps.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if pool.Stats().MaxOpenConnections != 30 {
		t.Fatal("pool default was not applied")
	}
	var statement, lock string
	if err := deps.DB.Raw("SHOW statement_timeout").Scan(&statement).Error; err != nil {
		t.Fatal(err)
	}
	if err := deps.DB.Raw("SHOW lock_timeout").Scan(&lock).Error; err != nil {
		t.Fatal(err)
	}
	if statement != "100ms" || lock != "50ms" {
		t.Fatal(statement, lock)
	}
	if err := deps.DB.Exec("SELECT pg_sleep(0.3)").Error; err == nil {
		t.Fatal("a slow SQL statement exceeded the configured deadline")
	}
	if err := deps.DB.Exec("SELECT 1").Error; err != nil {
		t.Fatal("connection did not recover", err)
	}
}
