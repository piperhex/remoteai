package devices

import (
	"errors"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

type desktopInfo struct {
	expires    time.Time
	version    float64
	tcp        bool
	native     bool
	assistance bool
}
type chatSessions struct {
	mu         sync.Mutex
	desktops   map[string]*peer
	info       map[*peer]desktopInfo
	sessions   map[string]*chatSession
	hot        *hotSessions
	onRelay    func(int)
	deliver    func(relayDelivery, platform.JSON)
	desktopICE func(string, time.Time) []platform.JSON
	assistance map[string]*assistanceRequest
}

func newChatSessions(relay func(int)) *chatSessions {
	return &chatSessions{desktops: map[string]*peer{}, info: map[*peer]desktopInfo{},
		sessions: map[string]*chatSession{}, hot: newHotSessions(relay), onRelay: relay,
		assistance: map[string]*assistanceRequest{}}
}

func (s *chatSessions) setLimit(limit float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hot.limit = limit
}

func (s *chatSessions) join(client *peer, identity chatIdentity, message platform.JSON, ice []platform.JSON) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hot.prune()
	key := identity.owner + ":" + identity.device
	version := desktopTransportVersion(message["transportVersion"])
	if identity.role == "desktop" {
		if previous := s.desktops[key]; client.serviceHost.Load() && previous != nil &&
			!previous.closed.Load() && !previous.serviceHost.Load() {
			client.close(4008, "Interactive host is active")
			return nil
		}
		var descriptors interface{}
		if message["transportVersion"] == float64(2) {
			var present bool
			descriptors, present = message["sessions"]
			if present && descriptors == nil {
				return errors.New("invalid sessions")
			}
		}
		if err := s.hot.register(client, identity, descriptors); err != nil {
			return err
		}
		s.info[client] = desktopInfo{identity.expires, version,
			message["tcpPunch"] == true, message["nativeTraversal"] == true, message["remoteAssistance"] == true}
		if previous := s.desktops[key]; previous != nil && previous != client {
			s.disconnectLocked(previous, false)
			previous.close(4000, "Replaced by a newer connection")
		}
		s.desktops[key] = client
		client.send(platform.JSON{"type": "registered"}, nil)
		return nil
	}
	return s.joinMobile(client, identity, message, ice)
}

func (s *chatSessions) joinMobile(
	client *peer,
	identity chatIdentity,
	message platform.JSON,
	ice []platform.JSON,
) error {
	desktop := s.desktops[identity.owner+":"+identity.device]
	if desktop == nil || desktop.closed.Load() {
		client.close(4004, "PC chat is offline")
		return nil
	}
	count := s.hot.count(identity)
	for _, session := range s.sessions {
		if session.desktop == desktop {
			count++
		}
	}
	_, resuming := message["resume"]
	if !resuming && float64(count) >= s.hot.limit {
		client.close(4008, "Too many chat connections")
		return nil
	}
	info := s.info[desktop]
	if err := s.validateAssistanceJoin(identity, message); err != nil {
		return err
	}
	if message["transportVersion"] == float64(2) && info.version == 2 {
		return s.hot.join(hotJoin{client, identity, message,
			chatEndpoint{desktop, info.expires}, ice, info.tcp, info.native})
	}
	if resuming {
		client.close(4004, "Session unavailable")
		return nil
	}
	key, err := publicKey(message["publicKey"])
	if err != nil {
		return err
	}
	id := uuid.NewString()
	s.sessions[id] = &chatSession{id: id, owner: identity.owner, desktop: desktop, mobile: client, started: time.Now()}
	expires := identity.expires
	if info.expires.Before(expires) {
		expires = info.expires
	}
	frame := platform.JSON{"type": "peer-open", "sessionId": id, "publicKey": key, "iceServers": ice,
		"expiresAt": expires.UnixMilli()}
	if s.desktopICE != nil {
		frame["desktopIceServers"] = s.desktopICE(identity.owner, identity.expires)
	}
	desktop.send(withChatClientInfo(frame, message["clientInfo"]), nil)
	client.send(
		platform.JSON{
			"type":            "paired",
			"sessionId":       id,
			"iceServers":      ice,
			"directTimeoutMs": directConnectTimeout.Milliseconds(),
		},
		nil,
	)
	return nil
}

func (s *chatSessions) route(client *peer, message platform.JSON) error {
	s.mu.Lock()
	handled, deliver, err := s.hot.prepareRoute(client, message)
	if !handled && err == nil {
		err = s.routeLegacy(client, message)
	}
	s.mu.Unlock()
	// A slow download must never hold the routing lock shared by all accounts and control frames.
	if err == nil && deliver != nil {
		deliver()
	}
	return err
}

func (s *chatSessions) routeLegacy(client *peer, message platform.JSON) error {
	id, err := identifier(message["sessionId"])
	if err != nil {
		return err
	}
	session := s.sessions[id]
	if session == nil || (session.desktop != client && session.mobile != client) {
		return errors.New("unknown session")
	}
	target := session.desktop
	if client == session.desktop {
		target = session.mobile
	}
	switch message["type"] {
	case "signal":
		payload, err := chatSignal(message["payload"])
		if err != nil {
			return err
		}
		target.send(platform.JSON{"type": "signal", "sessionId": id, "payload": payload}, nil)
	case "relay-request":
		return s.enableRelay(session, message)
	case "relay":
		payload, valid := relayPayload(message["payload"])
		if !session.relay || !valid {
			return errors.New("invalid relay")
		}
		frame := platform.JSON{"type": "relay", "sessionId": id, "payload": payload}
		if s.deliver != nil {
			s.deliver(relayDelivery{session.owner, id, client, target, &session.traffic, client == session.desktop, ""}, frame)
		} else {
			target.send(frame, s.onRelay)
		}
	case "peer-close":
		delete(s.sessions, id)
		target.send(platform.JSON{"type": "peer-close", "sessionId": id}, nil)
	default:
		return errors.New("invalid chat frame")
	}
	return nil
}

func (s *chatSessions) enableRelay(session *chatSession, message platform.JSON) error {
	if !session.relay && message["reason"] != "disconnected" && time.Since(session.started) < directConnectTimeout {
		return errors.New("direct attempt still pending")
	}
	session.relay = true
	frame := platform.JSON{"type": "relay-ready", "sessionId": session.id}
	session.desktop.send(frame, nil)
	session.mobile.send(frame, nil)
	return nil
}

func (s *chatSessions) disconnect(client *peer, revoke bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.disconnectLocked(client, revoke)
}

func (s *chatSessions) disconnectLocked(client *peer, revoke bool) {
	s.hot.disconnect(client, revoke)
	delete(s.info, client)
	for key, desktop := range s.desktops {
		if desktop == client {
			delete(s.desktops, key)
		}
	}
	for id, session := range s.sessions {
		if session.desktop != client && session.mobile != client {
			continue
		}
		delete(s.sessions, id)
		target := session.desktop
		if target == client {
			target = session.mobile
		}
		target.send(platform.JSON{"type": "peer-close", "sessionId": id}, nil)
	}
}

func (s *chatSessions) prune() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hot.prune()
	s.pruneAssistance()
}
