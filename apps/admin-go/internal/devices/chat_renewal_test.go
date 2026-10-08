package devices

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func TestRenewalPreservesSocketsProofsAndTheOtherEndpointDeadline(t *testing.T) {
	sessions := newChatSessions(nil)
	desktop, phone, other := queuedPeer(), queuedPeer(), queuedPeer()
	now := time.Now()
	identity := chatIdentity{"owner", "pc", "desktop", now.Add(time.Hour)}
	old := now.Add(time.Minute)
	sessions.info[desktop] = desktopInfo{expires: old, version: 2}
	first := &hotSession{id: "first", token: "proof", owner: "owner", device: "pc",
		desktop: chatEndpoint{desktop, old}, mobile: &chatEndpoint{phone, old}, expires: old}
	second := &hotSession{id: "second", token: "other-proof", owner: "owner", device: "pc",
		desktop: chatEndpoint{desktop, old}, mobile: &chatEndpoint{other, old}, expires: old}
	sessions.hot.sessions[first.id], sessions.hot.sessions[second.id] = first, second
	sessions.renew(desktop, identity)
	if !first.desktop.expires.Equal(identity.expires) || !first.expires.Equal(old) {
		t.Fatal("host renewal did not preserve the viewer deadline")
	}
	assertRenewedFrame(t, desktop, old)
	assertRenewedFrame(t, desktop, old)
	assertRenewedFrame(t, phone, old)
	assertRenewedFrame(t, other, old)
	identity.role = "mobile"
	sessions.renew(phone, identity)
	assertRenewedFrame(t, desktop, identity.expires)
	assertRenewedFrame(t, phone, identity.expires)
	if len(other.queue) != 0 || !second.expires.Equal(old) {
		t.Fatal("renewing one viewer affected another session")
	}
	if first.desktop.socket != desktop || first.mobile.socket != phone || first.token != "proof" {
		t.Fatal("renewal changed the authenticated session")
	}
	if !sessions.info[desktop].expires.Equal(identity.expires) {
		t.Fatal("new pairings would still inherit the old desktop deadline")
	}
}

func assertRenewedFrame(t *testing.T, client *peer, expires time.Time) {
	t.Helper()
	select {
	case frame := <-client.queue:
		var message platform.JSON
		if err := json.Unmarshal(frame.bytes, &message); err != nil {
			t.Fatal(err)
		}
		if message["type"] != "resumed" || message["renewed"] != true ||
			message["expiresAt"] != float64(expires.UnixMilli()) {
			t.Fatal("renewal interrupted the path or reported a wrong lease", message)
		}
	default:
		t.Fatal("missing renewal notification")
	}
}

func TestRenewalCannotResurrectExpiredSessionsOrChangeIdentity(t *testing.T) {
	sessions := newChatSessions(nil)
	desktop, phone := queuedPeer(), queuedPeer()
	expired := time.Now().Add(-time.Second)
	identity := chatIdentity{"owner", "pc", "desktop", time.Now().Add(time.Hour)}
	session := &hotSession{id: "expired", owner: "owner", device: "pc", expires: expired,
		desktop: chatEndpoint{desktop, expired}, mobile: &chatEndpoint{phone, expired}}
	sessions.hot.sessions[session.id] = session
	sessions.renew(desktop, identity)
	if !session.expires.Equal(expired) || len(desktop.queue) != 0 || len(phone.queue) != 0 {
		t.Fatal("expired session was resurrected")
	}
	for _, change := range []func(*chatIdentity){
		func(next *chatIdentity) { next.owner = "another-owner" },
		func(next *chatIdentity) { next.device = "another-device" },
		func(next *chatIdentity) { next.role = "mobile" },
	} {
		next := identity
		change(&next)
		if sameChatIdentity(identity, next) {
			t.Fatal("renewal accepted an identity change")
		}
	}
}

func TestOldExpiryCallbackCannotRevokeRenewedConnection(t *testing.T) {
	client := queuedPeer()
	gateway := &ChatGateway{sessions: newChatSessions(nil)}
	previous := &chatIdentity{"owner", "pc", "desktop", time.Now().Add(-time.Second)}
	state := &chatConnection{identity: previous, timer: time.NewTimer(time.Hour)}
	gateway.setAuthentication(client, state, chatIdentity{"owner", "pc", "desktop", time.Now().Add(time.Hour)})
	defer state.timer.Stop()
	gateway.expireAuthentication(client, state, previous)
	if client.closed.Load() {
		t.Fatal("old timer revoked the renewed socket")
	}
}
