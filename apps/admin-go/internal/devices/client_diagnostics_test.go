package devices

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func TestClientDiagnosticsSanitizeAndBoundReports(t *testing.T) {
	d, buffer := diagnosticFixture()
	input := platform.JSON{"event": "ice-summary", "scope": "desktop", "requestsSent": float64(622),
		"responsesReceived": float64(0), "bytesSent": math.Inf(1), "reason": "private-error",
		"session": "private-session", "role": "private-role", "candidate": "private-address", "secret": "private-secret"}
	for range clientDiagnosticLimit + 10 {
		d.clientEvent("session", input)
	}
	output := buffer.String()
	if strings.Contains(output, "private-") || strings.Contains(output, "bytesSent") ||
		strings.Count(output, "connection diagnostic") != clientDiagnosticLimit-clientDiagnosticReserved ||
		!strings.Contains(output, `"requestsSent":622`) || !strings.Contains(output, `"responsesReceived":0`) {
		t.Fatalf("unsafe or incomplete diagnostics: %s", output)
	}
	d.clientWindow = time.Now().Add(-time.Minute)
	d.clientEvent("session", input)
	if !strings.Contains(buffer.String(), `"suppressed":50`) {
		t.Fatal("missing throttled-event count")
	}
	d.clientEvent("session", platform.JSON{"event": "private-event"})
	if strings.Contains(buffer.String(), "private-") {
		t.Fatal("unknown event was logged")
	}
}

func TestNativePunchOutcomesSurviveNoiseAndRemainRedacted(t *testing.T) {
	d, buffer := diagnosticFixture()
	for range clientDiagnosticLimit {
		d.clientEvent("session", platform.JSON{"event": "ice-candidate"})
	}
	d.clientEvent("session", platform.JSON{"event": "native-punch", "scope": "chat", "transport": "mesh",
		"strategy": "hard-sym-to-easy-sym", "stage": "failed", "phase": "listener-rpc",
		"reason": "rpc-rejected", "attempt": float64(3), "peerUdpNatType": float64(8),
		"probesSent": float64(0), "handshakeAttempts": float64(0), "durationMs": float64(400),
		"peerId": "private-peer", "address": "private-address", "error": "private-error", "secret": "private-key"})
	output := buffer.String()
	for _, required := range []string{`"event":"native-punch"`, `"phase":"listener-rpc"`,
		`"reason":"rpc-rejected"`, `"attempt":3`, `"probesSent":0`, `"peerUdpNatType":8`} {
		if !strings.Contains(output, required) {
			t.Fatalf("missing %s", required)
		}
	}
	if strings.Contains(output, "private-") {
		t.Fatal("private fields entered diagnostics")
	}
	for range clientDiagnosticLimit {
		d.clientEvent("session", platform.JSON{"event": "native-punch", "stage": "failed"})
	}
	if strings.Count(buffer.String(), `"msg":"connection diagnostic"`) != clientDiagnosticLimit {
		t.Fatal("priority outcomes bypassed the total rate limit")
	}
}

func TestIceDiagnosticsRetainEveryGeneration(t *testing.T) {
	d, buffer := diagnosticFixture()
	for _, generation := range []float64{0, 1, 1, 2} {
		d.queued(platform.JSON{"type": "signal", "sessionId": "session", "payload": platform.JSON{
			"kind": "ice", "generation": generation, "candidate": "candidate:1 1 udp 1 192.0.2.1 1000 typ srflx"}})
	}
	if strings.Count(buffer.String(), "candidate_type") != 3 {
		t.Fatal("a later ICE generation was hidden by candidate deduplication")
	}
	d.queued(platform.JSON{"type": "signal", "sessionId": "empty", "payload": platform.JSON{"kind": "ice"}})
}

