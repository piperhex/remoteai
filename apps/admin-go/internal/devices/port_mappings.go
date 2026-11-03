package devices

import (
	"context"
	"errors"
	"net"
	"net/http"
	"regexp"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type portMapping struct {
	ID         string `json:"id"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
	LocalPort  int    `json:"localPort"`
	Protocol   string `json:"protocol,omitempty"`
	UpdatedAt  int64  `json:"updatedAt,omitempty"`
}

type mappingDocument struct {
	OwnerID  string        `gorm:"column:ownerId;primaryKey" json:"-"`
	DeviceID string        `gorm:"column:deviceId;primaryKey" json:"-"`
	Revision int64         `json:"revision"`
	Mappings []portMapping `gorm:"serializer:json" json:"mappings"`
	Accepted bool          `gorm:"-" json:"accepted"`
}

func (mappingDocument) TableName() string { return "device_port_mappings" }

var mappingID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func (s *Service) registerPortMappings(group *gin.RouterGroup) {
	group.GET("/:deviceId/port-mappings", s.portMappings)
	group.PUT("/:deviceId/port-mappings", s.portMappings)
}

func (s *Service) portMappings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	owner, device := platform.User(c).ID, c.Param("deviceId")
	if _, err := s.owned(owner, device); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	var incoming *mappingDocument
	if c.Request.Method == http.MethodPut {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
		incoming = &mappingDocument{}
		if c.ShouldBindJSON(incoming) != nil || validatePortMappings(*incoming) != nil {
			platform.Fail(c, 400, "Invalid port mapping configuration")
			return
		}
	}
	result, err := s.syncPortMappings(c.Request.Context(), owner, device, incoming)
	platform.Respond(c, result, err)
}

func validatePortMappings(doc mappingDocument) error {
	invalid := errors.New("invalid port mapping configuration")
	if doc.Revision < 0 || len(doc.Mappings) > 8 || doc.Mappings == nil {
		return invalid
	}
	seen := map[string]bool{}
	for _, entry := range doc.Mappings {
		if entry.Protocol != "" && entry.Protocol != "tcp" && entry.Protocol != "udp" && entry.Protocol != "both" {
			return invalid
		}
		ip := net.ParseIP(entry.RemoteHost)
		if !mappingID.MatchString(entry.ID) || seen[entry.ID] || ip == nil || ip.IsUnspecified() ||
			entry.RemotePort < 1 || entry.RemotePort > 65535 || entry.LocalPort < 1 || entry.LocalPort > 65535 ||
			entry.UpdatedAt < 0 || entry.UpdatedAt > time.Now().Add(5*time.Minute).UnixMilli() {
			return invalid
		}
		seen[entry.ID] = true
	}
	return nil
}

func readPortMappings(db *gorm.DB, owner, device string) (mappingDocument, error) {
	result := mappingDocument{OwnerID: owner, DeviceID: device, Mappings: []portMapping{}}
	err := db.Where(`"ownerId" = ? AND "deviceId" = ?`, owner, device).First(&result).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	return result, err
}

// Compare-and-swap rejects stale snapshots, including snapshots predating a deletion.
func (s *Service) syncPortMappings(ctx context.Context, owner, device string,
	incoming *mappingDocument) (mappingDocument, error) {
	if incoming == nil {
		return s.cachedPortMappings(ctx, owner, device)
	}
	var result mappingDocument
	err := s.deps.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "port-mappings:"+owner+":"+device).Error; err != nil {
			return err
		}
		var err error
		result, err = readPortMappings(tx, owner, device)
		if err != nil || incoming.Revision != result.Revision {
			return err
		}
		result.Mappings = incoming.Mappings
		result.Revision++
		result.Accepted = true
		return tx.Save(&result).Error
	})
	if err == nil && result.Accepted {
		platform.InvalidatePortMappings(s.deps, owner, device)
	}
	return result, err
}
