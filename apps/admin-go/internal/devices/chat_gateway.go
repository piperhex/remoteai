package devices

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/content"
	"github.com/codex-switch/admin-go/internal/mediarelay"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type chatConnection struct {
	identity      *chatIdentity
	bytes, frames int
	windowStart   time.Time
	timer         *time.Timer
}
type ChatGateway struct {
	bulkMeter   *chattraffic.BulkMeter
	meter       *chattraffic.Meter
	service     *Service
	sessions    *chatSessions
	traffic     *trafficCounter
	mu          sync.Mutex
	policyMu    sync.Mutex
	connections map[*peer]*chatConnection
	policy      platform.JSON
	ice         []platform.JSON
	done        chan struct{}
	stopped     chan struct{}
	stun        *stunServer
	tcp         *tcpPunchServer
	media       *mediarelay.Proxy
}

func newChatGateway(service *Service) (*ChatGateway, error) {
	ice, err := iceServers(service.deps.Config)
	if err != nil {
		return nil, err
	}
	native, err := nativeTraversalConfig(service.deps.Config)
	if err != nil {
		return nil, err
	}
	stun, err := startSTUN(service.deps.Config)
	if err != nil {
		return nil, err
	}
	traffic := newTrafficCounter(service.deps.DB)
	gateway := &ChatGateway{service: service, sessions: newChatSessions(traffic.record), traffic: traffic,
		meter:       chattraffic.NewMeter(service.deps.DB, service.deps.Redis),
		connections: map[*peer]*chatConnection{}, policy: platform.JSON{"relayMaxMbPerSecond": float64(-1),
			"relayMaxFramesPerSecond": float64(
				-1,
			)}, ice: ice, done: make(chan struct{}), stopped: make(chan struct{}), stun: stun}
	service.deps.FlushTraffic = traffic.flush
	if service.deps.Config.Get("CHAT_BULK_LEASES_ENABLED", "false") == "true" {
		gateway.bulkMeter = chattraffic.NewBulkMeter(gateway.meter)
	}
	service.deps.ReadBandwidth = traffic.bandwidth.Snapshot
	gateway.sessions.deliver = gateway.deliverRelay
	gateway.sessions.hot.deliver = gateway.deliverRelay
	gateway.sessions.hot.nativeConfig = native
	service.deps.ChatPolicyChanged = gateway.refreshPolicy
	if err := gateway.startMediaRelay(); err != nil {
		if stun != nil {
			stun.close()
		}
		return nil, err
	}
	if err := gateway.startTCPPunch(); err != nil {
		if stun != nil {
			stun.close()
		}
		gateway.media.Close()
		return nil, err
	}
	go gateway.maintain()
	return gateway, nil
}

func (g *ChatGateway) serve(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(chatFrameLimit)
	client := newPeerWithDiagnostics(conn, newChatDiagnostics())
	state := &chatConnection{windowStart: time.Now()}
	state.timer = time.AfterFunc(authTimeout, func() { client.close(4001, "Authentication timed out") })
	g.mu.Lock()
	g.connections[client] = state
	g.mu.Unlock()
	defer g.disconnect(client)
	for {
		kind, reader, err := conn.NextReader()
		var data []byte
		if err == nil {
			data, err = readChatPayload(client, kind, reader)
		}
		if err != nil {
			code := websocket.CloseAbnormalClosure
			var closed *websocket.CloseError
			if errors.As(err, &closed) {
				code = closed.Code
			}
			client.diagnostics.close(code, "socket read ended")
			return
		}
		client.diagnostics.received(len(data))
		message, err := readChatFrame(client, kind, data)
		if err == nil {
			err = g.receive(client, state, message, len(data))
		}
		if err != nil {
			client.diagnostics.log("chat rejected", "reason", chatRejectionReason(err))
			g.reject(client)
			return
		}
	}
}

func (g *ChatGateway) receive(client *peer, state *chatConnection, message platform.JSON, size int) error {
	// Diagnostic frames have their own bounded budget; telemetry must not consume the relay allowance.
	if message["type"] == "diagnostic" && state.identity != nil && state.identity.expires.After(time.Now()) {
		if size > maxClientDiagnosticBytes {
			return nil
		}
		return g.sessions.route(client, message)
	}
	if err := g.checkRate(state, size); err != nil {
		return err
	}
	if state.identity != nil {
		if !state.identity.expires.After(time.Now()) {
			return errors.New("expired token")
		}
		return g.sessions.route(client, message)
	}
	identity, err := g.authenticate(message)
	if err != nil {
		return err
	}
	client.diagnostics.authenticated(identity, message)
	token, _ := message["accessToken"].(string)
	client.serviceHost.Store(isServiceCredential(token))
	client.binaryRelay.Store(message["binaryRelay"] == true)
	client.binaryBulk.Store(message["fileBulkV1"] == true && client.binaryRelay.Load())
	// Serialize handshake snapshots with saved-policy broadcasts so stale reads cannot follow a new policy.
	g.policyMu.Lock()
	defer g.policyMu.Unlock()
	policy, err := content.ReadChatPolicy(g.service.deps.DB)
	if err != nil {
		return err
	}
	g.mu.Lock()
	if client.closed.Load() {
		g.mu.Unlock()
		return errors.New("closed connection")
	}
	g.policy = policy
	state.identity = &identity
	state.timer.Stop()
	state.timer = time.AfterFunc(time.Until(identity.expires), func() {
		g.sessions.disconnect(client, true)
		client.close(4001, "Session expired")
	})
	g.mu.Unlock()
	sendChatPolicy(client, policy)
	g.sessions.setLimit(policy["chatSessionLimit"].(float64))
	return g.sessions.join(client, identity, message, g.ice)
}

