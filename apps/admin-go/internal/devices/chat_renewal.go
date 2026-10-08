package devices

import (
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

// Renewal keeps the authenticated socket and its session proofs; identity changes require a new login.
func (g *ChatGateway) renewAuthentication(client *peer, state *chatConnection, message platform.JSON) error {
	previous := state.identity
	identity, err := g.authenticate(platform.JSON{"type": "authenticate", "role": previous.role,
		"deviceId": previous.device, "accessToken": message["accessToken"]})
	if err != nil {
		return err
	}
	token, _ := message["accessToken"].(string)
	if !sameChatIdentity(*previous, identity) || isServiceCredential(token) != client.serviceHost.Load() {
		return errors.New("invalid authentication")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if client.closed.Load() || !previous.expires.After(time.Now()) {
		return errors.New("expired token")
	}
	g.setAuthentication(client, state, identity)
	g.sessions.renew(client, identity)
	client.send(platform.JSON{"type": "auth-renewed", "expiresAt": identity.expires.UnixMilli()}, nil)
	return nil
}

func sameChatIdentity(previous, next chatIdentity) bool {
	return previous.owner == next.owner && previous.device == next.device && previous.role == next.role
}

// Caller holds g.mu. An already queued old deadline must not revoke a freshly renewed identity.
func (g *ChatGateway) setAuthentication(client *peer, state *chatConnection, identity chatIdentity) {
	state.identity = &identity
	state.timer.Stop()
	state.timer = time.AfterFunc(time.Until(identity.expires), func() { g.expireAuthentication(client, state, &identity) })
}

func (g *ChatGateway) expireAuthentication(client *peer, state *chatConnection, expected *chatIdentity) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if state.identity != expected || client.closed.Load() {
		return
	}
	g.sessions.disconnect(client, true)
	client.close(4001, "Session expired")
}

func (s *chatSessions) renew(client *peer, identity chatIdentity) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if info, exists := s.info[client]; exists {
		info.expires = identity.expires
		s.info[client] = info
	}
	for _, session := range s.hot.sessions {
		if !session.owned(identity) || !session.expires.After(time.Now()) {
			continue
		}
		if session.desktop.socket == client {
			session.desktop.expires = identity.expires
		} else if session.mobile != nil && session.mobile.socket == client {
			session.mobile.expires = identity.expires
		} else {
			continue
		}
		s.hot.notifyReady(session, true)
	}
}
