package devices

import (
	"bytes"
	"errors"
	"io"

	"github.com/gorilla/websocket"
)

// Identify bulk before buffering its payload. WebSocket's legacy control-message ceiling is
// intentionally larger; it must not permit a bulk sender to allocate a control-sized buffer.
func readChatPayload(client *peer, kind int, reader io.Reader) ([]byte, error) {
	limit := int64(chatFrameLimit)
	var prefix []byte
	if kind == websocket.BinaryMessage {
		prefix = make([]byte, relayHeaderBytes)
		if _, err := io.ReadFull(reader, prefix); err != nil {
			return nil, err
		}
		if string(prefix[:4]) == bulkRelayMagic {
			if !client.binaryBulk.Load() || prefix[4] == 0 || prefix[4] > 128 {
				return nil, errors.New("unnegotiated bulk frame")
			}
			limit = int64(bulkRecordLimit + int(prefix[4]))
		} else {
			limit -= int64(len(prefix))
		}
	}
	payload, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, errors.New("chat frame is too large")
	}
	return bytes.Join([][]byte{prefix, payload}, nil), nil
}