func TestDesktopStartupFailureSurvivesNoiseAndRejectsPrivateDetails(t *testing.T) {
	d, buffer := diagnosticFixture()
	for range clientDiagnosticLimit {
		d.clientEvent("session", platform.JSON{"event": "ice-candidate"})
	}
	d.clientEvent("session", platform.JSON{"event": "desktop-failed", "scope": "desktop",
		"stage": "capture-open", "desktopError": "screen-permission", "reason": "permission",
		"hostPlatform": "macos", "durationMs": float64(6), "displayCount": float64(0), "nativeOnly": true,
		"error": "private-error", "path": "private-path", "displayName": "private-name"})
	output := buffer.String()
	for _, required := range []string{`"event":"desktop-failed"`, `"stage":"capture-open"`,
		`"desktopError":"screen-permission"`, `"hostPlatform":"macos"`, `"durationMs":6`, `"displayCount":0`} {
		if !strings.Contains(output, required) {
			t.Fatalf("missing %s", required)
		}
	}
	if strings.Contains(output, "private-") {
		t.Fatal("private desktop details entered diagnostics")
	}
	for range clientDiagnosticLimit {
		d.clientEvent("session", platform.JSON{"event": "desktop-failed", "desktopError": "private-code"})
	}
	if strings.Count(buffer.String(), `"msg":"connection diagnostic"`) != clientDiagnosticLimit ||
		strings.Contains(buffer.String(), "private-") {
		t.Fatal("desktop failures bypassed rate limits or enum sanitization")
	}
}

func TestDesktopStartupStagesRetainSafeCaptureMetadata(t *testing.T) {
	d, buffer := diagnosticFixture()
	d.clientEvent("session", platform.JSON{"event": "desktop-stage", "scope": "desktop", "stage": "stream-open",
		"hostPlatform": "macos", "displayCount": float64(2), "nativeOnly": true, "desktopEnabled": true})
	for _, field := range []string{`"event":"desktop-stage"`, `"displayCount":2`, `"nativeOnly":true`,
		`"desktopEnabled":true`} {
		if !strings.Contains(buffer.String(), field) {
			t.Fatalf("missing %s", field)
		}
	}
}

func TestClientDiagnosticsRequireSessionMembershipAndDoNotForward(t *testing.T) {
	sessions := newHotSessions(nil)
	desktop, mobile, outsider := queuedPeer(), queuedPeer(), queuedPeer()
	diagnostic, buffer := diagnosticFixture()
	mobile.diagnostics = diagnostic
	sessions.sessions["session"] = &hotSession{id: "session", expires: time.Now().Add(time.Minute),
		desktop: chatEndpoint{socket: desktop}, mobile: &chatEndpoint{socket: mobile}}
	frame := platform.JSON{"type": "diagnostic", "sessionId": "session",
		"payload": platform.JSON{"event": "ice-state", "state": "failed", "scope": "chat"}}
	if handled, err := sessions.route(outsider, frame); !handled || err == nil {
		t.Fatal("accepted diagnostic for another client's session")
	}
	if handled, err := sessions.route(mobile, frame); !handled || err != nil {
		t.Fatal("rejected authenticated diagnostic", err)
	}
	if !strings.Contains(buffer.String(), "connection diagnostic") || len(desktop.queue) != 0 {
		t.Fatal("diagnostic must stay in server logs and never be sent to the peer")
	}
}

func TestClientDiagnosticsDoNotConsumeRelayBudget(t *testing.T) {
	gateway := &ChatGateway{sessions: newChatSessions(nil), policy: platform.JSON{
		"relayMaxFramesPerSecond": float64(1), "relayMaxMbPerSecond": float64(1)}}
	desktop, mobile := queuedPeer(), queuedPeer()
	diagnostic, buffer := diagnosticFixture()
	mobile.diagnostics = diagnostic
	expires := time.Now().Add(time.Minute)
	gateway.sessions.hot.sessions["session"] = &hotSession{id: "session", expires: expires,
		desktop: chatEndpoint{socket: desktop}, mobile: &chatEndpoint{socket: mobile}}
	state := &chatConnection{identity: &chatIdentity{expires: expires}, windowStart: time.Now()}
	frame := platform.JSON{"type": "diagnostic", "sessionId": "session",
		"payload": platform.JSON{"event": "ice-state", "state": "checking"}}
	for range 10 {
		if err := gateway.receive(mobile, state, frame, 100); err != nil {
			t.Fatal(err)
		}
	}
	if state.bytes != 0 || state.frames != 0 {
		t.Fatal("diagnostic used the application's relay budget")
	}
	before := buffer.Len()
	if err := gateway.receive(mobile, state, frame, maxClientDiagnosticBytes+1); err != nil || buffer.Len() != before {
		t.Fatal("oversized diagnostic must be dropped without closing the session")
	}
}
