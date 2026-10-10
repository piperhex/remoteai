package platform

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

const databaseRequestTimeout = 30 * time.Second

type databaseOptions struct {
	maxOpen, maxIdle              int
	statementTimeout, lockTimeout int
}

func readDatabaseOptions(config Config) (databaseOptions, error) {
	options := databaseOptions{}
	settings := []struct {
		name              string
		fallback, minimum int
		target            *int
	}{
		{"POSTGRES_MAX_OPEN_CONNS", 30, 1, &options.maxOpen},
		{"POSTGRES_MAX_IDLE_CONNS", 10, 0, &options.maxIdle},
		{"POSTGRES_STATEMENT_TIMEOUT_MS", 30000, 1, &options.statementTimeout},
		{"POSTGRES_LOCK_TIMEOUT_MS", 5000, 1, &options.lockTimeout},
	}
	for _, setting := range settings {
		value, err := strconv.Atoi(config.Get(setting.name, strconv.Itoa(setting.fallback)))
		if err != nil || value < setting.minimum {
			return options, fmt.Errorf("%s must be an integer >= %d", setting.name, setting.minimum)
		}
		*setting.target = value
	}
	if options.maxIdle > options.maxOpen {
		return options, fmt.Errorf("POSTGRES_MAX_IDLE_CONNS must not exceed POSTGRES_MAX_OPEN_CONNS")
	}
	return options, nil
}

// DatabaseContext bounds connection-pool waits as well as SQL and follows client cancellation.
func DatabaseContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, databaseRequestTimeout)
}
