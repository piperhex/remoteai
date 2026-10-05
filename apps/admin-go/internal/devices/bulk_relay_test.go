package devices

import (
	"bytes"
	"encoding/binary"
	"io"
	"sync"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

func bulkRecord(length int) []byte {
	record := make([]byte, bulkRecordHeader+length+bulkRecordTag)
	copy(record, "RAB1\x01\x01\x00\x48")
	binary.BigEndian.PutUint32(record[64:68], uint32(length))
	binary.BigEndian.PutUint32(record[68:72], 1)
	return record
}

func TestBulkReaderRejectsOversizeBeforeAllocatingLegacyMessageBuffers(t *testing.T) {
	client := &peer{}
	client.binaryBulk.Store(true)
	reader := bytes.NewReader(append([]byte("CSF1\x01s"), make([]byte, bulkRecordLimit+1000)...))
	if _, err := readChatPayload(client, websocket.BinaryMessage, reader); err == nil {
		t.Fatal("oversized bulk")
	}
	if reader.Len() < 990 {
		t.Fatal("buffered oversized payload before validating bulk length")
	}
	client.binaryBulk.Store(false)
	reader = bytes.NewReader([]byte("CSF1\x01s"))
	if _, err := readChatPayload(client, websocket.BinaryMessage, reader); err == nil {
		t.Fatal("unnegotiated bulk")
	}
	remaining, _ := io.ReadAll(reader)
	if string(remaining) != "s" {
		t.Fatal("read unnegotiated payload")
	}
}

func TestBulkRelayRequiresCapabilityAndPreservesBinaryPayload(t *testing.T) {
	record := bulkRecord(bulkRecordLimit - bulkRecordHeader - bulkRecordTag)
	encoded, err := encodeBulkRelay(platform.JSON{"sessionId": "session-1", "payload": record})
	if err != nil {
		t.Fatal(err)
	}
	client := &peer{}
	client.binaryRelay.Store(true)
	if _, err := readChatFrame(client, websocket.BinaryMessage, encoded); err == nil {
		t.Fatal("accepted unnegotiated bulk")
	}
	client.binaryBulk.Store(true)
	decoded, err := readChatFrame(client, websocket.BinaryMessage, encoded)
	if err != nil || decoded["type"] != "bulk" || !bytes.Equal(decoded["payload"].([]byte), record) {
		t.Fatal(decoded, err)
	}
	for _, invalid := range [][]byte{encoded[:5], encoded[:len(encoded)-1], append(encoded, 0)} {
		if _, err := decodeBulkRelay(invalid); err == nil {
			t.Fatal("accepted invalid length")
		}
	}
}

func TestBulkRecordRejectsInvalidOffsetsAndSequence(t *testing.T) {
	for _, offset := range []int{0, 4, 5, 6, 64, 71} {
		record := bulkRecord(1)
		record[offset] ^= 1
		if validBulkRecord(record) {
			t.Fatalf("accepted invalid header byte %d", offset)
		}
	}
	record := bulkRecord(1)
	binary.BigEndian.PutUint32(record[60:64], 0xffffffff)
	if validBulkRecord(record) {
		t.Fatal("accepted overflowing fragment")
	}
}

func TestBulkQueuesShareAccountBudgetAndReleaseExactlyOnce(t *testing.T) {
	owner := "bulk-budget-test"
	var releases []func()
	for i := 0; i < bulkAccountQueue/bulkRecordLimit; i++ {
		release, ok := reserveBulkQueue(owner, bulkRecordLimit)
		if !ok {
			t.Fatal("budget unexpectedly exhausted")
		}
		releases = append(releases, release)
	}
	if _, ok := reserveBulkQueue(owner, 1); ok {
		t.Fatal("exceeded account cap")
	}
	var workers sync.WaitGroup
	for _, release := range releases {
		workers.Add(1)
		go func() { defer workers.Done(); release(); release() }()
	}
	workers.Wait()
	bulkQueues.Lock()
	defer bulkQueues.Unlock()
	if bulkQueues.accounts[owner] != 0 {
		t.Fatal("leaked queue budget")
	}
}

func TestBulkDrainReleasesQueuedMemory(t *testing.T) {
	client := &peer{bulkQueue: make(chan outputFrame, 2)}
	client.binaryBulk.Store(true)
	client.sendBulk(outputFrame{bytes: bulkRecord(1)}, "bulk-drain-test")
	if client.bulkBuffered.Load() == 0 {
		t.Fatal("did not reserve queue bytes")
	}
	client.drainBulk()
	if client.bulkBuffered.Load() != 0 {
		t.Fatal("leaked connection bytes")
	}
}
