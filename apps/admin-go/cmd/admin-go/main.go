package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/codex-switch/admin-go/internal/accounts"
	"github.com/codex-switch/admin-go/internal/identity"
	"github.com/codex-switch/admin-go/internal/migrations"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/server"
	"github.com/codex-switch/admin-go/internal/turnquota"
)

func main() {
	if err := run(); err != nil {
		slog.Error("admin-go stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	config, err := platform.LoadConfig()
	if err != nil {
		return err
	}
	deps, err := platform.OpenDependencies(config)
	if err != nil {
		return err
	}
	defer deps.Redis.Close()
	sqlDB, err := deps.DB.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	if config.Get("POSTGRES_DB_SYNCHRONIZE", "false") == "true" {
		if err := migrations.InitializeEmpty(deps.DB); err != nil {
			return err
		}
	}
	if err := identity.Initialize(deps); err != nil {
		return err
	}
	router, runtime, err := server.New(deps)
	if err != nil {
		return err
	}
	defer func() {
		if err := runtime.Close(); err != nil {
			slog.Error("shutdown flush failed", "error", err)
		}
	}()
	stopModels := accounts.StartModelCatalogRefresh(deps)
	defer stopModels()
	stopQuota := turnquota.Start(deps)
	defer stopQuota()
	return serve(config, server.Handler(router))
}

func serve(config platform.Config, handler http.Handler) error {
	service := &http.Server{Addr: ":" + config.Get("LISTEN_PORT", "8080"), Handler: handler,
		ReadHeaderTimeout: 60 * time.Second, IdleTimeout: 65 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errorsChannel := make(chan error, 1)
	go func() {
		slog.Info("admin-go listening", "address", service.Addr)
		errorsChannel <- service.ListenAndServe()
	}()
	select {
	case err := <-errorsChannel:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return service.Shutdown(shutdown)
	}
	return nil
}
