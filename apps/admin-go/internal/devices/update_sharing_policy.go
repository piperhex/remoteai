package devices

import (
	"log/slog"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/updatesharing"
)

// Enforce the global scope before either the local or Redis matcher sees a request.
// Upload speed and network cost are applied by the uploading desktop.
func (g *ControlGateway) applyUpdateSharingPolicy(client *peer, message platform.JSON) bool {
	if message["type"] == "update-peer-done" || g.service == nil {
		return true
	}
	settings, err := updatesharing.ReadCached(g.service.deps)
	if err != nil {
		slog.Warn("Could not read download sharing settings", "error", err)
		settings.Scope = updatesharing.Off
	}
	if constrainUpdateSharing(message, settings.Scope) {
		return true
	}
	client.send(platform.JSON{"type": "update-peer-unavailable", "requestId": message["requestId"]}, nil)
	return false
}

func constrainUpdateSharing(message platform.JSON, scope string) bool {
	if scope == updatesharing.Off {
		if message["type"] == "update-peer-find" {
			return false
		}
		message["artifacts"] = []interface{}{}
	}
	if scope == updatesharing.Own {
		message["ownOnly"] = true
	}
	return true
}
