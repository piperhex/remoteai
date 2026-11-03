package devices

import (
	"errors"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/codex-switch/admin-go/internal/accounts"
	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

type Device struct {
	OwnerID             string    `gorm:"column:ownerId;primaryKey"           json:"-"`
	DeviceID            string    `gorm:"column:deviceId;primaryKey"          json:"deviceId"`
	Name                string    `gorm:"column:name"                         json:"name"`
	Platform            string    `gorm:"column:platform"                     json:"platform"`
	AppVersion          *string   `gorm:"column:appVersion"                   json:"appVersion"`
	ActiveAccountID     *string   `gorm:"column:activeAccountId"              json:"activeAccountId"`
	OpenAIAuthAccountID *string   `gorm:"column:openaiAuthAccountId"          json:"openaiAuthAccountId"`
	ActiveProviderID    *string   `gorm:"column:activeProviderId"             json:"activeProviderId"`
	ActiveProviderGroup *string   `gorm:"column:activeProviderGroup"          json:"activeProviderGroup"`
	GuiAccountID        *string   `gorm:"column:guiAccountId"                 json:"guiAccountId"`
	GuiProviderID       *string   `gorm:"column:guiProviderId"                json:"guiProviderId"`
	LocalProxyRunning   bool      `gorm:"column:localProxyRunning"            json:"localProxyRunning"`
	Capabilities        []string  `gorm:"column:capabilities;serializer:json" json:"capabilities"`
	LastSeenAt          time.Time `gorm:"column:lastSeenAt"                   json:"lastSeenAt"`
	CreatedAt           time.Time `gorm:"column:createdAt;autoCreateTime"     json:"-"`
	UpdatedAt           time.Time `gorm:"column:updatedAt;autoUpdateTime"     json:"-"`
}

func (Device) TableName() string { return "remote_devices" }

type Service struct{ deps *platform.Dependencies }

func (s *Service) list(owner string) ([]Device, error) {
	return s.cachedDirectory(owner)
}

func (s *Service) owned(owner, id string) (*Device, error) {
	var device Device
	err := s.deps.DB.Where(`"ownerId" = ? AND "deviceId" = ?`, owner, id).First(&device).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, platform.NewError(404, "Device was not found")
	}
	return &device, err
}

func trimLimit(text string, limit int) string {
	units := utf16.Encode([]rune(strings.TrimSpace(text)))
	if len(units) > limit {
		units = units[:limit]
	}
	return string(utf16.Decode(units))
}

func (s *Service) register(owner string, input platform.JSON) (*Device, error) {
	id, _ := input["deviceId"].(string)
	device, err := s.owned(owner, id)
	var public *platform.HTTPError
	if err != nil && (!errors.As(err, &public) || public.Status != 404) {
		return nil, err
	}
	if err != nil {
		device = &Device{OwnerID: owner, DeviceID: id}
	}
	name, nameOK := input["name"].(string)
	devicePlatform, platformOK := input["platform"].(string)
	if !nameOK || !platformOK {
		return nil, errors.New("invalid device metadata")
	}
	device.Name = trimLimit(name, 120)
	if device.Name == "" {
		device.Name = "Remote AI"
	}
	device.Platform = trimLimit(devicePlatform, 20)
	if device.Platform == "" {
		device.Platform = "unknown"
	}
	version, versionOK := input["appVersion"].(string)
	if input["appVersion"] != nil && !versionOK {
		return nil, errors.New("invalid app version")
	}
	version = trimLimit(version, 50)
	device.AppVersion = nil
	if version != "" {
		device.AppVersion = &version
	}
	mergeDeviceState(device, input)
	device.LastSeenAt = time.Now().UTC().Truncate(time.Millisecond)
	err = s.deps.DB.Save(device).Error
	if err == nil {
		platform.InvalidateDeviceDirectory(s.deps, owner)
	}
	return device, err
}

func mergeDeviceState(device *Device, input platform.JSON) {
	// Older desktops cannot report a GUI selection; do not retain stale choices after a downgrade.
	device.GuiAccountID = nullableText(input["guiAccountId"])
	device.GuiProviderID = nullableText(input["guiProviderId"])
	if value, ok := input["activeAccountId"].(string); ok {
		device.ActiveAccountID = &value
	}
	if value, ok := input["openaiAuthAccountId"].(string); ok {
		device.OpenAIAuthAccountID = &value
	}
	if value, exists := input["activeProviderId"]; exists {
		device.ActiveProviderID = nullableText(value)
	}
	if value, exists := input["activeProviderGroup"]; exists {
		device.ActiveProviderGroup = nullableText(value)
	}
	if value, ok := input["localProxyRunning"].(bool); ok {
		device.LocalProxyRunning = value
	}
	device.Capabilities = normalizeCapabilities(input["capabilities"])
}

func nullableText(value interface{}) *string {
	text, ok := value.(string)
	if !ok {
		return nil
	}
	return &text
}

func normalizeCapabilities(value interface{}) []string {
	result := []string{}
	seen := map[string]bool{}
	values, _ := value.([]interface{})
	for _, item := range values {
		name, _ := item.(string)
		if seen[name] || !supportedCapability(name) {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	return result
}

func supportedCapability(name string) bool {
	switch name {
	case "aggregate-switch", "gui-aggregate-switch", "account-usage", screenPowerCapability:
		return true
	case "provider-switch", "provider-group-switch", "restart-codex", "gui-model-switch", "app-update", "remote-command":
		return true
	default:
		return false
	}
}

func (s *Service) touch(owner, id string) error {
	err := s.deps.DB.Model(&Device{}).Where(`"ownerId" = ? AND "deviceId" = ?`, owner, id).
		Updates(map[string]interface{}{"lastSeenAt": time.Now().UTC().Truncate(time.Millisecond)}).Error
	if err == nil {
		platform.InvalidateDeviceDirectory(s.deps, owner)
	}
	return err
}

func (s *Service) providers(owner string) ([]platform.JSON, error) {
	providers, err := accounts.SyncedProviders(s.deps, owner)
	result := []platform.JSON{}
	for _, provider := range providers {
		group := provider["group"]
		if group == nil {
			group = ""
		}
		result = append(
			result,
			platform.JSON{"id": provider["id"], "name": provider["name"], "model": provider["model"], "group": group},
		)
	}
	return result, err
}

func (s *Service) aggregates(owner string) ([]platform.JSON, error) {
	return accounts.AggregateSummaries(s.deps, owner)
}

func (s *Service) available(owner, kind, id string) error {
	var items []map[string]interface{}
	var err error
	if kind == "account" {
		items, err = accounts.EffectiveAccounts(s.deps, owner)
	} else if kind == "aggregate" {
		items, err = s.aggregates(owner)
		id = "aggregate:" + id
	} else {
		items, err = s.providers(owner)
	}
	if err != nil {
		return err
	}
	field, label := "id", "Account"
	if kind == "provider" {
		label = "Provider"
	}
	if kind == "aggregate" {
		label = "Aggregate API"
	}
	if kind == "provider-group" {
		field, label = "group", "Provider group"
	}
	for _, item := range items {
		if item[field] == id && (kind != "provider-group" || strings.TrimSpace(id) != "") {
			return nil
		}
	}
	return platform.NewError(404, label+" was not found")
}
