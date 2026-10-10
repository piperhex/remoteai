package devices

import (
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func optionalAssistanceID(id string) interface{} {
	if id == "" {
		return nil
	}
	return id
}

func (s *chatSessions) authenticateAssistance(
	owner, device string, expires time.Time, message platform.JSON,
) (chatIdentity, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, _ := message["assistanceId"].(string)
	helperDevice, _ := message["assistingDeviceId"].(string)
	r := s.assistance[id]
	if r == nil || r.HelperOwner != owner || r.HelperDeviceID != helperDevice || r.HostDeviceID != device ||
		r.State != assistanceAccepted || !r.ExpiresAt.After(time.Now()) ||
		!s.assistanceOnline(owner, helperDevice) || !s.assistanceOnline(r.HostOwner, device) {
		return chatIdentity{}, errors.New("assistance unavailable")
	}
	if r.ExpiresAt.Before(expires) {
		expires = r.ExpiresAt
	}
	return chatIdentity{r.HostOwner, device, "mobile", expires}, nil
}

// Recheck under the pairing lock: cancellation between authentication and joining must win.
func (s *chatSessions) validateAssistanceJoin(identity chatIdentity, message platform.JSON) error {
	id, _ := message["assistanceId"].(string)
	if id == "" {
		return nil
	}
	r := s.assistance[id]
	if r == nil || r.HostOwner != identity.owner || r.HostDeviceID != identity.device ||
		r.State != assistanceAccepted || !r.ExpiresAt.After(time.Now()) || message["transportVersion"] != float64(2) ||
		!s.assistanceOnline(r.HostOwner, r.HostDeviceID) || !s.assistanceOnline(r.HelperOwner, r.HelperDeviceID) {
		return errors.New("assistance unavailable")
	}
	if _, resuming := message["resume"]; resuming {
		return nil
	}
	for _, session := range s.hot.sessions {
		if session.assistanceID == id {
			return errors.New("assistance already connected")
		}
	}
	return nil
}
