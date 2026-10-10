package devices

import (
	"net/mail"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func (g *ChatGateway) registerAssistance(router *gin.Engine) {
	group := router.Group("/remote-assistance", g.service.deps.RequireAuth())
	group.GET("", g.assistanceList)
	group.POST("", g.assistanceCreate)
	group.POST("/:id", g.assistanceUpdate)
}

func (g *ChatGateway) assistanceList(c *gin.Context) {
	owner, device := platform.User(c).ID, c.Query("deviceId")
	if _, err := g.service.owned(owner, device); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	platform.Respond(c, gin.H{"requests": g.sessions.listAssistance(owner, device)}, nil)
}

func (g *ChatGateway) assistanceCreate(c *gin.Context) {
	var input struct {
		DeviceID string `json:"deviceId" binding:"required,max=160"`
		Email    string `json:"email" binding:"required,max=254"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		platform.Fail(c, 400, "请输入有效的邮箱地址。")
		return
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		platform.Fail(c, 400, "请输入有效的邮箱地址。")
		return
	}
	user := platform.User(c)
	device, err := g.service.owned(user.ID, input.DeviceID)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	helper, err := g.assistanceRecipient(email)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if helper == user.ID {
		helper = ""
	}
	request, err := g.sessions.createAssistance(assistanceRequest{
		HostOwner: user.ID, HostDeviceID: device.DeviceID, HostName: device.Name, HostEmail: user.Email,
		HelperOwner: helper, HelperEmail: email,
	})
	platform.Respond(c, request, err)
}

func (g *ChatGateway) assistanceRecipient(email string) (string, error) {
	var user struct{ ID string }
	result := g.service.deps.DB.Table("users").Select("id").Where("email = ? AND disabled = ?", email, false).Scan(&user)
	if result.Error != nil {
		return "", result.Error
	}
	return user.ID, nil
}

func (g *ChatGateway) assistanceUpdate(c *gin.Context) {
	var input struct {
		DeviceID string `json:"deviceId" binding:"required,max=160"`
		Action   string `json:"action" binding:"required,oneof=accept decline end"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		platform.Fail(c, 400, "请选择有效的协助操作。")
		return
	}
	owner := platform.User(c).ID
	if _, err := g.service.owned(owner, input.DeviceID); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	request, err := g.sessions.updateAssistance(assistanceActor{owner, input.DeviceID, c.Param("id")}, input.Action)
	platform.Respond(c, request, err)
}
