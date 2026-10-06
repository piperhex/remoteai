package devices

import (
	"encoding/binary"
	"errors"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

const bulkRelayMagic = "CSF1"
const bulkRecordHeader = 72
const bulkRecordTag = 16
const bulkRecordLimit = 16 * 1024
const bulkConnectionQueue = 256 * 1024
const bulkAccountQueue = 2 * 1024 * 1024
const bulkInstanceQueue = 32 * 1024 * 1024
const bulkQueueWaitTimeout = 5 * time.Second

var bulkQueues = struct {
	sync.Mutex
	total    int
	accounts map[string]int
	changed  chan struct{}
}{accounts: map[string]int{}, changed: make(chan struct{})}

func forwardPayload(message platform.JSON, target *peer) (interface{}, bool) {
	if message["type"] != "bulk" {
		return relayPayload(message["payload"])
	}
	bytes, ok := message["payload"].([]byte)
	return bytes, ok && target != nil && target.binaryBulk.Load() && validBulkRecord(bytes)
}

func validBulkRecord(record []byte) bool {
	if len(record) <= bulkRecordHeader+bulkRecordTag || len(record) > bulkRecordLimit ||
		string(record[:8]) != "RAB1\x01\x01\x00\x48" {
		return false
	}
	length := binary.BigEndian.Uint32(record[64:68])
	offset := binary.BigEndian.Uint32(record[60:64])
	return int(length)+bulkRecordHeader+bulkRecordTag == len(record) &&
		uint64(offset)+uint64(length) <= 1024*1024 && binary.BigEndian.Uint32(record[68:72]) > 0
}

func decodeBulkRelay(data []byte) (platform.JSON, error) {
	if len(data) <= relayHeaderBytes || string(data[:4]) != bulkRelayMagic {
		return nil, errors.New("invalid bulk relay")
	}
	length := int(data[4])
	end := relayHeaderBytes + length
	if length == 0 || length > 128 || end >= len(data) || !validBulkRecord(data[end:]) {
		return nil, errors.New("invalid bulk relay length")
	}
	id, err := identifier(string(data[relayHeaderBytes:end]))
	if err != nil {
		return nil, err
	}
	return platform.JSON{"type": "bulk", "sessionId": id, "payload": data[end:]}, nil
}

func encodeBulkRelay(frame platform.JSON) ([]byte, error) {
	id, err := identifier(frame["sessionId"])
	record, ok := frame["payload"].([]byte)
	if err != nil || !ok || !validBulkRecord(record) {
		return nil, errors.New("invalid bulk relay")
	}
	data := append([]byte(bulkRelayMagic), byte(len(id)))
	data = append(data, id...)
	return append(data, record...), nil
}

func reserveBulkQueue(owner string, bytes int) (func(), bool) {
	bulkQueues.Lock()
	defer bulkQueues.Unlock()
	if bulkQueues.total+bytes > bulkInstanceQueue || bulkQueues.accounts[owner]+bytes > bulkAccountQueue {
		return nil, false
	}
	bulkQueues.total += bytes
	bulkQueues.accounts[owner] += bytes
	var once sync.Once
	return func() {
		once.Do(func() {
			bulkQueues.Lock()
			defer bulkQueues.Unlock()
			bulkQueues.total -= bytes
			bulkQueues.accounts[owner] -= bytes
			if bulkQueues.accounts[owner] == 0 {
				delete(bulkQueues.accounts, owner)
			}
			close(bulkQueues.changed)
			bulkQueues.changed = make(chan struct{})
		})
	}, true
}

func (p *peer) sendBulk(frame outputFrame, owner string) {
	if p == nil {
		return
	}
	timer := time.NewTimer(bulkQueueWaitTimeout)
	defer timer.Stop()
	for {
		select {
		case <-frame.sourceDone:
			return
		default:
		}
		// Subscribe before checking capacity so a concurrent release cannot be missed.
		bulkQueues.Lock()
		changed := bulkQueues.changed
		bulkQueues.Unlock()
		if p.trySendBulk(frame, owner) {
			return
		}
		// Waiting in the source reader propagates TCP backpressure without another frame queue.
		select {
		case <-changed:
		case <-p.done:
			return
		case <-frame.sourceDone:
			return
		case <-timer.C:
			p.close(4008, "Download receiver stalled")
			return
		}
	}
}

func (p *peer) trySendBulk(frame outputFrame, owner string) bool {
	p.bulkQueueMu.Lock()
	defer p.bulkQueueMu.Unlock()
	if p.closed.Load() || !p.binaryBulk.Load() {
		return true
	}
	bytes := int64(len(frame.bytes))
	if p.bulkBuffered.Load()+bytes > bulkConnectionQueue || len(p.bulkQueue) == cap(p.bulkQueue) {
		return false
	}
	release, ok := reserveBulkQueue(owner, len(frame.bytes))
	if !ok {
		return false
	}
	p.bulkBuffered.Add(bytes)
	var once sync.Once
	frame.release = func() { once.Do(func() { p.bulkBuffered.Add(-bytes); release() }) }
	frame.kind = websocket.BinaryMessage
	// Producers share bulkQueueMu; the writer can only free slots after the capacity check.
	p.bulkQueue <- frame
	return true
}
