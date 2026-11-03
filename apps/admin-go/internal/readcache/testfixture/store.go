// Package testfixture provides opt-in, disposable local SQL/Redis fixtures for read-cache tests.
package testfixture

import (
	"context"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const DSN = "host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=admin_go sslmode=disable"

type Counter struct {
	logger.Interface
	Count atomic.Int64
}

func (counter *Counter) Trace(context.Context, time.Time, func() (string, int64), error) {
	counter.Count.Add(1)
}

type Store struct {
	DB      *gorm.DB
	Redis   *redis.Client
	Queries *Counter
}

// Open uses a separate schema and never loads deployment credentials.
func Open(t *testing.T) Store {
	t.Helper()
	if os.Getenv("CLIENT_READ_CACHE_TEST") != "1" {
		t.Skip("CLIENT_READ_CACHE_TEST=1 enables local cache integration tests")
	}
	base := openDatabase(t, DSN, logger.Default.LogMode(logger.Silent))
	schema := "client_cache_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	})
	counter := &Counter{Interface: logger.Default.LogMode(logger.Silent)}
	db := openDatabase(t, DSN+" search_path="+schema, counter)
	return Store{db, openRedis(t), counter}
}

func openDatabase(t *testing.T, dsn string, log logger.Interface) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: log})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := connection.Close(); err != nil {
			t.Error(err)
		}
	})
	return db
}

func openRedis(t *testing.T) *redis.Client {
	t.Helper()
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:16380", DB: 14, ContextTimeoutEnabled: true})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := client.Ping(t.Context()).Err(); err != nil {
		t.Fatal(err)
	}
	return client
}
