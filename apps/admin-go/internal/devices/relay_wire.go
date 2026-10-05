package devices

import (
	"encoding/hex"
	"errors"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

const relayMagic = "CSB1"
const relayHeaderBytes = len(relayMagic) + 1
const maxRelayPayloadBytes = 20000

func readChatFrame(client *peer, kind int, data []byte) (platform.JSON, error) {
	if kind == websocket.TextMessage {
		return parseObject(data)
	}
	if kind == websocket.BinaryMessage && client.binaryRelay.Load() {
		if len(data) >= len(bulkRelayMagic) && string(data[:4]) == bulkRelayMagic {
			if !client.binaryBulk.Load() {
				return nil, errors.New("bulk not negotiated")
			}
			return decodeBulkRelay(data)
		}
		return decodeRelay(data)
	}
	return nil, errors.New("unsupported chat frame")
}

// Binary envelopes only change a WebSocket hop, never encryption or session authorization.
func decodeRelay(data []byte) (platform.JSON, error) {
	if len(data) <= relayHeaderBytes || string(data[:len(relayMagic)]) != relayMagic {
		return nil, errors.New("invalid binary relay")
	}
	length := int(data[len(relayMagic)])
	end := relayHeaderBytes + length
	if length == 0 || length > 128 || end >= len(data) || len(data)-end > maxRelayPayloadBytes {
		return nil, errors.New("invalid binary relay length")
	}
	id, err := identifier(string(data[relayHeaderBytes:end]))
	if err != nil {
		return nil, err
	}
	return platform.JSON{"type": "relay", "sessionId": id, "payload": hex.EncodeToString(data[end:])}, nil
}

func encodeRelay(value interface{}) ([]byte, bool) {
	frame, ok := value.(platform.JSON)
	if !ok || frame["type"] != "relay" {
		return nil, false
	}
	id, err := identifier(frame["sessionId"])
	if err != nil {
		return nil, false
	}
	text, ok := relayPayload(frame["payload"])
	if !ok {
		return nil, false
	}
	payload, err := hex.DecodeString(text)
	if err != nil || len(payload) == 0 {
		return nil, false
	}
	data := append([]byte(relayMagic), byte(len(id)))
	data = append(data, id...)
	return append(data, payload...), true
}
