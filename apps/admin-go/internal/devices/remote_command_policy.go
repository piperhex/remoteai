package devices

import (
	"log/slog"

	"github.com/codex-switch/admin-go/internal/content"
)

// Refresh only on startup and committed admin updates, never on the forwarding path.
// Serialize reads so concurrent saves cannot install an older policy after a newer one.
func (g *ControlGateway) refreshRemoteCommandPolicy() {
	g.commandPolicyMu.Lock()
	defer g.commandPolicyMu.Unlock()
	if g.service.deps.DB == nil {
		return
	}
	policy, err := content.ReadChatPolicy(g.service.deps.DB)
	if err != nil {
		slog.Warn("remote command policy refresh failed", "error", err)
		return
	}
	g.commandLimit.Store(int64(policy["remoteCommandConcurrencyLimit"].(float64)))
}

func (g *ControlGateway) remoteCommandLimit() int {
	limit := int(g.commandLimit.Load())
	if limit < 1 || limit > content.MaxRemoteCommandConcurrencyLimit {
		return content.DefaultRemoteCommandConcurrencyLimit
	}
	return limit
}

// Called with g.mu held. Count the logical target across replacement sockets too.
func (g *ControlGateway) remoteCommandBusy(client *peer, owner, device string, limit int) bool {
	callerCount, targetCount := 0, 0
	for _, pending := range g.commands {
		if pending.client == client {
			callerCount++
		}
		if pending.owner == owner && pending.device == device {
			targetCount++
		}
	}
	return callerCount >= limit || targetCount >= limit
}
