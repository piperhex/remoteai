package content

import (
	"math"
	"testing"
)

func TestRemoteCommandPolicyDefaultsAndBounds(t *testing.T) {
	policy := defaultChatPolicy()
	delete(policy, "titleSettings")
	delete(policy, "remoteCommandConcurrencyLimit")
	parsed, err := parseChatPolicy(policy)
	if err != nil || parsed["remoteCommandConcurrencyLimit"] != float64(5) {
		t.Fatal("old configuration must default to five", parsed, err)
	}
	for _, value := range []float64{1, 5, 8, 32} {
		policy["remoteCommandConcurrencyLimit"] = value
		parsed, err = parseChatPolicy(policy)
		if err != nil || parsed["remoteCommandConcurrencyLimit"] != value || parsed["chatSessionLimit"] != float64(5) {
			t.Fatal("independent command setting did not survive parsing", parsed, err)
		}
	}
	for _, value := range []interface{}{nil, "5", 0.0, -1.0, 1.5, 33.0, math.NaN(), math.Inf(1)} {
		policy["remoteCommandConcurrencyLimit"] = value
		if _, err = parseChatPolicy(policy); err == nil {
			t.Fatal("invalid limit accepted", value)
		}
	}
}
