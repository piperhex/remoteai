package devices

import (
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func updatePeersFixture() (*ControlGateway, *peer, *peer) {
	g := newControlGateway(nil)
	g.updatePeers.native = platform.JSON{"servers": []string{"udp://127.0.0.1:11010"}, "stunServers": []string{}}
	seed, receiver := queuedPeer(), queuedPeer()
	g.sessions[seed] = controlSession{owner: "alice", device: "pc-a", kind: "device"}
	g.sessions[receiver] = controlSession{owner: "bob", device: "pc-b", kind: "device"}
	g.sockets["alice:pc-a"], g.sockets["bob:pc-b"] = seed, receiver
	return g, seed, receiver
}

func advertiseUpdate(g *ControlGateway, client *peer, artifact string) {
	g.receiveUpdatePeer(client, g.sessions[client], platform.JSON{
		"type": "update-peer-advertise", "artifacts": []interface{}{artifact},
	})
}

func findUpdate(g *ControlGateway, client *peer, artifact string) {
	g.receiveUpdatePeer(client, g.sessions[client], platform.JSON{
		"type": "update-peer-find", "requestId": "request-1", "artifact": artifact,
	})
}

func TestUpdatePeersMatchAcrossAccountsWithoutSharingIdentityOrMetadata(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	artifact := strings.Repeat("a", 64)
	advertiseUpdate(g, seed, artifact)
	findUpdate(g, receiver, artifact)
	host, client := updateFrame(t, seed), updateFrame(t, receiver)
	if host["type"] != "update-peer-offer" || client["artifact"] != artifact {
		t.Fatal("no cross-account match")
	}
	hostConfig := host["config"].(map[string]interface{})
	clientConfig := client["config"].(map[string]interface{})
	if hostConfig["sessionId"] != clientConfig["sessionId"] || hostConfig["secret"] != clientConfig["secret"] ||
		hostConfig["desktop"] != true || clientConfig["desktop"] != false {
		t.Fatal("invalid isolated grant")
	}
	if len(hostConfig["secret"].(string)) != 64 {
		t.Fatal("invalid secret")
	}
	for _, frame := range []platform.JSON{host, client} {
		for _, key := range []string{"owner", "deviceId", "accessToken", "url", "signature", "version"} {
			if _, exists := frame[key]; exists {
				t.Fatalf("leaked %s", key)
			}
		}
	}
}

func TestUpdatePeersRejectUnknownArtifactsSubscribersAndReplacedSockets(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	artifact := strings.Repeat("a", 64)
	advertiseUpdate(g, seed, "../package")
	if len(g.updatePeers.seeds) != 0 {
		t.Fatal("accepted path")
	}
	advertiseUpdate(g, seed, artifact)
	findUpdate(g, receiver, strings.Repeat("b", 64))
	if updateFrame(t, receiver)["type"] != "update-peer-unavailable" {
		t.Fatal("matched incorrect package")
	}
	subscriber := queuedPeer()
	g.sessions[subscriber] = controlSession{owner: "alice", kind: "subscriber"}
	advertiseUpdate(g, subscriber, artifact)
	findUpdate(g, subscriber, artifact)
	g.sockets["alice:pc-a"] = queuedPeer()
	advertiseUpdate(g, seed, strings.Repeat("c", 64))
	if len(g.updatePeers.seeds) != 1 || g.updatePeers.seeds[seed].artifacts[0] != artifact || len(subscriber.queue) != 0 {
		t.Fatal("non-current device socket participated")
	}
}

func TestUpdatePeersReleaseReservationsOnlyForParticipants(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	artifact := strings.Repeat("a", 64)
	advertiseUpdate(g, seed, artifact)
	findUpdate(g, receiver, artifact)
	updateFrame(t, seed)
	offer := updateFrame(t, receiver)
	id := offer["config"].(map[string]interface{})["sessionId"].(string)
	intruder := queuedPeer()
	g.sessions[intruder] = controlSession{owner: "eve", device: "pc-c", kind: "device"}
	g.sockets["eve:pc-c"] = intruder
	message := platform.JSON{"type": "update-peer-done", "sessionId": id}
	g.receiveUpdatePeer(intruder, g.sessions[intruder], message)
	if len(g.updatePeers.transfers) != 1 {
		t.Fatal("unrelated device canceled transfer")
	}
	g.receiveUpdatePeer(receiver, g.sessions[receiver], message)
	if len(g.updatePeers.transfers) != 0 || updateFrame(t, seed)["type"] != "update-peer-cancel" {
		t.Fatal("reservation was not released")
	}
	updateFrame(t, receiver)
	findUpdate(g, receiver, artifact)
	if updateFrame(t, receiver)["type"] != "update-peer-unavailable" {
		t.Fatal("lookup was not rate limited")
	}
}

func TestUpdatePeersExpiryDisconnectAndUploadLimit(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	artifact := strings.Repeat("a", 64)
	advertiseUpdate(g, seed, artifact)
	for index := 0; index < 2; index++ {
		g.updatePeers.transfers[string(rune('a'+index))] = updateTransfer{seed, queuedPeer(), time.Now().Add(time.Hour)}
	}
	findUpdate(g, receiver, artifact)
	if updateFrame(t, receiver)["type"] != "update-peer-unavailable" {
		t.Fatal("upload limit exceeded")
	}
	g.updatePeers.disconnect(seed)
	if len(g.updatePeers.seeds) != 0 || len(g.updatePeers.transfers) != 0 {
		t.Fatal("disconnect left reservations")
	}
	advertiseUpdate(g, seed, artifact)
	g.updatePeers.prune(time.Now().Add(updateSeedLifetime + time.Second))
	if len(g.updatePeers.seeds) != 0 {
		t.Fatal("expired seed remained available")
	}
}

func TestUpdatePeersNoTraversalConfigurationFallsBack(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	g.updatePeers.native = nil
	artifact := strings.Repeat("a", 64)
	advertiseUpdate(g, seed, artifact)
	findUpdate(g, receiver, artifact)
	if len(g.updatePeers.seeds) != 0 || updateFrame(t, receiver)["type"] != "update-peer-unavailable" {
		t.Fatal("unconfigured traversal did not immediately decline")
	}
}

func TestMobileUpdatePeersReceiveThreeDistinctSeedsAndPreferOwnAccount(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	artifact := strings.Repeat("a", 64)
	g.sessions[receiver] = controlSession{owner: "bob", kind: "subscriber", expires: time.Now().Add(time.Hour)}
	for _, owner := range []string{"alice", "bob", "carol", "dave"} {
		client := queuedPeer()
		g.sessions[client] = controlSession{owner: owner, device: owner, kind: "device"}
		g.sockets[owner+":"+owner] = client
		g.receiveUpdatePeer(client, g.sessions[client], platform.JSON{"type": "update-peer-advertise",
			"artifacts": []interface{}{artifact}, "ranges": true})
	}
	// A legacy seed cannot honor range requests and must not receive a multi-source offer.
	advertiseUpdate(g, seed, artifact)
	g.receiveUpdatePeer(receiver, g.sessions[receiver], platform.JSON{"type": "update-peer-find",
		"requestId": "multi", "artifact": artifact, "maxPeers": float64(3)})
	message := updateFrame(t, receiver)
	configs := message["configs"].([]interface{})
	if message["type"] != "update-peer-offers" || len(configs) != 3 || len(seed.queue) != 0 {
		t.Fatal("expected three compatible PC sources")
	}
	seen := map[string]bool{}
	for index, value := range configs {
		id := value.(map[string]interface{})["sessionId"].(string)
		if seen[id] {
			t.Fatal("duplicate session grant")
		}
		seen[id] = true
		transfer := g.updatePeers.transfers[id]
		if index == 0 && g.sessions[transfer.seed].owner != "bob" {
			t.Fatal("own PC was not preferred")
		}
	}
	advertiseUpdate(g, receiver, artifact)
	if _, published := g.updatePeers.seeds[receiver]; published {
		t.Fatal("mobile published a seed")
	}
	g.disconnect(receiver)
	if len(g.updatePeers.transfers) != 0 {
		t.Fatal("mobile disconnect left reservations")
	}
}

func TestExpiredMobileSessionCannotDownloadOrAdvertise(t *testing.T) {
	g, seed, receiver := updatePeersFixture()
	artifact := strings.Repeat("a", 64)
	advertiseUpdate(g, seed, artifact)
	g.sessions[receiver] = controlSession{owner: "bob", kind: "subscriber", expires: time.Now().Add(-time.Second)}
	findUpdate(g, receiver, artifact)
	advertiseUpdate(g, receiver, artifact)
	if len(receiver.queue) != 0 || len(g.updatePeers.transfers) != 0 {
		t.Fatal("expired session participated")
	}
}
