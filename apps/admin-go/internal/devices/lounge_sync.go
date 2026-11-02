package devices

import (
	"context"
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const maxLoungeDevices = 16
const maxHistoryPeers = 50

type loungePeer struct {
	identity    chatIdentity
	key         string
	attachments bool
	recovery    bool
}

// A lounge ticket grants only same-account history pairing, never control of a registered computer.
func (g *ChatGateway) authenticateLounge(ticket string, message platform.JSON) (chatIdentity, error) {
	verify := g.service.deps.LoungeIdentity
	id, err := identifier(message["deviceId"])
	if err != nil || verify == nil || message["transportVersion"] != float64(2) {
		return chatIdentity{}, errors.New("invalid lounge identity")
	}
	owner, expires, err := verify(ticket)
	if err != nil || owner == "" || !expires.After(time.Now()) {
		return chatIdentity{}, errors.New("invalid lounge ticket")
	}
	return chatIdentity{owner, id, "lounge", expires}, nil
}

// Caller holds chatSessions.mu. Reuse the existing encrypted relay, accounting and socket budgets.
func (s *chatSessions) joinLounge(client *peer, identity chatIdentity, message platform.JSON, ice []platform.JSON) error {
	key, err := publicKey(message["publicKey"])
	if err != nil {
		return err
	}
	others := make(map[*peer]loungePeer)
	for socket, info := range s.lounge {
		if info.identity.owner == identity.owner && !socket.closed.Load() && info.identity.expires.After(time.Now()) {
			others[socket] = info
		}
	}
	if len(others) >= maxLoungeDevices {
		return errors.New("too many lounge devices")
	}
	attachments := message["purpose"] == "attachments"
	s.lounge[client] = loungePeer{identity: identity, key: key, attachments: attachments,
		recovery: attachments && message["attachmentRecovery"] == true}
	client.send(platform.JSON{"type": "sync-registered", "expiresAt": identity.expires.UnixMilli()}, nil)
	for other, info := range others {
		if attachments || info.attachments {
			continue
		}
		id := uuid.NewString()
		s.sessions[id] = &chatSession{id: id, owner: identity.owner, desktop: other, mobile: client,
			started: time.Now(), relay: true}
		expires := minExpiry(identity.expires, info.identity.expires)
		other.send(loungePair(id, key, true, loungePairOptions{expires, ice}), nil)
		client.send(loungePair(id, info.key, false, loungePairOptions{expires, ice}), nil)
	}
	return nil
}

type loungePairOptions struct {
	expires time.Time
	ice     []platform.JSON
}

func loungePair(id, key string, desktop bool, options loungePairOptions) platform.JSON {
	return platform.JSON{"type": "sync-peer", "sessionId": id, "publicKey": key, "desktop": desktop,
		"iceServers": options.ice, "expiresAt": options.expires.UnixMilli()}
}

func minExpiry(first, second time.Time) time.Time {
	if first.Before(second) {
		return first
	}
	return second
}

func (s *chatSessions) renewLounge(client *peer, identity chatIdentity) {
	info, exists := s.lounge[client]
	if !exists {
		return
	}
	info.identity = identity
	s.lounge[client] = info
	for _, session := range s.sessions {
		if session.desktop != client && session.mobile != client {
			continue
		}
		expires := minExpiry(s.lounge[session.desktop].identity.expires, s.lounge[session.mobile].identity.expires)
		frame := platform.JSON{"type": "sync-lease", "sessionId": session.id, "expiresAt": expires.UnixMilli()}
		session.desktop.send(frame, nil)
		session.mobile.send(frame, nil)
	}
}

// The current deletion generation is authoritative even when the source device has been offline.
func (g *ChatGateway) loungeGenerations(client *peer, identity chatIdentity, message platform.JSON) error {
	id, err := identifier(message["id"])
	input, valid := message["peers"].([]interface{})
	if err != nil || !valid || len(input) > maxHistoryPeers || g.service.deps.LoungeGenerations == nil {
		return errors.New("invalid history access")
	}
	peers := make([]string, 0, len(input))
	for _, value := range input {
		id, ok := value.(string)
		parsed, err := uuid.Parse(id)
		if !ok || err != nil || parsed.String() != id {
			return errors.New("invalid history peer")
		}
		peers = append(peers, id)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	generations, err := g.service.deps.LoungeGenerations(ctx, identity.owner, peers)
	if err != nil {
		generations = nil
	}
	client.send(platform.JSON{"type": "history-generations", "id": id, "generations": generations,
		"error": err != nil}, nil)
	return nil
}
