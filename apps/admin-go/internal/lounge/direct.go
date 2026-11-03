package lounge

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

func (h *hub) direct(sender *peer, input incoming) {
	targetID, err := uuid.Parse(input.To)
	if err != nil || targetID.String() == sender.user.ID || h.relationships == nil {
		h.reject(sender, input.ID, "client.lounge.directUnavailable")
		return
	}
	input.To = targetID.String()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	target, err := h.relationships.Account(ctx, input.To)
	if err != nil {
		h.reject(sender, input.ID, "client.lounge.directUnavailable")
		return
	}
	h.mu.Lock()
	available := h.directAvailableLocked(sender, input)
	h.mu.Unlock()
	if !available {
		h.reject(sender, input.ID, "client.lounge.directUnavailable")
		return
	}
	admission, err := h.admitDirect(ctx, sender.user.ID, input)
	if err != nil {
		h.rejectDirect(sender, input, err)
		return
	}
	if h.relayDirect(sender, input, target) && admission.Mutual {
		h.savedContactsChanged(sender.user.ID, target.ID)
	}
	if admission.Changed {
		h.sendDirectPermissions(sender.user.ID, []string{target.ID})
		h.sendDirectPermissions(target.ID, []string{sender.user.ID})
	}
}

func (h *hub) admitDirect(ctx context.Context, sender string, input incoming) (directAdmission, error) {
	if h.directPolicy == nil {
		return directAdmission{}, nil
	}
	permission, err := h.directPermission(sender, input)
	if err != nil {
		return directAdmission{}, err
	}
	if store, ok := h.directPolicy.(interface {
		AdmitMessage(context.Context, directPermission) (directAdmission, error)
	}); ok {
		return store.AdmitMessage(ctx, permission)
	}
	if store, ok := h.directPolicy.(interface {
		AdmitWithContact(context.Context, directPermission) (bool, error)
	}); ok {
		mutual, err := store.AdmitWithContact(ctx, permission)
		return directAdmission{Mutual: mutual, Changed: err == nil}, err
	}
	err = h.directPolicy.Admit(ctx, permission)
	return directAdmission{Changed: err == nil}, err
}

func (h *hub) rejectDirect(sender *peer, input incoming, err error) {
	code := "client.lounge.directUnavailable"
	if errors.Is(err, errAwaitingReply) {
		code = awaitingReply
	}
	if errors.Is(err, errDirectReset) {
		code = errDirectReset.Error()
		h.sendDirectPermissions(sender.user.ID, []string{input.To})
	}
	h.reject(sender, input.ID, code)
}

func (h *hub) directAvailableLocked(sender *peer, input incoming) bool {
	if !h.activeLocked(sender) || !sender.direct || !sender.canContact(input.To) || input.Receipts && !sender.receipts {
		return false
	}
	for client := range h.clients {
		if h.activeLocked(client) && client.direct && (!input.Receipts || client.receipts) &&
			client.user.ID == input.To && !client.blocks[sender.user.ID] {
			return true
		}
	}
	return false
}

func (h *hub) relayDirect(sender *peer, input incoming, target account) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.directAvailableLocked(sender, input) {
		h.reject(sender, input.ID, "client.lounge.directUnavailable")
		return false
	}
	profile := sender.user
	frames, err := encodeMessage(message{Type: "message", ID: input.ID, Sender: profile, Text: input.Text,
		Images: input.Images, Attachments: input.Attachments, Reply: input.Reply,
		Recipient: &target, Receipts: input.Receipts, Generation: input.Generation,
		SentAt: time.Now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return false
	}
	delivered := false
	for client := range h.clients {
		if h.activeLocked(client) && client.direct && (!input.Receipts || client.receipts) &&
			client.user.ID == target.ID && !client.blocks[sender.user.ID] {
			delivered = client.enqueue(frames.forPeer(client)) || delivered
		}
	}
	if !delivered {
		h.reject(sender, input.ID, "client.lounge.directUnavailable")
		return false
	}
	for client := range h.clients {
		if h.activeLocked(client) && client.direct && (!input.Receipts || client.receipts) && client.user.ID == sender.user.ID {
			client.enqueue(frames.forPeer(client))
		}
	}
	return true
}

func (h *hub) activeLocked(client *peer) bool {
	if !h.clients[client] || !client.expires.After(time.Now()) {
		return false
	}
	select {
	case <-client.done:
		return false
	default:
		return true
	}
}
