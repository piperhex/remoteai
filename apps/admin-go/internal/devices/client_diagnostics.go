package devices

import (
	"math"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

const clientDiagnosticLimit = 240
const clientDiagnosticReserved = 40
const maxClientDiagnosticBytes = 4096
const maxDiagnosticInteger = 1<<53 - 1

var clientDiagnosticEvents = strings.Fields(`mode relay-timeout peer-created peer-create-failed peer-state peer-retry
peer-offer-failed peer-signal-failed channel-closed link-failed path-state path-selected candidate-rejected
tcp-discovery tcp-dial ice-state ice-gathering ice-candidate ice-error ice-summary sdp-state desktop-start desktop-stage
desktop-failed desktop-closed native-state native-punch diagnostic-throttled`)

var clientDiagnosticEnums = map[string]string{
	"scope": "chat desktop", "transport": "rtc tcp mesh",
	"state": "new checking connecting connected completed disconnected failed closed",
	"mode":  "connecting direct relay offline",
	"stage": "starting ready failed exhausted gathering complete offer answer engine-start engine-failed " +
		"discovery stream-connect stream-failed stream-open stopped selected skipped cancelled " +
		"runtime-check capture-open fallback-open request-open lease-renew status signal",
	"desktopError": "screen-permission accessibility-permission desktop-disabled macos-version " +
		"platform-unsupported runtime-unavailable settings-unavailable no-displays display-enumeration " +
		"display-unavailable desktop-busy lease-expired invalid-request capture-failed " +
		"encoder-start encoder-first-frame encoder-timeout codec-unsupported unknown",
	"hostPlatform": "windows macos",
	"strategy":     "none cone-to-cone sym-to-cone easy-sym-to-easy-sym hard-sym-to-easy-sym",
	"phase": "selection waiting-lock punch public-mapping listener-rpc socket-bind " +
		"probe-send probe-rpc handshake admission",
	"localType": "host srflx prflx relay unknown", "remoteType": "host srflx prflx relay unknown",
	"candidateType": "host srflx prflx relay unknown", "direction": "local remote", "protocol": "udp tcp unknown",
	"addressKind": "public private mdns loopback link-local fake-ip unknown",
	"reason": "timeout peer-failed unhealthy unavailable candidate-limit candidate-rejected invalid-state " +
		"invalid-description operation-failed network permission unsupported unknown " +
		"policy already-direct blacklisted open-network await-peer unsupported-nat symmetric-disabled " +
		"no-public-mapping invalid-mapping no-reply rpc-timeout rpc-rejected rpc-transport " +
		"invalid-service-key io busy handshake-failed admission-failed cancelled",
}

var clientDiagnosticNumbers = strings.Fields(`generation elapsedMs attempt rttMs errorCode localCandidates
remoteCandidates candidatePairs failedPairs succeededPairs requestsSent requestsReceived responsesReceived
bytesSent bytesReceived rejectedCandidates connectedPeers routeCount udpNatType tcpNatType
suppressed stunServers turnServers displayCount diagnosticVersion peerUdpNatType durationMs sockets predictedPorts
probesSent probesReceived matchedProbes rejectedProbes probeSendErrors probeReceiveErrors
handshakeAttempts handshakeFailures`)

var clientDiagnosticBooleans = strings.Fields(
	"directHealthy relayHealthy ipv6 remoteKnown direct desktopEnabled nativeOnly")

// The session membership is checked by hotSessions.route. Identity comes from authentication, never the payload.
// Invalid telemetry is ignored so an older client diagnostic cannot take down an otherwise healthy session.
func (d *chatDiagnostics) clientEvent(session string, value interface{}) {
	if d == nil {
		return
	}
	fields := sanitizeClientDiagnostic(value)
	if fields == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if time.Since(d.clientWindow) >= time.Minute {
		if d.clientSuppressed > 0 {
			d.logger.Info("connection diagnostics throttled", "suppressed", d.clientSuppressed)
		}
		d.clientWindow, d.clientEvents, d.clientSuppressed = time.Now(), 0, 0
	}
	limit := clientDiagnosticLimit - clientDiagnosticReserved
	if clientDiagnosticOutcome(value) {
		limit = clientDiagnosticLimit
	}
	if d.clientEvents >= limit {
		d.clientSuppressed++
		return
	}
	d.clientEvents++
	d.logger.Info("connection diagnostic", append([]interface{}{"session", session}, fields...)...)
}

func clientDiagnosticOutcome(value interface{}) bool {
	input, ok := value.(platform.JSON)
	if !ok {
		return false
	}
	event := input["event"]
	return event == "mode" || event == "path-selected" || event == "desktop-failed" ||
		(event == "native-punch" && input["stage"] != "starting")
}

func sanitizeClientDiagnostic(value interface{}) []interface{} {
	input, ok := value.(platform.JSON)
	if !ok || len(input) > 48 {
		return nil
	}
	event, _ := input["event"].(string)
	if !containsDiagnosticValue(clientDiagnosticEvents, event) {
		return nil
	}
	fields := []interface{}{"event", event}
	for key, allowed := range clientDiagnosticEnums {
		if text, ok := input[key].(string); ok && containsDiagnosticValue(strings.Fields(allowed), text) {
			fields = append(fields, key, text)
		}
	}
	for _, key := range clientDiagnosticNumbers {
		number, ok := input[key].(float64)
		if ok && !math.IsNaN(number) && !math.IsInf(number, 0) && number >= 0 && number <= maxDiagnosticInteger {
			fields = append(fields, key, math.Round(number))
		}
	}
	for _, key := range clientDiagnosticBooleans {
		if flag, ok := input[key].(bool); ok {
			fields = append(fields, key, flag)
		}
	}
	return fields
}

func containsDiagnosticValue(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
