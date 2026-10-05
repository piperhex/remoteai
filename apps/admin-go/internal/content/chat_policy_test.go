package content

import (
	"math"
	"testing"
)

func TestChatPolicyDefaultsForOlderSettings(t *testing.T) {
	policy := defaultChatPolicy()
	delete(policy, "titleSettings")
	defaults := map[string]float64{
		"chatSessionLimit":             5,
		"p2pNegotiationTimeoutSeconds": 45,
		"p2pRetryIntervalSeconds":      10,
		"p2pDisconnectGraceSeconds":    10,
		"relayHeartbeatTimeoutSeconds": 30,
		"fileDownloadWindowSize":       5,
	}
	for key := range defaults {
		delete(policy, key)
	}
	parsed, err := parseChatPolicy(policy)
	if err != nil {
		t.Fatal(err)
	}
	for key, expected := range defaults {
		if parsed[key] != expected {
			t.Fatalf("%s default: got %v, want %v", key, parsed[key], expected)
		}
	}
}

func TestFileDownloadWindowValidation(t *testing.T) {
	policy := defaultChatPolicy()
	delete(policy, "titleSettings")
	for _, value := range []float64{1, 5, 12} {
		policy["fileDownloadWindowSize"] = value
		parsed, err := parseChatPolicy(policy)
		if err != nil || parsed["fileDownloadWindowSize"] != value {
			t.Fatalf("window %v: got %v, error %v", value, parsed, err)
		}
	}
	for _, value := range []interface{}{0.0, -1.0, 13.0, 1.5, math.NaN(), math.Inf(1), "5", nil} {
		policy["fileDownloadWindowSize"] = value
		if _, err := parseChatPolicy(policy); err == nil {
			t.Fatalf("accepted invalid download window %v", value)
		}
	}
}

func TestChatSessionLimitValidation(t *testing.T) {
	policy := defaultChatPolicy()
	delete(policy, "titleSettings")
	for _, value := range []float64{1, 5, 12, 9007199254740991} {
		policy["chatSessionLimit"] = value
		parsed, err := parseChatPolicy(policy)
		if err != nil || parsed["chatSessionLimit"] != value {
			t.Fatalf("limit %v: got %v, error %v", value, parsed, err)
		}
	}
	for _, value := range []interface{}{0.0, -1.0, 1.5, math.NaN(), math.Inf(1), 9007199254740992.0, "5", nil} {
		policy["chatSessionLimit"] = value
		if _, err := parseChatPolicy(policy); err == nil {
			t.Fatalf("accepted invalid session limit %v", value)
		}
	}
}

func TestConnectionPolicyDurationsHaveNoProductUpperLimit(t *testing.T) {
	for _, key := range []string{"p2pNegotiationTimeoutSeconds", "p2pRetryIntervalSeconds",
		"p2pDisconnectGraceSeconds", "relayHeartbeatTimeoutSeconds"} {
		policy := defaultChatPolicy()
		delete(policy, "titleSettings")
		for _, value := range []float64{1, 1_000_000, 9007199254740991} {
			policy[key] = value
			parsed, err := parseChatPolicy(policy)
			if err != nil || parsed[key] != value {
				t.Fatalf("%s=%v: got %v, error %v", key, value, parsed, err)
			}
		}
		for _, value := range []interface{}{0.0, -1.0, 1.5, math.NaN(), math.Inf(1), "45", nil} {
			policy[key] = value
			if _, err := parseChatPolicy(policy); err == nil {
				t.Fatalf("accepted %s=%v", key, value)
			}
		}
	}
}
