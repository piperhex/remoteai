package devices

import (
	"sort"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const (
	assistancePendingLifetime = 5 * time.Minute
	assistanceActiveLifetime  = 2 * time.Hour
	assistanceRetention       = 5 * time.Minute
	assistanceRequestInterval = 10 * time.Second
	assistanceInboxLimit      = 10
	assistanceStoreLimit      = 10000
)

type assistanceState string

const (
	assistancePending  assistanceState = "pending"
	assistanceAccepted assistanceState = "accepted"
	assistanceDeclined assistanceState = "declined"
	assistanceEnded    assistanceState = "ended"
	assistanceExpired  assistanceState = "expired"
)

// Invitations live alongside the coordinator's sessions. Restarting never restores a grant.
type assistanceRequest struct {
	ID             string          `json:"id"`
	HostDeviceID   string          `json:"hostDeviceId"`
	HostName       string          `json:"hostName"`
	HostEmail      string          `json:"hostEmail"`
	HelperEmail    string          `json:"helperEmail"`
	HelperDeviceID string          `json:"helperDeviceId,omitempty"`
	State          assistanceState `json:"state"`
	ExpiresAt      time.Time       `json:"expiresAt"`
	HostOwner      string          `json:"-"`
	HelperOwner    string          `json:"-"`
	CreatedAt      time.Time       `json:"-"`
	FinishedAt     time.Time       `json:"-"`
}

func (r assistanceRequest) active() bool {
	return r.State == assistancePending || r.State == assistanceAccepted
}

func (r assistanceRequest) visible(owner, device string) bool {
	return r.HostOwner == owner && r.HostDeviceID == device ||
		r.HelperOwner == owner && (r.HelperDeviceID == "" || r.HelperDeviceID == device)
}

// Caller holds chatSessions.mu. Service-only hosts cannot receive or grant assistance.
func (s *chatSessions) assistanceOnline(owner, device string) bool {
	for key, client := range s.desktops {
		if device != "" && key != owner+":"+device || !strings.HasPrefix(key, owner+":") {
			continue
		}
		info := s.info[client]
		if !client.closed.Load() && !client.serviceHost.Load() && info.assistance && info.version == 2 &&
			info.expires.After(time.Now()) {
			return true
		}
	}
	return false
}

func (s *chatSessions) createAssistance(input assistanceRequest) (assistanceRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneAssistance()
	if !s.assistanceOnline(input.HostOwner, input.HostDeviceID) {
		return input, platform.NewError(409, "请保持本机登录，并更新到支持远程协助的版本。")
	}
	if err := s.assistanceCapacity(input); err != nil {
		return input, err
	}
	// Recipient availability and inbox capacity never change the sender's response.
	if s.assistanceInboxFull(input.HelperOwner) {
		input.HelperOwner = ""
	}
	input.ID, input.State, input.CreatedAt = uuid.NewString(), assistancePending, time.Now()
	input.ExpiresAt = input.CreatedAt.Add(assistancePendingLifetime)
	s.assistance[input.ID] = &input
	return input, nil
}

func (s *chatSessions) assistanceCapacity(input assistanceRequest) error {
	for _, request := range s.assistance {
		if request.HostOwner != input.HostOwner {
			continue
		}
		if time.Since(request.CreatedAt) < assistanceRequestInterval {
			return platform.NewError(429, "邀请发送过于频繁，请稍后再试。")
		}
		if request.HostDeviceID == input.HostDeviceID && request.active() {
			return platform.NewError(409, "请先结束当前协助或取消邀请。")
		}
	}
	if len(s.assistance) >= assistanceStoreLimit {
		return platform.NewError(429, "暂时无法发送邀请，请稍后再试。")
	}
	return nil
}

func (s *chatSessions) assistanceInboxFull(owner string) bool {
	count := 0
	for _, request := range s.assistance {
		if request.HelperOwner == owner && request.active() {
			count++
		}
	}
	return count >= assistanceInboxLimit
}

func (s *chatSessions) updateAssistance(actor assistanceActor, action string) (assistanceRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneAssistance()
	r := s.assistance[actor.id]
	if r == nil || !r.visible(actor.owner, actor.device) {
		return assistanceRequest{}, platform.NewError(404, "邀请不存在或已失效。")
	}
	if !r.active() {
		return *r, platform.NewError(409, "本次邀请已结束。")
	}
	if action == "end" {
		s.finishAssistance(r, assistanceEnded)
		return *r, nil
	}
	if actor.owner != r.HelperOwner || r.State != assistancePending {
		return *r, platform.NewError(409, "邀请已处理，请刷新后重试。")
	}
	if action == "decline" {
		s.finishAssistance(r, assistanceDeclined)
		return *r, nil
	}
	if action != "accept" || !s.assistanceOnline(actor.owner, actor.device) {
		return *r, platform.NewError(409, "请在已登录的电脑上接受邀请。")
	}
	for _, other := range s.assistance {
		if other.State == assistanceAccepted && other.HelperOwner == actor.owner && other.HelperDeviceID == actor.device {
			return *r, platform.NewError(409, "请先结束当前协助或取消邀请。")
		}
	}
	r.State, r.HelperDeviceID = assistanceAccepted, actor.device
	r.ExpiresAt = time.Now().Add(assistanceActiveLifetime)
	return *r, nil
}

type assistanceActor struct{ owner, device, id string }

func (s *chatSessions) listAssistance(owner, device string) []assistanceRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneAssistance()
	items := []assistanceRequest{}
	for _, request := range s.assistance {
		if request.visible(owner, device) {
			items = append(items, *request)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items
}

func (s *chatSessions) finishAssistance(request *assistanceRequest, state assistanceState) {
	request.State, request.FinishedAt = state, time.Now()
	for _, session := range s.hot.sessions {
		if session.assistanceID == request.ID {
			s.hot.remove(session)
			if session.mobile != nil {
				session.mobile.socket.close(4001, "Assistance ended")
			}
		}
	}
}

func (s *chatSessions) pruneAssistance() {
	for id, request := range s.assistance {
		if !request.active() {
			if time.Since(request.FinishedAt) > assistanceRetention {
				delete(s.assistance, id)
			}
			continue
		}
		if !request.ExpiresAt.After(time.Now()) {
			s.finishAssistance(request, assistanceExpired)
		}
	}
}
