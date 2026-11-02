package devices

import (
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func joinRecoveringAttachment(t *testing.T, sessions *chatSessions, owner string) *peer {
	t.Helper()
	client := queuedPeer()
	identity := loungeIdentity(owner)
	identity.device = "new-device"
	if err := sessions.join(client, identity, platform.JSON{"publicKey": strings.Repeat("ab", 32),
		"purpose": "attachments", "attachmentRecovery": true}, nil); err != nil {
		t.Fatal(err)
	}
	updateFrame(t, client)
	return client
}

func requestHistoricalAttachment(t *testing.T, sessions *chatSessions, target *peer) {
	t.Helper()
	if err := sessions.pairAttachment(target, platform.JSON{"id": "request", "owner": "alice",
		"device": "old-device", "fileId": "historical-image"}, nil); err != nil {
		t.Fatal(err)
	}
}

func TestHistoricalAttachmentFindsOnlyAuthorizedSenderWithCachedBytes(t *testing.T) {
	sessions := newChatSessions(nil)
	missing := joinRecoveringAttachment(t, sessions, "alice")
	source := joinRecoveringAttachment(t, sessions, "alice")
	outsider := joinRecoveringAttachment(t, sessions, "charlie")
	target := joinAttachment(t, sessions, "bob")
	history := joinHistory(t, sessions, "alice")
	// Drain same-account history pairs, if any; attachment sockets must never participate.
	if len(history.queue) != 0 {
		t.Fatal("attachment sockets joined history")
	}
	requestHistoricalAttachment(t, sessions, target)
	query := updateFrame(t, source)
	if query["type"] != "attachment-locate" || query["fileId"] != "historical-image" || len(outsider.queue) != 0 {
		t.Fatal("invalid recovery scope", query)
	}
	updateFrame(t, missing)
	reply := platform.JSON{"id": query["id"], "available": true}
	if err := sessions.attachmentAvailable(outsider, reply); err != nil || len(sessions.sessions) != 0 {
		t.Fatal("unrelated source supplied an image", err)
	}
	if err := sessions.attachmentAvailable(missing, platform.JSON{"id": query["id"], "available": false}); err != nil {
		t.Fatal(err)
	}
	if err := sessions.attachmentAvailable(source, reply); err != nil {
		t.Fatal(err)
	}
	left, right := updateFrame(t, source), updateFrame(t, target)
	if left["sessionId"] != right["sessionId"] || left["fileId"] != "historical-image" || len(sessions.attachments) != 0 {
		t.Fatal("historical image was not paired", left, right)
	}
	if err := sessions.attachmentAvailable(source, reply); err != nil || len(sessions.sessions) != 1 {
		t.Fatal("late reply revived a completed search", err)
	}
}

func TestHistoricalAttachmentMissingOrDisconnectedSourcesAllowRetry(t *testing.T) {
	for _, disconnect := range []bool{false, true} {
		sessions := newChatSessions(nil)
		source := joinRecoveringAttachment(t, sessions, "alice")
		target := joinAttachment(t, sessions, "bob")
		requestHistoricalAttachment(t, sessions, target)
		query := updateFrame(t, source)
		if disconnect {
			sessions.disconnect(source, false)
		} else if err := sessions.attachmentAvailable(source,
			platform.JSON{"id": query["id"], "available": false}); err != nil {
			t.Fatal(err)
		}
		if frame := updateFrame(t, target); frame["type"] != "attachment-unavailable" || len(sessions.attachments) != 0 {
			t.Fatal(frame)
		}
	}
}

func TestHistoricalAttachmentSearchIsBoundedAndCancelledWithViewer(t *testing.T) {
	sessions := newChatSessions(nil)
	source := joinRecoveringAttachment(t, sessions, "alice")
	target := joinAttachment(t, sessions, "bob")
	for range maxLoungeDevices {
		requestHistoricalAttachment(t, sessions, target)
		updateFrame(t, source)
	}
	requestHistoricalAttachment(t, sessions, target)
	if frame := updateFrame(t, target); frame["type"] != "attachment-unavailable" {
		t.Fatal(frame)
	}
	sessions.disconnect(target, false)
	if len(sessions.attachments) != 0 {
		t.Fatal("disconnected viewer retained searches")
	}
}

func TestHistoricalAttachmentRejectsExpiredSourceReply(t *testing.T) {
	sessions := newChatSessions(nil)
	source := joinRecoveringAttachment(t, sessions, "alice")
	target := joinAttachment(t, sessions, "bob")
	requestHistoricalAttachment(t, sessions, target)
	query := updateFrame(t, source)
	info := sessions.lounge[source]
	info.identity.expires = time.Now().Add(-time.Second)
	sessions.lounge[source] = info
	if err := sessions.attachmentAvailable(source, platform.JSON{"id": query["id"], "available": true}); err != nil {
		t.Fatal(err)
	}
	if frame := updateFrame(t, target); frame["type"] != "attachment-unavailable" || len(sessions.sessions) != 0 {
		t.Fatal(frame)
	}
}

func TestHistoricalAttachmentSearchTimesOutWithoutRetainingCandidates(t *testing.T) {
	sessions := newChatSessions(nil)
	source := joinRecoveringAttachment(t, sessions, "alice")
	target := joinAttachment(t, sessions, "bob")
	requestHistoricalAttachment(t, sessions, target)
	query := updateFrame(t, source)
	id := query["id"].(string)
	sessions.mu.Lock()
	sessions.attachments[id].timer.Reset(time.Millisecond)
	sessions.mu.Unlock()
	select {
	case frame := <-target.queue:
		if !strings.Contains(string(frame.bytes), `"attachment-unavailable"`) {
			t.Fatal(string(frame.bytes))
		}
	case <-time.After(time.Second):
		t.Fatal("attachment search did not time out")
	}
	sessions.mu.Lock()
	defer sessions.mu.Unlock()
	if len(sessions.attachments) != 0 {
		t.Fatal("timed-out search retained candidates")
	}
}
