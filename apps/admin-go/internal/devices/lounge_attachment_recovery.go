package devices

import (
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const attachmentSearchTimeout = 5 * time.Second

type attachmentSearch struct {
	client     *peer
	request    platform.JSON
	ice        []platform.JSON
	candidates map[*peer]bool
	timer      *time.Timer
}

// Only sockets belonging to the verified grant's sender may supply a cached image.
// Caller holds mu. No message content or cache inventory is broadcast.
func (s *chatSessions) findAttachment(client *peer, request platform.JSON, ice []platform.JSON) bool {
	candidates := map[*peer]bool{}
	for source, info := range s.lounge {
		if source != client && info.recovery && info.identity.owner == request["owner"] &&
			!source.closed.Load() && info.identity.expires.After(time.Now()) && s.attachmentCount(source) < maxLoungeDevices {
			candidates[source] = true
		}
	}
	if len(candidates) == 0 {
		return false
	}
	id := uuid.NewString()
	search := &attachmentSearch{client: client, request: request, ice: ice, candidates: candidates}
	s.attachments[id] = search
	search.timer = time.AfterFunc(attachmentSearchTimeout, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.finishAttachmentSearch(id, true)
	})
	for source := range candidates {
		source.send(platform.JSON{"type": "attachment-locate", "id": id, "fileId": request["fileId"]}, nil)
	}
	return true
}

func (s *chatSessions) attachmentAvailable(source *peer, frame platform.JSON) error {
	id, err := identifier(frame["id"])
	available, ok := frame["available"].(bool)
	if err != nil || !ok {
		return errors.New("invalid attachment availability")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	search := s.attachments[id]
	if search == nil || !search.candidates[source] {
		return nil
	}
	delete(search.candidates, source)
	info, viewer := s.lounge[source], s.lounge[search.client]
	if available && !source.closed.Load() && info.identity.expires.After(time.Now()) &&
		!search.client.closed.Load() && viewer.identity.expires.After(time.Now()) &&
		s.attachmentCount(source) < maxLoungeDevices {
		s.finishAttachmentSearch(id, false)
		s.pairAttachmentSource(search.client, source, search.request, search.ice)
	} else if len(search.candidates) == 0 {
		s.finishAttachmentSearch(id, true)
	}
	return nil
}

// Caller holds mu. Late availability replies cannot revive a completed request.
func (s *chatSessions) finishAttachmentSearch(id string, unavailable bool) {
	search := s.attachments[id]
	if search == nil {
		return
	}
	search.timer.Stop()
	delete(s.attachments, id)
	if unavailable {
		search.client.send(platform.JSON{"type": "attachment-unavailable", "id": search.request["id"]}, nil)
	}
}

func (s *chatSessions) cancelAttachmentSearches(client *peer) {
	for id, search := range s.attachments {
		delete(search.candidates, client)
		if search.client == client {
			s.finishAttachmentSearch(id, false)
		} else if len(search.candidates) == 0 {
			s.finishAttachmentSearch(id, true)
		}
	}
}
