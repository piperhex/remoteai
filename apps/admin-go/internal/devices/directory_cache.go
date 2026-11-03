package devices

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
)

// These internal fields are deliberately absent from Device's public JSON representation.
type directoryRecord struct {
	Device               Device
	OwnerID              string
	CreatedAt, UpdatedAt time.Time
}

func (s *Service) cachedDirectory(owner string) ([]Device, error) {
	ctx, cancel := platform.DatabaseContext(context.Background())
	defer cancel()
	records, err := readcache.Load(ctx, readcache.Options{Client: s.deps.Redis,
		Key: platform.DeviceDirectoryCacheKey(owner), Lifetime: 30 * time.Second},
		func(ctx context.Context) ([]directoryRecord, error) {
			devices := []Device{}
			err := s.deps.DB.WithContext(ctx).Where(`"ownerId" = ?`, owner).
				Order(`"lastSeenAt" DESC, name ASC`).Find(&devices).Error
			records := make([]directoryRecord, 0, len(devices))
			for _, device := range devices {
				records = append(records, directoryRecord{device, device.OwnerID, device.CreatedAt, device.UpdatedAt})
			}
			return records, err
		})
	devices := make([]Device, 0, len(records))
	for _, record := range records {
		device := record.Device
		device.OwnerID, device.CreatedAt, device.UpdatedAt = record.OwnerID, record.CreatedAt, record.UpdatedAt
		devices = append(devices, device)
	}
	return devices, err
}
