package devices

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/content"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

type hotSession struct {
	id, token, owner, device string
	traffic                  sessionTraffic
	desktop                  chatEndpoint
	mobile                   *chatEndpoint
	expires                  time.Time
	tcp                      bool
	native                   bool
}
type closedSession struct {
	sockets []*peer
	at      time.Time
}
type resumeClaim struct{ id, token string }
type hotJoin struct {
	client   *peer
	identity chatIdentity
	message  platform.JSON
	desktop  chatEndpoint
	ice      []platform.JSON
	tcp      bool
	native   bool
}

// Access is serialized by chatSessions.mu; credentials remain in process memory only.
type hotSessions struct {
	tcpConfig    platform.JSON
	nativeConfig platform.JSON
	limit        float64
	sessions     map[string]*hotSession
	closed       map[string]closedSession
	closedOrder  []string
	onRelay      func(int)
	deliver      func(relayDelivery, platform.JSON)
	desktopICE   func(string, time.Time) []platform.JSON
}

func newHotSessions(relay func(int)) *hotSessions {
	return &hotSessions{limit: content.DefaultChatSessionLimit, sessions: map[string]*hotSession{},
		closed: map[string]closedSession{}, onRelay: relay}
}

func parseResume(value interface{}) (resumeClaim, error) {
	object, ok := value.(map[string]interface{})
	if !ok {
		return resumeClaim{}, errors.New("invalid resume")
	}
	id, err := identifier(object["sessionId"])
	if err != nil {
		return resumeClaim{}, err
	}
	token, err := publicKey(object["resumeToken"])
	return resumeClaim{id, token}, err
}

func (s *hotSessions) count(identity chatIdentity) int {
	count := 0
	for _, session := range s.sessions {
		if session.owned(identity) {
			count++
		}
	}
	return count
}

func (session *hotSession) owned(identity chatIdentity) bool {
	return session.owner == identity.owner && session.device == identity.device
}

func (s *hotSessions) validateClaim(claim resumeClaim, identity chatIdentity) error {
	if _, exists := s.closed[claim.id]; exists {
		return errors.New("closed session")
	}
	if session := s.sessions[claim.id]; session != nil && (!session.owned(identity) || session.token != claim.token) {
		return errors.New("invalid session proof")
	}
	return nil
}

func (s *hotSessions) register(client *peer, identity chatIdentity, input interface{}) error {
	descriptors := []interface{}{}
	if input != nil {
		var ok bool
		descriptors, ok = input.([]interface{})
		if !ok {
			return errors.New("invalid sessions")
		}
	}
	claims, err := s.registrationClaims(identity, descriptors)
	if err != nil {
		return err
	}
	for _, session := range s.sessions {
		if _, retained := claims[session.id]; session.owned(identity) && !retained {
			s.remove(session)
		}
	}
	for _, claim := range claims {
		session := s.sessions[claim.id]
		if session == nil {
			session = &hotSession{
				id:      claim.id,
				token:   claim.token,
				owner:   identity.owner,
				device:  identity.device,
				expires: identity.expires,
			}
			s.sessions[claim.id] = session
		}
		session.desktop = chatEndpoint{client, identity.expires}
		s.ready(session)
	}
	return nil
}

func (s *hotSessions) registrationClaims(identity chatIdentity, descriptors []interface{}) (map[string]resumeClaim, error) {
	claims := map[string]resumeClaim{}
	reconstructing := false
	for _, descriptor := range descriptors {
		claim, err := parseResume(descriptor)
		if err != nil {
			return nil, err
		}
		if _, duplicate := claims[claim.id]; duplicate {
			return nil, errors.New("duplicate sessions")
		}
		if err := s.validateClaim(claim, identity); err != nil {
			return nil, err
		}
		reconstructing = reconstructing || s.sessions[claim.id] == nil
		claims[claim.id] = claim
	}
	// A lower limit must not break existing sessions on reconnect; unknown claims still consume new slots.
	if reconstructing && float64(len(claims)) > s.limit {
		return nil, errors.New("invalid sessions")
	}
	return claims, nil
}

func (s *hotSessions) join(input hotJoin) error {
	if value, resuming := input.message["resume"]; resuming {
		return s.resume(input, value)
	}
	key, err := publicKey(input.message["publicKey"])
	if err != nil {
		return err
	}
	if float64(s.count(input.identity)) >= s.limit {
		input.client.close(4008, "Too many chat connections")
		return nil
	}
	proof := make([]byte, 32)
	if _, err := rand.Read(proof); err != nil {
		return err
	}
	expires := input.identity.expires
	if input.desktop.expires.Before(expires) {
		expires = input.desktop.expires
	}
	session := &hotSession{id: uuid.NewString(), token: hex.EncodeToString(proof), owner: input.identity.owner,
		device: input.identity.device, desktop: input.desktop,
		mobile: &chatEndpoint{input.client, input.identity.expires}, expires: expires}
	s.sessions[session.id] = session
	common := platform.JSON{"sessionId": session.id, "resumeToken": session.token, "transportVersion": 2,
		"iceServers": input.ice, "expiresAt": expires.UnixMilli(), "type": "peer-open", "publicKey": key}
	session.native = s.nativeConfig != nil && input.native && input.message["nativeTraversal"] == true
	if native := s.nativeTraversal(session); native != nil {
		common["nativeTraversal"] = native
	}
	if s.tcpConfig != nil && input.tcp && input.message["tcpPunch"] == true {
		session.tcp = true
		common["tcpPunch"] = s.tcpConfig
	}
	if s.desktopICE != nil {
		common["desktopIceServers"] = s.desktopICE(session.owner, expires)
	}
	input.desktop.socket.send(withChatClientInfo(common, input.message["clientInfo"]), nil)
	delete(common, "publicKey")
	delete(common, "clientInfo")
	common["type"] = "paired"
	input.client.send(common, nil)
	return nil
}

