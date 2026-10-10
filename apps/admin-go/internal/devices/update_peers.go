package devices

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const (
	updateSeedLifetime     = 70 * time.Second
	updateTransferLifetime = 20 * time.Minute
	maxUpdateSeeds         = 10000
	maxUpdateTransfers     = 1024
	maxUpdateSeedPackages  = 2
	maxUpdateUploads       = 2
	updateFindInterval     = 10 * time.Second
)

type updateSeed struct {
	artifacts []string
	expires   time.Time
}

type updateTransfer struct {
	seed, receiver *peer
	expires        time.Time
}

// Only opaque artifact identifiers and short-lived connection grants cross accounts.
// Neither update metadata nor package bytes are accepted or relayed here.
type updatePeerTracker struct {
	native    platform.JSON
	seeds     map[*peer]updateSeed
	transfers map[string]updateTransfer
	lastFind  map[*peer]time.Time
}

func newUpdatePeerTracker(service *Service) *updatePeerTracker {
	var native platform.JSON
	if service != nil {
		// The chat gateway validates this same configuration at startup.
		native, _ = nativeTraversalConfig(service.deps.Config)
	}
	return &updatePeerTracker{native: native, seeds: map[*peer]updateSeed{},
		transfers: map[string]updateTransfer{}, lastFind: map[*peer]time.Time{}}
}

func (g *ControlGateway) receiveUpdatePeer(client *peer, session controlSession, message platform.JSON) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if session.kind != "device" || client.serviceHost.Load() ||
		g.sockets[session.owner+":"+session.device] != client || client.closed.Load() {
		return
	}
	t := g.updatePeers
	t.prune(time.Now())
	switch message["type"] {
	case "update-peer-advertise":
		t.advertise(client, message)
	case "update-peer-find":
		t.find(client, message)
	case "update-peer-done":
		id, _ := message["sessionId"].(string)
		if transfer, ok := t.transfers[id]; ok && (transfer.seed == client || transfer.receiver == client) {
			t.finish(id, transfer)
		}
	}
}

func validUpdateArtifact(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if !(character >= '0' && character <= '9' || character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}

func (t *updatePeerTracker) advertise(client *peer, message platform.JSON) {
	values, ok := message["artifacts"].([]interface{})
	if !ok || len(values) > maxUpdateSeedPackages || t.native == nil {
		return
	}
	artifacts := make([]string, 0, len(values))
	for _, value := range values {
		artifact, ok := value.(string)
		if !ok || !validUpdateArtifact(artifact) {
			return
		}
		artifacts = append(artifacts, artifact)
	}
	if len(artifacts) == 0 {
		delete(t.seeds, client)
		return
	}
	if _, exists := t.seeds[client]; !exists && len(t.seeds) >= maxUpdateSeeds {
		return
	}
	t.seeds[client] = updateSeed{artifacts, time.Now().Add(updateSeedLifetime)}
}

func (t *updatePeerTracker) find(client *peer, message platform.JSON) {
	request, _ := message["requestId"].(string)
	artifact, _ := message["artifact"].(string)
	if len(request) == 0 || len(request) > 80 {
		return
	}
	unavailable := func() { client.send(platform.JSON{"type": "update-peer-unavailable", "requestId": request}, nil) }
	if !validUpdateArtifact(artifact) || t.native == nil || len(t.transfers) >= maxUpdateTransfers ||
		t.downloading(client) || time.Since(t.lastFind[client]) < updateFindInterval {
		unavailable()
		return
	}
	t.lastFind[client] = time.Now()
	seed := t.selectSeed(client, artifact)
	if seed == nil {
		unavailable()
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		unavailable()
		return
	}
	id := "update-" + uuid.NewString()
	expires := time.Now().Add(updateTransferLifetime)
	t.transfers[id] = updateTransfer{seed, client, expires}
	grant := func(desktop bool) platform.JSON {
		return platform.JSON{"sessionId": id, "secret": hex.EncodeToString(secret), "desktop": desktop,
			"expiresAt": expires.UnixMilli(), "servers": t.native["servers"], "stunServers": t.native["stunServers"]}
	}
	seed.send(platform.JSON{"type": "update-peer-offer", "artifact": artifact, "config": grant(true)}, nil)
	client.send(platform.JSON{"type": "update-peer-offer", "requestId": request,
		"artifact": artifact, "config": grant(false)}, nil)
}

func (t *updatePeerTracker) downloading(client *peer) bool {
	for _, transfer := range t.transfers {
		if transfer.receiver == client {
			return true
		}
	}
	return false
}

func (t *updatePeerTracker) selectSeed(receiver *peer, artifact string) *peer {
	uploads := map[*peer]int{}
	for _, transfer := range t.transfers {
		uploads[transfer.seed]++
	}
	// Go map iteration distributes requests; prefer an idle seed before a second upload.
	var candidate *peer
	for client, seed := range t.seeds {
		if client == receiver || client.closed.Load() || uploads[client] >= maxUpdateUploads {
			continue
		}
		for _, available := range seed.artifacts {
			if available != artifact {
				continue
			}
			if uploads[client] == 0 {
				return client
			}
			candidate = client
		}
	}
	return candidate
}

func (t *updatePeerTracker) prune(now time.Time) {
	for client, seed := range t.seeds {
		if client.closed.Load() || !now.Before(seed.expires) {
			delete(t.seeds, client)
		}
	}
	for id, transfer := range t.transfers {
		if !now.Before(transfer.expires) {
			t.finish(id, transfer)
		}
	}
	for client, last := range t.lastFind {
		if now.Sub(last) > time.Minute {
			delete(t.lastFind, client)
		}
	}
}

func (t *updatePeerTracker) disconnect(client *peer) {
	delete(t.seeds, client)
	delete(t.lastFind, client)
	for id, transfer := range t.transfers {
		if transfer.seed == client || transfer.receiver == client {
			t.finish(id, transfer)
		}
	}
}

func (t *updatePeerTracker) finish(id string, transfer updateTransfer) {
	delete(t.transfers, id)
	message := platform.JSON{"type": "update-peer-cancel", "sessionId": id}
	transfer.seed.send(message, nil)
	transfer.receiver.send(message, nil)
}
