package devices

import (
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/chatpush"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type commandSpec struct{ path, kind, field, capability string }

var deviceCommands = []commandSpec{
	{"account", "switch-account", "accountId", ""},
	{"openai-auth-account", "set-openai-auth-account", "accountId", ""},
	{"provider", "switch-provider", "providerId", "provider-switch"},
	{"provider-group", "switch-provider-group", "group", "provider-group-switch"},
	{"gui-account", "switch-gui-account", "accountId", "gui-model-switch"},
	{"gui-provider", "switch-gui-provider", "providerId", "gui-model-switch"},
	{"restart-codex", "restart-codex", "", "restart-codex"},
}

func Register(router *gin.Engine, deps *platform.Dependencies) (*Runtime, error) {
	service := &Service{deps}
	gateway := newControlGateway(service)
	chat, err := newChatGateway(service)
	if err != nil {
		return nil, err
	}
	runtime := &Runtime{control: gateway, chat: chat}
	gateway.revokeDesktopService = func(owner, id string) {
		chat.mu.Lock()
		defer chat.mu.Unlock()
		for client, state := range chat.connections {
			if client.serviceHost.Load() && state.identity != nil && state.identity.owner == owner && state.identity.device == id {
				client.close(4001, "Service access revoked")
			}
		}
	}
	runtime.stopPush = chatpush.Register(router, deps)
	router.GET("/device-switch", gateway.serve)
	router.GET("/device-chat", chat.serve)
	chat.registerAssistance(router)
	router.POST("/desktop-service/revoke", gateway.selfRevokeServiceCredential)
	group := router.Group("/devices", deps.RequireAuth())
	group.GET("", func(c *gin.Context) {
		devices, err := gateway.statuses(platform.User(c).ID)
		platform.Respond(c, gin.H{"devices": devices}, err)
	})
	group.GET("/providers", func(c *gin.Context) {
		providers, err := service.providers(platform.User(c).ID)
		platform.Respond(c, gin.H{"providers": providers}, err)
	})
	group.DELETE("/:deviceId", gateway.remove)
	group.POST("/:deviceId/service-credential", gateway.createServiceCredential)
	group.DELETE("/:deviceId/service-credential", gateway.revokeServiceCredential)
	for _, spec := range deviceCommands {
		group.POST("/:deviceId/"+spec.path, gateway.execute(spec))
	}
	return runtime, nil
}

func (g *ControlGateway) remove(c *gin.Context) {
	owner, id := platform.User(c).ID, c.Param("deviceId")
	if _, err := g.service.owned(owner, id); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if g.online(owner, id) {
		platform.Fail(c, 409, "Online devices cannot be removed")
		return
	}
	err := g.service.deps.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where(`"ownerId" = ? AND "deviceId" = ?`, owner, id).Delete(&Device{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return platform.NewError(404, "Device was not found")
		}
		return tx.Where("owner_id = ? AND device_id = ?", owner, id).Delete(&serviceCredential{}).Error
	})
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	g.broadcast(owner, platform.JSON{"type": "device-removed", "deviceId": id})
	c.Status(204)
}

func (g *ControlGateway) execute(spec commandSpec) gin.HandlerFunc {
	return func(c *gin.Context) {
		owner, id := platform.User(c).ID, c.Param("deviceId")
		device, err := g.service.owned(owner, id)
		if err != nil {
			platform.Respond(c, nil, err)
			return
		}
		if err := checkCapability(device, spec); err != nil {
			platform.Respond(c, nil, err)
			return
		}
		input := platform.JSON{}
		if spec.field != "" {
			if err := c.ShouldBindJSON(&input); err != nil {
				platform.Fail(c, 400, "Bad Request")
				return
			}
		}
		value, _ := input[spec.field].(string)
		if spec.field == "group" {
			value = strings.TrimSpace(value)
		}
		if err := g.validateTarget(owner, value, spec); err != nil {
			platform.Respond(c, nil, err)
			return
		}
		command := platform.JSON{"type": spec.kind}
		if spec.field != "" {
			command[spec.field] = value
		}
		if err := g.command(owner, id, command); err != nil {
			platform.Fail(c, 409, err.Error())
			return
		}
		result, err := g.saveCommand(device, spec, value)
		platform.Respond(c, result, err)
	}
}

func checkCapability(device *Device, spec commandSpec) error {
	if spec.capability == "" {
		return nil
	}
	has := false
	for _, capability := range device.Capabilities {
		if capability == spec.capability {
			has = true
		}
	}
	if !has {
		return platform.NewError(409, "请先更新目标 PC 上的 Remote AI")
	}
	if (spec.path == "provider" || spec.path == "provider-group") && !device.LocalProxyRunning {
		return platform.NewError(409, "请先在目标 PC 上启动本地代理")
	}
	return nil
}

func (g *ControlGateway) validateTarget(owner, value string, spec commandSpec) error {
	if spec.field == "" {
		return nil
	}
	kind := strings.TrimPrefix(spec.path, "gui-")
	if kind == "openai-auth-account" {
		kind = "account"
	}
	return g.service.available(owner, kind, value)
}

func (g *ControlGateway) saveCommand(previous *Device, spec commandSpec, value string) (platform.JSON, error) {
	result := platform.JSON{"deviceId": previous.DeviceID, "online": true}
	if spec.path == "restart-codex" {
		result["restarted"] = true
		return result, nil
	}
	patch := modelSwitchPatch(spec.path, value)
	patch["lastSeenAt"] = time.Now().UTC().Truncate(time.Millisecond)
	err := g.service.deps.DB.Model(&Device{}).
		Where(`"ownerId" = ? AND "deviceId" = ?`, previous.OwnerID, previous.DeviceID).
		Updates(patch).
		Error
	if err != nil {
		return nil, err
	}
	device, err := g.service.owned(previous.OwnerID, previous.DeviceID)
	if err != nil {
		return nil, err
	}
	if spec.path == "openai-auth-account" {
		result["openaiAuthAccountId"] = device.OpenAIAuthAccountID
		return result, nil
	}
	result["activeAccountId"] = device.ActiveAccountID
	result["activeProviderId"] = device.ActiveProviderID
	result["activeProviderGroup"] = device.ActiveProviderGroup
	result["guiAccountId"] = device.GuiAccountID
	result["guiProviderId"] = device.GuiProviderID
	if spec.capability == "gui-model-switch" {
		result["requiresRestart"] = false
		return result, nil
	}
	hadProvider := nonempty(previous.ActiveProviderID) || nonempty(previous.ActiveProviderGroup)
	result["requiresRestart"] = !hadProvider && nonempty(previous.ActiveAccountID)
	if spec.path == "account" {
		result["requiresRestart"] = hadProvider
	}
	return result, nil
}

func nonempty(value *string) bool { return value != nil && *value != "" }
