package platform

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func LoadConfig() (Config, error) {
	config := Config{}
	// Like dotenv in the original service, the process environment wins, including empty values.
	if values, err := godotenv.Read(".env"); err == nil {
		for key, value := range values {
			config[key] = value
		}
	}
	for key, value := range Environment() {
		config[key] = value
	}
	if strings.ToLower(strings.TrimSpace(config.Get("NODE_ENV", ""))) != "production" {
		return config, nil
	}
	invalid := []string{}
	defaults := [][2]string{
		{"KONG_JWT_SECRET", "change-me-kong-jwt-secret"},
		{"JWT_REFRESH_SECRET", "replace-with-refresh-secret"},
	}
	for _, item := range defaults {
		value := strings.TrimSpace(config.Get(item[0], ""))
		if value == "" || value == item[1] {
			invalid = append(invalid, item[0])
		}
	}
	if len(invalid) > 0 {
		return nil, fmt.Errorf("refusing to start in production: %s must be set to non-default values",
			strings.Join(invalid, ", "))
	}
	return config, nil
}

func OpenDependencies(config Config) (*Dependencies, error) {
	options, err := readDatabaseOptions(config)
	if err != nil {
		return nil, err
	}
	dsn := postgresDSN(config, options)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, fmt.Errorf("connect PostgreSQL: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(options.maxOpen)
	sqlDB.SetMaxIdleConns(options.maxIdle)
	sqlDB.SetConnMaxLifetime(time.Hour)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	redisPort, err := strconv.Atoi(config.Get("REDIS_PORT", "6379"))
	if err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("invalid REDIS_PORT")
	}
	client := redis.NewClient(&redis.Options{
		Addr:     net.JoinHostPort(config.Get("REDIS_HOST", "127.0.0.1"), strconv.Itoa(redisPort)),
		Password: config.Get("REDIS_PASSWORD", "")})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		sqlDB.Close()
		return nil, fmt.Errorf("connect Redis: %w", err)
	}
	return &Dependencies{DB: db, Redis: client, Config: config}, nil
}

func postgresDSN(config Config, options databaseOptions) string {
	dsn := url.URL{
		Scheme: "postgres",
		Host:   net.JoinHostPort(config.Get("POSTGRES_HOST", "127.0.0.1"), config.Get("POSTGRES_PORT", "5432")),
		Path:   config.Get("POSTGRES_DB", "codex_switch"),
		User: url.UserPassword(config.Get("POSTGRES_USER", "codex_switch"),
			config.Get("POSTGRES_PASSWORD", "codex_switch")),
	}
	query := url.Values{"sslmode": {config.Get("POSTGRES_SSLMODE", "disable")}, "TimeZone": {"UTC"}}
	query.Set("statement_timeout", strconv.Itoa(options.statementTimeout))
	query.Set("lock_timeout", strconv.Itoa(options.lockTimeout))
	query.Set("connect_timeout", "10")
	dsn.RawQuery = query.Encode()
	return dsn.String()
}
