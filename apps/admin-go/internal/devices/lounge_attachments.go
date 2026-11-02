package devices

import (
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

// Grants pair recipients with attachment sockets, never history or computer-control endpoints.
func (g *ChatGateway) connectAttachment(client *peer, identity chatIdentity, frame platform.JSON) error {
	request, err := identifier(frame["id"])
	grant, ok := frame["grant"].(string)
	if err != nil || !ok || len(grant) > 8192 || g.service.deps.LoungeAttachment == nil {
		return errors.New("invalid attachment request")
	}
	owner, device, fileID, err := g.service.deps.LoungeAttachment(grant, identity.owner)
	if err != nil {
		client.send(platform.JSON{"type": "attachment-unavailable", "id": request}, nil)
		return nil
	}
	return g.sessions.pairAttachment(client, platform.JSON{"id": request, "owner": owner, "device": device, "fileId": fileID}, g.ice)
}

func (s *chatSessions) pairAttachment(client *peer, request platform.JSON, ice []platform.JSON) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	viewer, ok := s.lounge[client]
	if !ok || !viewer.attachments {
		return errors.New("invalid attachment client")
	}
	if s.attachmentCount(client) >= maxLoungeDevices {
		client.send(platform.JSON{"type": "attachment-unavailable", "id": request["id"]}, nil)
		return nil
	}
	for source, info := range s.lounge {
		if source == client || !info.attachments || info.identity.owner != request["owner"] ||
			info.identity.device != request["device"] || source.closed.Load() || !info.identity.expires.After(time.Now()) {
			continue
		}
		// Older clients only serve their original in-memory device; new clients confirm cached availability.
		if !info.recovery && s.attachmentCount(source) < maxLoungeDevices {
			s.pairAttachmentSource(client, source, request, ice)
			return nil
		}
	}
	if s.findAttachment(client, request, ice) {
		return nil
	}
	client.send(platform.JSON{"type": "attachment-unavailable", "id": request["id"]}, nil)
	return nil
}

// Caller holds mu and has verified both peers and the signed attachment request.
func (s *chatSessions) pairAttachmentSource(client, source *peer, request platform.JSON, ice []platform.JSON) {
	viewer, info := s.lounge[client], s.lounge[source]
	id := uuid.NewString()
	s.sessions[id] = &chatSession{id: id, owner: viewer.identity.owner, desktop: source, mobile: client,
		started: time.Now(), relay: true}
	expires := minExpiry(info.identity.expires, viewer.identity.expires)
	send := func(target *peer, key string, desktop bool) {
		frame := loungePair(id, key, desktop, loungePairOptions{expires, ice})
		frame["type"], frame["id"] = "attachment-peer", request["id"]
		frame["viewer"], frame["fileId"] = viewer.identity.owner, request["fileId"]
		target.send(frame, nil)
	}
	send(source, viewer.key, true)
	send(client, info.key, false)
}

func (s *chatSessions) attachmentCount(client *peer) int {
	count := 0
	for _, session := range s.sessions {
		if session.mobile == client || session.desktop == client {
			count++
		}
	}
	for _, search := range s.attachments {
		if search.client == client || search.candidates[client] {
			count++
		}
	}
	return count
}