func (g *ChatGateway) authenticate(message platform.JSON) (chatIdentity, error) {
	identity := chatIdentity{}
	token, ok := message["accessToken"].(string)
	if !ok || len(token) > 8192 || message["type"] != "authenticate" {
		return identity, errors.New("invalid authentication")
	}
	role, _ := message["role"].(string)
	if role != "desktop" && role != "mobile" {
		return identity, errors.New("invalid role")
	}
	id, err := identifier(message["deviceId"])
	if err != nil {
		return identity, err
	}
	if role == "mobile" && isServiceCredential(token) {
		return identity, errors.New("service cannot act as viewer")
	}
	owner, expires, err := g.service.deviceIdentity(token, id)
	if err != nil || !expires.After(time.Now()) {
		return identity, errors.New("expired token")
	}
	if _, err := g.service.owned(owner, id); err != nil {
		return identity, err
	}
	return chatIdentity{owner, id, role, expires}, nil
}

func (g *ChatGateway) checkRate(state *chatConnection, size int) error {
	if time.Since(state.windowStart) >= time.Second {
		state.bytes, state.frames, state.windowStart = 0, 0, time.Now()
	}
	state.bytes += size
	state.frames++
	g.mu.Lock()
	megabytes, frames := policyNumber(
		g.policy["relayMaxMbPerSecond"],
	), policyNumber(
		g.policy["relayMaxFramesPerSecond"],
	)
	g.mu.Unlock()
	if (megabytes != -1 && float64(state.bytes)/(1024*1024) > megabytes) ||
		(frames != -1 && float64(state.frames) > frames) {
		return errors.New("rate exceeded")
	}
	return nil
}

func policyNumber(value interface{}) float64 {
	switch value := value.(type) {
	case float64:
		return value
	case int:
		return float64(value)
	default:
		return -1
	}
}

func (g *ChatGateway) reject(client *peer) {
	g.sessions.disconnect(client, true)
	client.close(4001, "Chat connection rejected")
}

func (g *ChatGateway) disconnect(client *peer) {
	g.mu.Lock()
	if state := g.connections[client]; state != nil {
		state.timer.Stop()
	}
	delete(g.connections, client)
	g.mu.Unlock()
	client.terminate()
	g.sessions.disconnect(client, false)
}

func (g *ChatGateway) maintain() {
	defer close(g.stopped)
	timer := time.NewTicker(5 * time.Second)
	defer timer.Stop()
	credentials := time.NewTicker(desktopCredentialLifetime / 2)
	defer credentials.Stop()
	for {
		select {
		case <-g.done:
			return
		case <-credentials.C:
			g.refreshDesktopICE()
		case <-timer.C:
			g.sessions.prune()
			if g.bulkMeter != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				if err := g.bulkMeter.ReconcileExpired(ctx); err != nil {
					slog.Warn("bulk lease reconciliation will be retried", "error", err)
				}
				cancel()
			}
			if err := g.meter.Flush(); err != nil {
				slog.Warn("relay accounting settlement will be retried", "error", err)
			}
			g.publishTraffic()
			g.refreshPolicy()
			if err := g.traffic.flush(); err != nil {
				slog.Warn("chat traffic flush will be retried", "error", err)
			}
		}
	}
}

func (g *ChatGateway) refreshPolicy() {
	g.policyMu.Lock()
	defer g.policyMu.Unlock()
	g.mu.Lock()
	active := len(g.connections) > 0
	g.mu.Unlock()
	if !active {
		return
	}
	policy, err := content.ReadChatPolicy(g.service.deps.DB)
	if err != nil {
		slog.Warn("chat policy refresh will be retried", "error", err)
		return
	} // Keep the last confirmed policy during a database outage.
	g.sessions.setLimit(policy["chatSessionLimit"].(float64))
	g.mu.Lock()
	defer g.mu.Unlock()
	g.policy = policy
	for client, state := range g.connections {
		if state.identity != nil && state.identity.expires.After(time.Now()) {
			sendChatPolicy(client, policy)
		}
	}
}

func sendChatPolicy(client *peer, policy map[string]interface{}) {
	// Refreshes must preserve negotiated capabilities, independently of the live download policy switch.
	client.send(platform.JSON{"type": "chat-policy", "policy": policy,
		"binaryRelay": client.binaryRelay.Load(), "fileBulkV1": client.binaryBulk.Load(), "connectionDiagnostics": 1}, nil)
}

type Runtime struct {
	stopPush func()
	control  *ControlGateway
	chat     *ChatGateway
}

func (runtime *Runtime) Close() error {
	if runtime.stopPush != nil {
		runtime.stopPush()
	}
	runtime.control.mu.Lock()
	for client := range runtime.control.sessions {
		client.close(1001, "Server shutting down")
	}
	runtime.control.mu.Unlock()
	g := runtime.chat
	g.media.Close()
	g.tcp.close()
	close(g.done)
	<-g.stopped
	g.mu.Lock()
	for client, state := range g.connections {
		state.timer.Stop()
		client.close(1001, "Server shutting down")
	}
	g.mu.Unlock()
	if g.stun != nil {
		g.stun.close()
	}
	return errors.Join(g.meter.Close(), g.traffic.flush())
}
