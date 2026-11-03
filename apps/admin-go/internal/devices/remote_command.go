package devices

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const remoteCommandTimeout = 70 * time.Second
const maxRemoteCommandBytes = 16 * 1024
const maxRemoteOutputBytes = 3 * 64 * 1024 // UTF-8 replacement characters can expand invalid bytes.

type pendingRemoteCommand struct {
	owner, device, request string
	client, desktop        *peer
	timer                  *time.Timer
}

type remoteCommandInput struct {
	Command        string  `json:"command"`
	Cwd            *string `json:"cwd"`
	Shell          string  `json:"shell"`
	TimeoutSeconds int     `json:"timeoutSeconds"`
}

func parseRemoteCommand(value interface{}) (remoteCommandInput, bool) {
	input := remoteCommandInput{Shell: "auto", TimeoutSeconds: 30}
	data, err := json.Marshal(value)
	if err != nil || len(data) > 32*1024 {
		return input, false
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		return input, false
	}
	valid := strings.TrimSpace(input.Command) != "" && len(input.Command) <= maxRemoteCommandBytes &&
		!strings.ContainsRune(input.Command, 0) && input.TimeoutSeconds >= 1 && input.TimeoutSeconds <= 60 &&
		(input.Shell == "auto" || input.Shell == "powershell" || input.Shell == "sh")
	if input.Cwd != nil {
		valid = valid && *input.Cwd != "" && len(*input.Cwd) <= 4096 && !strings.ContainsRune(*input.Cwd, 0)
	}
	return input, valid
}

func (g *ControlGateway) requestRemoteCommand(client *peer, session controlSession, message platform.JSON) {
	request, _ := message["requestId"].(string)
	id, _ := message["deviceId"].(string)
	input, valid := parseRemoteCommand(message["request"])
	if !valid || request == "" || len(request) > 80 || !deviceIDPattern.MatchString(id) {
		sendRemoteResult(client, request, nil, "命令请求无效，请检查后重试。")
		return
	}
	device, err := g.service.owned(session.owner, id)
	if err != nil {
		sendRemoteResult(client, request, nil, "无法访问这台电脑。")
		return
	}
	if checkCapability(device, commandSpec{capability: "remote-command"}) != nil {
		sendRemoteResult(client, request, nil, "请在目标电脑安装并启用远程命令插件。")
		return
	}
	g.forwardRemoteCommand(client, session.owner, message, input)
}

func (g *ControlGateway) forwardRemoteCommand(
	client *peer, owner string, message platform.JSON, input remoteCommandInput,
) {
	id, request := message["deviceId"].(string), message["requestId"].(string)
	g.mu.Lock()
	defer g.mu.Unlock()
	desktop := g.sockets[owner+":"+id]
	if desktop == nil || desktop.closed.Load() {
		sendRemoteResult(client, request, nil, "电脑已离线，请打开电脑端后重试。")
		return
	}
	limit := g.remoteCommandLimit()
	if g.remoteCommandBusy(client, owner, id, limit) {
		client.send(platform.JSON{"type": "remote-command-result", "requestId": request,
			"error": remoteCommandBusyMessage, "errorCode": "client.remoteCommand.busy"}, nil)
		return
	}
	command := uuid.NewString()
	timer := time.AfterFunc(remoteCommandTimeout, func() { g.expireRemoteCommand(command) })
	g.commands[command] = pendingRemoteCommand{owner, id, request, client, desktop, timer}
	desktop.send(platform.JSON{"type": "remote-command", "commandId": command, "request": input,
		"concurrencyLimit": limit}, nil)
}

type remoteCommandOutput struct {
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   *int   `json:"exitCode"`
	TimedOut   bool   `json:"timedOut"`
	Truncated  bool   `json:"truncated"`
	DurationMS uint64 `json:"durationMs"`
}

func (g *ControlGateway) receiveRemoteCommand(client *peer, session controlSession, message platform.JSON) {
	command, _ := message["commandId"].(string)
	g.mu.Lock()
	defer g.mu.Unlock()
	pending, ok := g.commands[command]
	if !ok || pending.owner != session.owner || pending.device != session.device || pending.desktop != client {
		return
	}
	delete(g.commands, command)
	pending.timer.Stop()
	detail, _ := message["error"].(string)
	if detail != "" {
		// Desktop errors are bounded user-facing messages, never arbitrary internal error objects.
		if len(detail) > 400 {
			detail = "远程命令未完成，请检查目标电脑。"
		}
		sendRemoteResult(pending.client, pending.request, nil, detail)
		return
	}
	data, err := json.Marshal(message["data"])
	var output remoteCommandOutput
	if err != nil || string(data) == "null" || json.Unmarshal(data, &output) != nil ||
		len(output.Stdout) > maxRemoteOutputBytes || len(output.Stderr) > maxRemoteOutputBytes {
		sendRemoteResult(pending.client, pending.request, nil, "命令结果无法读取，请缩小查询范围后重试。")
		return
	}
	sendRemoteResult(pending.client, pending.request, output, "")
}

func (g *ControlGateway) expireRemoteCommand(command string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	pending, ok := g.commands[command]
	if !ok {
		return
	}
	delete(g.commands, command)
	pending.desktop.send(platform.JSON{"type": "remote-command-cancel", "commandId": command}, nil)
	sendRemoteResult(pending.client, pending.request, nil,
		"等待结果超时，命令可能已执行。请先检查状态，再决定是否重试。")
}

// Called with the gateway lock held. A replacement socket cannot complete an old command.
func (g *ControlGateway) disconnectRemoteCommands(client *peer) {
	for command, pending := range g.commands {
		if pending.client != client && pending.desktop != client {
			continue
		}
		delete(g.commands, command)
		pending.timer.Stop()
		if pending.client == client {
			pending.desktop.send(platform.JSON{"type": "remote-command-cancel", "commandId": command}, nil)
		} else {
			sendRemoteResult(pending.client, pending.request, nil,
				"连接已断开，命令可能已执行。请重新连接并检查状态。")
		}
	}
}

func sendRemoteResult(client *peer, request string, data interface{}, detail string) {
	client.send(platform.JSON{"type": "remote-command-result", "requestId": request, "data": data, "error": detail}, nil)
}
