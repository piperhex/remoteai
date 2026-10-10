package devices

import (
	"errors"
	"log/slog"
	"regexp"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type controlSession struct {
	owner, device, kind string
	expires             time.Time
}
type pendingCommand struct {
	owner, device string
	result        chan error
}
type ControlGateway struct {
	revokeDesktopService func(string, string)
	service              *Service
	mu                   sync.Mutex
	sessions             map[*peer]controlSession
	sockets              map[string]*peer
	subscribers          map[string]map[*peer]bool
	pending              map[string]pendingCommand
	updates              map[string]pendingAppUpdate
	commands             map[string]pendingRemoteCommand
	updatePeers          *updatePeerTracker
}

func newControlGateway(service *Service) *ControlGateway {
	return &ControlGateway{service: service, sessions: map[*peer]controlSession{}, sockets: map[string]*peer{},
		subscribers: map[string]map[*peer]bool{}, pending: map[string]pendingCommand{},
		updates: map[string]pendingAppUpdate{}, commands: map[string]pendingRemoteCommand{},
		updatePeers: newUpdatePeerTracker(service)}
}

func (g *ControlGateway) serve(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(100 * 1024 * 1024) // Matches ws' device gateway default, separate from chat's 48 KiB cap.
	client := newPeer(conn)
	timer := time.AfterFunc(authTimeout, func() { client.close(4001, "Authentication timed out") })
	defer timer.Stop()
	defer client.terminate()
	defer g.disconnect(client)
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		message, err := parseObject(raw)
		if err == nil {
			err = g.receive(client, message, timer)
		}
		if err != nil {
			client.close(4001, "Invalid message")
			return
		}
	}
}

func (g *ControlGateway) receive(client *peer, message platform.JSON, timer *time.Timer) error {
	g.mu.Lock()
	session, authenticated := g.sessions[client]
	g.mu.Unlock()
	if !authenticated {
		if message["type"] == "authenticate" {
			return g.authenticateDevice(client, message, timer)
		}
		if message["type"] == "subscribe-devices" {
			return g.subscribe(client, message, timer)
		}
		return errors.New("authentication required")
	}
	if session.kind == "subscriber" && message["type"] == "app-update" {
		if !session.expires.IsZero() && !time.Now().Before(session.expires) {
			return errors.New("authentication expired")
		}
		g.requestAppUpdate(client, session, message)
		return nil
	}
	if message["type"] == "update-peer-advertise" || message["type"] == "update-peer-find" ||
		message["type"] == "update-peer-done" {
		g.receiveUpdatePeer(client, session, message)
		return nil
	}
	if session.kind == "device" && message["type"] == "app-update-result" {
		g.receiveAppUpdate(client, session, message)
		return nil
	}
	if session.kind == "subscriber" && message["type"] == "remote-command" {
		if !session.expires.IsZero() && !time.Now().Before(session.expires) {
			return errors.New("authentication expired")
		}
		g.requestRemoteCommand(client, session, message)
		return nil
	}
	if session.kind == "device" && message["type"] == "remote-command-result" {
		g.receiveRemoteCommand(client, session, message)
		return nil
	}
	if session.kind != "device" || message["type"] != "switch-result" {
		return nil
	}
	command, _ := message["commandId"].(string)
	g.mu.Lock()
	pending, exists := g.pending[command]
	if !exists || pending.owner != session.owner || pending.device != session.device {
		g.mu.Unlock()
		return nil
	}
	delete(g.pending, command)
	g.mu.Unlock()
	var result error
	if !javascriptTruthy(message["success"]) {
		detail, _ := message["error"].(string)
		if detail == "" {
			detail = "The device command failed"
		}
		result = errors.New(detail)
	}
	pending.result <- result
	return g.service.touch(session.device)
}

func javascriptTruthy(value interface{}) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case float64:
		return typed != 0
	default:
		return true
	}
}

