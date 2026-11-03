package turnquota

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

const reconcileInterval = 5 * time.Second

type controlConfig struct{ address, password, realm, directory string }

var realmPattern = regexp.MustCompile(`^[a-zA-Z0-9.-]+$`)
var secretPattern = regexp.MustCompile(`^[a-zA-Z0-9_./+=-]{32,}$`)

func configuration(config platform.Config) (controlConfig, bool) {
	c := controlConfig{address: config.Get("DESKTOP_TURN_CONTROL", ""),
		password:  config.Get("DESKTOP_TURN_CONTROL_PASSWORD", ""),
		realm:     config.Get("DESKTOP_TURN_REALM", "codex-switch"),
		directory: config.Get("DESKTOP_TURN_QUOTA_DIR", "")}
	return c, c.address != "" && c.directory != "" && realmPattern.MatchString(c.realm) &&
		secretPattern.MatchString(c.password)
}

// Status reports a fresh control-channel observation, never a cached success flag.
type Status struct {
	TotalQuota   int       `json:"totalQuota"`
	AppliedQuota *int      `json:"appliedQuota"`
	State        string    `json:"state"`
	Issue        string    `json:"issue,omitempty"`
	CheckedAt    time.Time `json:"checkedAt"`
}

func snapshot(policy Policy) Status {
	return Status{TotalQuota: policy.TotalQuota, State: "pending", CheckedAt: time.Now().UTC()}
}

func inspect(ctx context.Context, config controlConfig, status Status) Status {
	c, err := connect(ctx, config)
	if err != nil {
		status.Issue = "control_unavailable"
		return status
	}
	defer c.conn.Close()
	quota, err := c.read(config.realm)
	if err != nil {
		status.Issue = "control_unavailable"
		return status
	}
	status.AppliedQuota = &quota.Current
	if quota.Current == status.TotalQuota && quota.Default == status.TotalQuota &&
		readBootstrap(config.directory) == status.TotalQuota {
		status.State = "applied"
	}
	return status
}

func Snapshot(ctx context.Context, deps *platform.Dependencies) (Status, error) {
	policy, err := Read(deps.DB.WithContext(ctx))
	if err != nil {
		return Status{}, err
	}
	status := snapshot(policy)
	config, ok := configuration(deps.Config)
	if !ok {
		status.Issue = "not_configured"
		return status, nil
	}
	return inspect(ctx, config, status), nil
}

// Reconcile writes the restart snapshot before changing admission, then reads the
// actual realm quota. coturn 4.18.0 refreshes it every five seconds; cc alone is not proof.
func Reconcile(ctx context.Context, deps *platform.Dependencies) (Status, error) {
	var status Status
	err := locked(ctx, deps.DB, func(tx *gorm.DB) error {
		policy, err := Read(tx)
		if err != nil {
			return err
		}
		status = snapshot(policy)
		config, ok := configuration(deps.Config)
		if !ok {
			status.Issue = "not_configured"
			return nil
		}
		if err := writeBootstrap(config.directory, policy.TotalQuota); err != nil {
			status.Issue = "restart_snapshot_failed"
			return nil
		}
		c, err := connect(ctx, config)
		if err != nil {
			status.Issue = "control_unavailable"
			return nil
		}
		defer c.conn.Close()
		quota, err := c.read(config.realm)
		if err == nil && quota.Default != policy.TotalQuota {
			err = c.set(policy.TotalQuota)
		}
		if err != nil {
			status.Issue = "control_unavailable"
			return nil
		}
		quota, err = c.read(config.realm)
		if err != nil {
			status.Issue = "control_unavailable"
			return nil
		}
		status.AppliedQuota = &quota.Current
		if quota.Current == policy.TotalQuota && quota.Default == policy.TotalQuota {
			status.State = "applied"
		}
		return nil
	})
	return status, err
}

func readBootstrap(directory string) int {
	data, err := os.ReadFile(filepath.Join(directory, "total-quota"))
	if err != nil {
		return 0
	}
	text := string(data)
	value, err := strconv.Atoi(text)
	if err != nil && len(text) > 0 && text[len(text)-1] == '\n' {
		value, err = strconv.Atoi(text[:len(text)-1])
	}
	if err != nil || value < Minimum || value > Maximum {
		return 0
	}
	canonical := strconv.Itoa(value)
	if text != canonical && text != canonical+"\n" {
		return 0
	}
	return value
}

func writeBootstrap(directory string, value int) error {
	if readBootstrap(directory) == value {
		return nil
	}
	file, err := os.CreateTemp(directory, ".total-quota-")
	if err != nil {
		return err
	}
	defer func() { // A failed atomic replacement must not leave a partial startup value.
		if err := os.Remove(file.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("TURN quota temporary file cleanup failed")
		}
	}()
	_, writeErr := file.WriteString(strconv.Itoa(value) + "\n")
	// The quota is public configuration. coturn runs as nobody and mounts this volume read-only.
	modeErr := file.Chmod(0644)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err := errors.Join(writeErr, modeErr, syncErr, closeErr); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(directory, "total-quota"))
}

// Start runs one bounded, single-flight reconciler and joins it on shutdown.
func Start(deps *platform.Dependencies) func() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		timer := time.NewTicker(reconcileInterval)
		defer timer.Stop()
		for {
			if _, enabled := configuration(deps.Config); enabled {
				attempt, stop := context.WithTimeout(ctx, 4*time.Second)
				status, err := Reconcile(attempt, deps)
				stop()
				if err != nil {
					status.Issue = "storage_unavailable"
				}
				if err != nil || status.Issue != "" {
					slog.Warn("TURN quota synchronization pending", "issue", status.Issue)
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
