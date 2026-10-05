package content

import (
	"errors"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

type homePreset struct {
	Id          string `json:"id"`
	Name        string `json:"name"`
	WindowsPath string `json:"windowsPath"`
	MacosPath   string `json:"macosPath"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int64  `json:"sortOrder"`
}
type homeSettings struct {
	Id             string       `gorm:"column:id;primaryKey"`
	Presets        []homePreset `gorm:"column:presets;serializer:json"`
	UpdatedById    *string      `gorm:"column:updated_by_id"`
	UpdatedByEmail string       `gorm:"column:updated_by_email"`
	UpdatedAt      time.Time    `gorm:"column:updated_at;autoUpdateTime"`
}

func (homeSettings) TableName() string { return "codex_home_preset_settings" }

type chatSettings struct {
	Id        string                 `gorm:"column:id;primaryKey"`
	Policy    map[string]interface{} `gorm:"column:policy;serializer:json"`
	UpdatedAt time.Time              `gorm:"column:updated_at;autoUpdateTime"`
}

func (chatSettings) TableName() string { return "chat_settings" }
func (s *service) settingsRoutes(r *gin.Engine) {
	r.GET("/codex-home-presets", noStore, s.publicHomePresets)
	r.GET(
		"/admin/api/codex-home-presets",
		s.deps.RequirePermissions("admin.codex-home-presets.read"),
		s.adminHomePresets,
	)
	r.PATCH(
		"/admin/api/codex-home-presets",
		s.deps.RequirePermissions("admin.codex-home-presets.manage"),
		s.updateHomePresets,
	)
	r.GET("/chat/title-settings", noStore, s.titleSettings)
	r.GET("/admin/api/chat-settings", s.deps.RequirePermissions("admin.chat-settings.read"), noStore, s.chatPolicy)
	r.PATCH("/admin/api/chat-settings", s.deps.RequirePermissions("admin.chat-settings.manage"), s.updateChatPolicy)
	r.GET("/currency-rates", noStore, s.publicCurrencyRates)
	r.GET("/admin/api/currency", s.deps.RequirePermissions("admin.currency.read"), s.adminCurrency)
	r.PATCH("/admin/api/currency", s.deps.RequirePermissions("admin.currency.manage"), s.updateCurrency)
}
func (s *service) readHomePresets() (homeSettings, error) {
	item := homeSettings{Id: "current", Presets: []homePreset{}}
	err := s.deps.DB.First(&item, "id = ?", "current").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	return item, err
}
func (s *service) publicHomePresets(c *gin.Context) {
	item, err := s.readHomePresets()
	sort.SliceStable(item.Presets, func(i, j int) bool { return item.Presets[i].SortOrder < item.Presets[j].SortOrder })
	values := []gin.H{}
	for _, preset := range item.Presets {
		if !preset.Enabled {
			continue
		}
		path := preset.WindowsPath
		if c.Query("platform") == "macos" {
			path = preset.MacosPath
		}
		values = append(values, gin.H{"id": preset.Id, "name": preset.Name, "path": path})
	}
	platform.Respond(c, values, err)
}
func (s *service) adminHomePresets(c *gin.Context) {
	item, err := s.readHomePresets()
	platform.Respond(c, gin.H{"presets": item.Presets, "updatedAt": dateOrNil(item.UpdatedAt)}, err)
}
func normalizePresets(items []homePreset) ([]homePreset, error) {
	if len(items) > 20 {
		return nil, platform.NewError(400, "No more than 20 presets are allowed")
	}
	seen := map[string]bool{}
	for index, item := range items {
		item.Id, item.Name = strings.TrimSpace(item.Id), strings.TrimSpace(item.Name)
		item.WindowsPath, item.MacosPath = strings.TrimSpace(item.WindowsPath), strings.TrimSpace(item.MacosPath)
		if seen[item.Id] {
			return nil, platform.NewError(400, "Preset IDs must be unique")
		}
		seen[item.Id] = true
		items[index] = item
	}
	return items, nil
}
func (s *service) updateHomePresets(c *gin.Context) {
	var input struct{ Presets []homePreset }
	if !bind(c, &input) {
		return
	}
	presets, err := normalizePresets(input.Presets)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item, err := s.readHomePresets()
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	actor := platform.User(c)
	item.Presets, item.UpdatedById, item.UpdatedByEmail = presets, ptr(actor.ID), actor.Email
	if err = s.deps.DB.Save(&item).Error; err == nil {
		err = audit(
			s.deps.DB,
			actor,
			auditOptions{
				Action:     "codex-home-presets.update",
				TargetType: "codex-home-presets",
				TargetID:   "current",
				Metadata:   gin.H{"presetCount": len(presets)},
			},
		)
	}
	platform.Respond(c, gin.H{"presets": item.Presets, "updatedAt": iso(item.UpdatedAt)}, err)
}

type policyField struct {
	Name             string
	Minimum, Default float64
	Optional         bool
}

// DefaultChatSessionLimit applies when older settings omit the per-computer connection limit.
const DefaultChatSessionLimit = 5

// Reserve RPC capacity for chat while two file downloads are active.
const maxFileDownloadWindowSize = 12

var policyFields = []policyField{
	{Name: "chatSessionLimit", Minimum: 1, Default: DefaultChatSessionLimit, Optional: true},
	{Name: "p2pNegotiationTimeoutSeconds", Minimum: 1, Default: 45, Optional: true},
	{Name: "p2pRetryIntervalSeconds", Minimum: 1, Default: 10, Optional: true},
	{Name: "p2pDisconnectGraceSeconds", Minimum: 1, Default: 10, Optional: true},
	{Name: "relayHeartbeatTimeoutSeconds", Minimum: 1, Default: 30, Optional: true},
	{"relayMaxMbPerSecond", -1, -1, true}, {"relayMaxFramesPerSecond", -1, -1, true}, {"threadPageSize", 1, 50, false},
	{"historyPageSize", 1, 10, false}, {"imageSourceMaxMb", 1, 20, false}, {"imageMaxEdge", 256, 2048, false},
	{"imageTargetKb", 32, 512, false}, {"fileUploadMaxMb", 1, 2, true}, {"fileUploadTotalMaxMb", 1, 3, true},
	{"filePreviewMaxMb", 1, 2, false}, {"imagePreviewMaxMb", 1, 20, false}, {"videoPreviewMaxMb", 1, 100, true},
	{"fileDownloadMaxMb", 1, 20, false},
	{"fileDownloadWindowSize", 1, 5, true},
}
var titleModelPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$`)

func defaultTitleSettings() gin.H { return gin.H{"model": "gpt-5.6-luna", "effort": "low"} }
func defaultChatPolicy() map[string]interface{} {
	result := map[string]interface{}{"titleSettings": defaultTitleSettings()}
	for _, field := range policyFields {
		result[field.Name] = field.Default
	}
	return result
}
func parseTitleSettings(value interface{}, present bool) (gin.H, error) {
	if !present {
		return defaultTitleSettings(), nil
	}
	record, ok := value.(map[string]interface{})
	if !ok {
		return nil, errors.New("invalid title settings")
	}
	model, ok := record["model"].(string)
	if !ok || !titleModelPattern.MatchString(strings.TrimSpace(model)) {
		return nil, errors.New("invalid title model")
	}
	effort, ok := record["effort"].(string)
	if !ok {
		return nil, errors.New("invalid title effort")
	}
	for _, allowed := range []string{"none", "minimal", "low", "medium", "high", "xhigh"} {
		if effort == allowed {
			return gin.H{"model": strings.TrimSpace(model), "effort": effort}, nil
		}
	}
	return nil, errors.New("invalid title effort")
}
func parseChatPolicy(record map[string]interface{}) (map[string]interface{}, error) {
	if record == nil {
		return nil, errors.New("invalid chat settings")
	}
	result := defaultChatPolicy()
	for _, field := range policyFields {
		value, present := record[field.Name]
		if !present && field.Optional {
			continue
		}
		number, ok := value.(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number ||
			math.Abs(number) > 9007199254740991 ||
			number < field.Minimum ||
			(field.Name == "fileDownloadWindowSize" && number > maxFileDownloadWindowSize) ||
			(field.Default == -1 && number == 0) {
			return nil, errors.New("invalid chat limit")
		}
		result[field.Name] = number
	}
	title, present := record["titleSettings"]
	settings, err := parseTitleSettings(title, present)
	if err != nil {
		return nil, err
	}
	result["titleSettings"] = settings
	return result, nil
}

// ReadChatPolicy returns persisted limits in the same format used by the relay handshake.
func ReadChatPolicy(db *gorm.DB) (map[string]interface{}, error) {
	var row chatSettings
	err := db.First(&row, "id = ?", "current").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultChatPolicy(), nil
	}
	if err != nil {
		return nil, err
	}
	return parseChatPolicy(row.Policy)
}
func (s *service) titleSettings(c *gin.Context) {
	policy, err := ReadChatPolicy(s.deps.DB)
	platform.Respond(c, policy["titleSettings"], err)
}
func (s *service) chatPolicy(c *gin.Context) {
	policy, err := ReadChatPolicy(s.deps.DB)
	platform.Respond(c, policy, err)
}
func (s *service) updateChatPolicy(c *gin.Context) {
	var input map[string]interface{}
	if !bind(c, &input) {
		return
	}
	policy, err := parseChatPolicy(input)
	if err != nil {
		platform.Fail(c, 400, "请在允许范围内填写完整的聊天设置。")
		return
	}
	err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&chatSettings{Id: "current", Policy: policy}).Error; err != nil {
			return err
		}
		return audit(
			tx,
			platform.User(c),
			auditOptions{
				Action:     "chat-settings.update",
				TargetType: "chat-settings",
				TargetID:   "current",
				Metadata:   policy,
			},
		)
	})
	if err == nil && s.deps.ChatPolicyChanged != nil {
		s.deps.ChatPolicyChanged()
	}
	platform.Respond(c, policy, err)
}
