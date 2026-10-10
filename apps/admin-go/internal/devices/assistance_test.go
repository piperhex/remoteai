package devices

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func assistanceFixture(t *testing.T) (*chatSessions, assistanceRequest) {
	t.Helper()
	s := newChatSessions(nil)
	for _, owner := range []string{"host", "helper"} {
		identity := chatIdentity{owner, owner + "-pc", "desktop", time.Now().Add(3 * time.Hour)}
		if err := s.join(queuedPeer(), identity,
			platform.JSON{"transportVersion": float64(2), "remoteAssistance": true}, nil); err != nil {
			t.Fatal(err)
		}
	}
	request, err := s.createAssistance(assistanceRequest{HostOwner: "host", HostDeviceID: "host-pc",
		HostEmail: "host@example.test", HostName: "Host PC", HelperOwner: "helper", HelperEmail: "helper@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	return s, request
}

func acceptAssistance(t *testing.T, s *chatSessions, id string) assistanceRequest {
	t.Helper()
	r, err := s.updateAssistance(assistanceActor{"helper", "helper-pc", id}, "accept")
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func assistanceFrame(id string) platform.JSON {
	return platform.JSON{"assistanceId": id, "assistingDeviceId": "helper-pc", "transportVersion": float64(2),
		"publicKey": strings.Repeat("ab", 32)}
}

func TestAssistanceRequiresConsentAndBindsBothAccountsAndDevices(t *testing.T) {
	s, request := assistanceFixture(t)
	frame := assistanceFrame(request.ID)
	deadline := time.Now().Add(3 * time.Hour)
	if _, err := s.authenticateAssistance("helper", "host-pc", deadline, frame); err == nil {
		t.Fatal("pending invitation authorized remote access")
	}
	for _, actor := range []assistanceActor{{"intruder", "helper-pc", request.ID},
		{"host", "host-pc", request.ID}, {"helper", "offline-pc", request.ID}} {
		if _, err := s.updateAssistance(actor, "accept"); err == nil {
			t.Fatal("unauthorized actor accepted invitation", actor)
		}
	}
	accepted := acceptAssistance(t, s, request.ID)
	identity, err := s.authenticateAssistance("helper", "host-pc", deadline, frame)
	if err != nil || identity.owner != "host" || !identity.expires.Equal(accepted.ExpiresAt) {
		t.Fatal("accepted grant did not bind target or expiry", identity, err)
	}
	if _, err = s.authenticateAssistance("intruder", "host-pc", deadline, frame); err == nil {
		t.Fatal("another account used invitation")
	}
	if _, err = s.authenticateAssistance("helper", "different-pc", deadline, frame); err == nil {
		t.Fatal("invitation authorized a different target")
	}
	frame["assistingDeviceId"] = "another-helper-pc"
	if _, err = s.authenticateAssistance("helper", "host-pc", deadline, frame); err == nil {
		t.Fatal("another helper device used an accepted invitation")
	}
}

func TestAssistanceCancellationRevokesPairedSessionAndCannotBeResumed(t *testing.T) {
	s, request := assistanceFixture(t)
	acceptAssistance(t, s, request.ID)
	frame := assistanceFrame(request.ID)
	identity, err := s.authenticateAssistance("helper", "host-pc", time.Now().Add(time.Hour), frame)
	if err != nil {
		t.Fatal(err)
	}
	helper := sessionLimitPeer(t)
	if err = s.join(helper, identity, frame, nil); err != nil {
		t.Fatal(err)
	}
	if len(s.hot.sessions) != 1 {
		t.Fatal("invitation did not create a scoped session")
	}
	for _, session := range s.hot.sessions {
		if session.assistanceID != request.ID {
			t.Fatal("session lost invitation scope")
		}
		frame["resume"] = map[string]interface{}{"sessionId": session.id, "resumeToken": session.token}
	}
	if _, err = s.updateAssistance(assistanceActor{"host", "host-pc", request.ID}, "end"); err != nil {
		t.Fatal(err)
	}
	if len(s.hot.sessions) != 0 || !helper.closed.Load() {
		t.Fatal("cancelled invitation retained a connection")
	}
	if err = s.join(queuedPeer(), identity, frame, nil); err == nil {
		t.Fatal("cancelled invitation resumed or won pairing race")
	}
}

func TestAssistanceCannotResumeAnUnrelatedSameAccountSession(t *testing.T) {
	s, request := assistanceFixture(t)
	acceptAssistance(t, s, request.ID)
	identity := chatIdentity{"host", "host-pc", "mobile", time.Now().Add(time.Hour)}
	if err := s.join(queuedPeer(), identity,
		platform.JSON{"transportVersion": float64(2), "publicKey": strings.Repeat("cd", 32)}, nil); err != nil {
		t.Fatal(err)
	}
	frame := assistanceFrame(request.ID)
	for _, session := range s.hot.sessions {
		frame["resume"] = map[string]interface{}{"sessionId": session.id, "resumeToken": session.token}
	}
	if err := s.join(queuedPeer(), identity, frame, nil); err == nil {
		t.Fatal("assistance resumed a full-access session")
	}
}

func TestAssistanceExpiryVisibilityAndOnlineRequirements(t *testing.T) {
	s, request := assistanceFixture(t)
	if len(s.listAssistance("intruder", "host-pc")) != 0 || len(s.listAssistance("host", "other-pc")) != 0 {
		t.Fatal("invitation disclosed to an unrelated actor")
	}
	if len(s.listAssistance("helper", "helper-pc")) != 1 {
		t.Fatal("recipient cannot see invitation")
	}
	s.assistance[request.ID].ExpiresAt = time.Now().Add(-time.Second)
	if _, err := s.updateAssistance(assistanceActor{"helper", "helper-pc", request.ID}, "accept"); err == nil {
		t.Fatal("expired invitation accepted")
	}
	if s.assistance[request.ID].State != assistanceExpired {
		t.Fatal("expiry not reflected in status")
	}
	s.assistance[request.ID].FinishedAt = time.Now().Add(-2 * assistanceRetention)
	s.prune()
	if len(s.assistance) != 0 {
		t.Fatal("finished invitation retained indefinitely")
	}
	peer := s.desktops["helper:helper-pc"]
	peer.serviceHost.Store(true)
	request, err := s.createAssistance(request)
	if err != nil || request.State != assistancePending {
		t.Fatal("recipient availability changed the creation response", err)
	}
	if _, err := s.updateAssistance(assistanceActor{"helper", "helper-pc", request.ID}, "accept"); err == nil {
		t.Fatal("unattended service accepted assistance")
	}
	peer.serviceHost.Store(false)
	info := s.info[peer]
	info.assistance = false
	s.info[peer] = info
	if _, err := s.updateAssistance(assistanceActor{"helper", "helper-pc", request.ID}, "accept"); err == nil {
		t.Fatal("unsupported desktop accepted assistance")
	}
	s.disconnect(peer, false)
	if _, err := s.updateAssistance(assistanceActor{"helper", "helper-pc", request.ID}, "accept"); err == nil {
		t.Fatal("offline desktop accepted assistance")
	}
}

func TestOnlyOneHelperDeviceCanAcceptAndOnlyOneSessionCanPair(t *testing.T) {
	s, request := assistanceFixture(t)
	var workers sync.WaitGroup
	accepted := make(chan bool, 2)
	for range 2 {
		workers.Go(func() {
			_, err := s.updateAssistance(assistanceActor{"helper", "helper-pc", request.ID}, "accept")
			accepted <- err == nil
		})
	}
	workers.Wait()
	if first, second := <-accepted, <-accepted; first == second {
		t.Fatal("acceptance race was not serialized")
	}
	identity, err := s.authenticateAssistance("helper", "host-pc", time.Now().Add(time.Hour), assistanceFrame(request.ID))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.join(queuedPeer(), identity, assistanceFrame(request.ID), nil); err != nil {
		t.Fatal(err)
	}
	if err := s.join(queuedPeer(), identity, assistanceFrame(request.ID), nil); err == nil {
		t.Fatal("duplicate assistance session admitted")
	}
}

func TestAssistanceCannotFallBackToUnscopedLegacyPairingAfterHostReplacement(t *testing.T) {
	s, request := assistanceFixture(t)
	acceptAssistance(t, s, request.ID)
	frame := assistanceFrame(request.ID)
	identity, err := s.authenticateAssistance("helper", "host-pc", time.Now().Add(time.Hour), frame)
	if err != nil {
		t.Fatal(err)
	}
	host := s.desktops["host:host-pc"]
	info := s.info[host]
	info.version = 1
	s.info[host] = info
	if err := s.join(queuedPeer(), identity, frame, nil); err == nil {
		t.Fatal("host downgrade bypassed assistance scope")
	}
	if len(s.sessions) != 0 || len(s.hot.sessions) != 0 {
		t.Fatal("downgraded host received an assistance session")
	}
}