var deviceIDPattern = regexp.MustCompile(
	`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
)

func (g *ControlGateway) authenticateDevice(client *peer, message platform.JSON, timer *time.Timer) error {
	token, _ := message["accessToken"].(string)
	id, _ := message["deviceId"].(string)
	owner, expires, err := g.service.deviceIdentity(token, id)
	if err != nil {
		return err
	}
	client.serviceHost.Store(isServiceCredential(token))
	if !deviceIDPattern.MatchString(id) {
		return errors.New("invalid device id")
	}
	var device *Device
	if client.serviceHost.Load() {
		device, err = g.service.owned(owner, id)
	} else {
		device, err = g.service.register(owner, message)
	}
	if err != nil {
		return err
	}
	if client.closed.Load() {
		return errors.New("connection closed")
	}
	timer.Stop()
	g.mu.Lock()
	previous := g.sockets[owner+":"+id]
	if client.serviceHost.Load() && previous != nil && !previous.closed.Load() && !previous.serviceHost.Load() {
		g.mu.Unlock()
		client.close(4008, "Interactive host is active")
		return nil
	}
	g.sessions[client] = controlSession{owner: owner, device: id, kind: "device"}
	g.sockets[owner+":"+id] = client
	g.mu.Unlock()
	if client.serviceHost.Load() {
		time.AfterFunc(time.Until(expires), func() { client.close(4001, "Service session expired") })
	}
	if previous != nil && previous != client {
		previous.close(4000, "Replaced by a newer connection")
	}
	client.send(platform.JSON{"type": "authenticated", "deviceId": id}, nil)
	g.broadcast(owner, platform.JSON{"type": "device-online", "device": deviceStatus{*device, true}})
	return nil
}

func (g *ControlGateway) subscribe(client *peer, message platform.JSON, timer *time.Timer) error {
	token, _ := message["accessToken"].(string)
	owner, expires, err := socketIdentity(g.service.deps, token)
	if err != nil {
		return err
	}
	timer.Stop()
	g.mu.Lock()
	g.sessions[client] = controlSession{owner: owner, kind: "subscriber", expires: expires}
	if g.subscribers[owner] == nil {
		g.subscribers[owner] = map[*peer]bool{}
	}
	g.subscribers[owner][client] = true
	g.mu.Unlock()
	devices, err := g.statuses(owner)
	if err != nil {
		return err
	}
	client.send(platform.JSON{"type": "devices-snapshot", "devices": devices}, nil)
	return nil
}

func (g *ControlGateway) online(owner, id string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	client := g.sockets[owner+":"+id]
	return client != nil && !client.closed.Load()
}

func (g *ControlGateway) broadcast(owner string, message platform.JSON) {
	g.mu.Lock()
	clients := make([]*peer, 0, len(g.subscribers[owner]))
	for client := range g.subscribers[owner] {
		clients = append(clients, client)
	}
	g.mu.Unlock()
	for _, client := range clients {
		client.send(message, nil)
	}
}

func (g *ControlGateway) command(owner, id string, command platform.JSON) error {
	commandID := uuid.NewString()
	g.mu.Lock()
	client := g.sockets[owner+":"+id]
	if client == nil || client.closed.Load() {
		g.mu.Unlock()
		return errors.New("Device is offline")
	}
	result := make(chan error, 1)
	g.pending[commandID] = pendingCommand{owner, id, result}
	command["commandId"] = commandID
	client.send(command, nil)
	g.mu.Unlock()
	timer := time.NewTimer(25 * time.Second)
	defer timer.Stop()
	defer func() { g.mu.Lock(); delete(g.pending, commandID); g.mu.Unlock() }()
	select {
	case err := <-result:
		return err
	case <-timer.C:
		return errors.New("Timed out while waiting for the device command")
	}
}

func (g *ControlGateway) disconnect(client *peer) {
	g.mu.Lock()
	g.disconnectAppUpdates(client)
	g.disconnectRemoteCommands(client)
	g.updatePeers.disconnect(client)
	session, exists := g.sessions[client]
	delete(g.sessions, client)
	if !exists {
		g.mu.Unlock()
		return
	}
	if session.kind == "subscriber" {
		delete(g.subscribers[session.owner], client)
		if len(g.subscribers[session.owner]) == 0 {
			delete(g.subscribers, session.owner)
		}
		g.mu.Unlock()
		return
	}
	wasCurrent := g.sockets[session.owner+":"+session.device] == client
	if wasCurrent {
		delete(g.sockets, session.owner+":"+session.device)
	}
	for id, pending := range g.pending {
		if pending.owner != session.owner || pending.device != session.device {
			continue
		}
		delete(g.pending, id)
		pending.result <- errors.New("Device disconnected before the command completed")
	}
	g.mu.Unlock()
	if !wasCurrent {
		return
	}
	if err := g.service.touch(session.device); err != nil {
		slog.Warn("device last seen update failed", "error", err)
	}
	g.broadcast(session.owner, platform.JSON{"type": "device-offline", "deviceId": session.device,
		"lastSeenAt": time.Now().UTC()})
}

type deviceStatus struct {
	Device
	Online bool `json:"online"`
}

func (g *ControlGateway) statuses(owner string) ([]deviceStatus, error) {
	devices, err := g.service.list(owner)
	result := make([]deviceStatus, 0, len(devices))
	for _, device := range devices {
		if device.Capabilities == nil {
			device.Capabilities = []string{}
		}
		result = append(result, deviceStatus{device, g.online(owner, device.DeviceID)})
	}
	return result, err
}