func (s *hotSessions) resume(input hotJoin, value interface{}) error {
	claim, err := parseResume(value)
	if err != nil {
		return err
	}
	if err := s.validateClaim(claim, input.identity); err != nil {
		return err
	}
	session := s.sessions[claim.id]
	if session == nil || session.desktop.socket != input.desktop.socket {
		input.client.close(4004, "Waiting for PC session")
		return nil
	}
	session.tcp = s.tcpConfig != nil && input.tcp && input.message["tcpPunch"] == true
	session.native = session.native && input.native && input.message["nativeTraversal"] == true
	previous := session.mobile
	session.mobile = &chatEndpoint{input.client, input.identity.expires}
	if previous != nil && previous.socket != input.client {
		previous.socket.close(4000, "Connection resumed")
	}
	s.ready(session)
	return nil
}

func (s *hotSessions) ready(session *hotSession) {
	if session.mobile == nil {
		return
	}
	session.expires = session.desktop.expires
	if session.mobile.expires.Before(session.expires) {
		session.expires = session.mobile.expires
	}
	if session.desktop.socket.closed.Load() || session.mobile.socket.closed.Load() {
		return
	}
	message := platform.JSON{"type": "resumed", "sessionId": session.id, "expiresAt": session.expires.UnixMilli()}
	if native := s.nativeTraversal(session); native != nil {
		message["nativeTraversal"] = native
	}
	if session.tcp {
		message["tcpPunch"] = s.tcpConfig
	}
	if s.desktopICE != nil {
		message["desktopIceServers"] = s.desktopICE(session.owner, session.expires)
	}
	session.desktop.socket.send(message, nil)
	session.mobile.socket.send(message, nil)
}

func (s *hotSessions) route(client *peer, message platform.JSON) (bool, error) {
	id, err := identifier(message["sessionId"])
	if err != nil {
		return false, err
	}
	session := s.sessions[id]
	if session == nil {
		for _, socket := range s.closed[id].sockets {
			if socket == client {
				return true, nil
			}
		}
		return false, nil
	}
	if client != session.desktop.socket && (session.mobile == nil || client != session.mobile.socket) {
		return true, errors.New("unknown session")
	}
	if !session.expires.After(time.Now()) {
		s.remove(session)
		return true, nil
	}
	if message["type"] == "diagnostic" {
		client.diagnostics.clientEvent(session.id, message["payload"])
		return true, nil
	}
	target := session.desktop.socket
	if client == target {
		target = nil
		if session.mobile != nil {
			target = session.mobile.socket
		}
	}
	return true, s.forward(session, target, message)
}

func (s *hotSessions) forward(session *hotSession, target *peer, message platform.JSON) error {
	switch message["type"] {
	case "peer-close":
		s.remove(session)
		return nil
	case "signal":
		payload, err := chatSignal(message["payload"])
		if err != nil {
			return err
		}
		if payload["kind"] == "tcp" && !session.tcp {
			return errors.New("TCP paths not negotiated")
		}
		target.send(platform.JSON{"type": "signal", "sessionId": session.id, "payload": payload}, nil)
		return nil
	case "relay", "bulk":
		payload, valid := forwardPayload(message, target)
		if !valid {
			return errors.New("invalid relay")
		}
		frame := platform.JSON{"type": message["type"], "sessionId": session.id, "payload": payload}
		source := session.desktop.socket
		if source == target && session.mobile != nil {
			source = session.mobile.socket
		}
		if s.deliver != nil {
			s.deliver(relayDelivery{session.owner, session.id, source, target, &session.traffic,
				source == session.desktop.socket, session.device}, frame)
		} else {
			target.send(frame, s.onRelay)
		}
		return nil
	default:
		return errors.New("invalid hot standby frame")
	}
}

func (s *hotSessions) disconnect(client *peer, revoke bool) {
	for _, session := range s.sessions {
		if session.desktop.socket != client && (session.mobile == nil || session.mobile.socket != client) {
			continue
		}
		if revoke {
			s.remove(session)
			continue
		}
		target := session.desktop.socket
		if client == target {
			target = nil
			if session.mobile != nil {
				target = session.mobile.socket
			}
		}
		target.send(platform.JSON{"type": "peer-offline", "sessionId": session.id}, nil)
	}
}

func (s *hotSessions) prune() {
	for _, session := range s.sessions {
		if !session.expires.After(time.Now()) {
			s.remove(session)
		}
	}
	for len(s.closedOrder) > 0 {
		id := s.closedOrder[0]
		if time.Since(s.closed[id].at) <= time.Minute {
			break
		}
		delete(s.closed, id)
		s.closedOrder = s.closedOrder[1:]
	}
}

func (s *hotSessions) remove(session *hotSession) {
	delete(s.sessions, session.id)
	sockets := []*peer{session.desktop.socket}
	if session.mobile != nil {
		sockets = append(sockets, session.mobile.socket)
	}
	s.closed[session.id] = closedSession{sockets, time.Now()}
	s.closedOrder = append(s.closedOrder, session.id)
	if len(s.closedOrder) > 1024 {
		delete(s.closed, s.closedOrder[0])
		s.closedOrder = s.closedOrder[1:]
	}
	for _, socket := range sockets {
		socket.send(platform.JSON{"type": "peer-close", "sessionId": session.id}, nil)
	}
}
