package devices

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const heartbeatInterval = 25 * time.Second
const authTimeout = 10 * time.Second
const chatBufferLimit = 2 * 1024 * 1024

type outputFrame struct {
	sourceDone <-chan struct{}
	lease      *bulkWriter
	release    func()
	kind       int
	bytes      []byte
	sent       func(int)
	guard      func(int, func() error) error
}
type peer struct {
	writerID     string
	pendingBulk  *outputFrame
	serviceHost  atomic.Bool
	binaryRelay  atomic.Bool
	binaryBulk   atomic.Bool
	bulkBuffered atomic.Int64
	bulkQueue    chan outputFrame
	bulkQueueMu  sync.Mutex
	diagnostics  *chatDiagnostics
	conn         *websocket.Conn
	queue        chan outputFrame
	done         chan struct{}
	closeOnce    sync.Once
	buffered     atomic.Int64
	alive        atomic.Bool
	closed       atomic.Bool
}

var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

func newPeer(conn *websocket.Conn) *peer {
	return newPeerWithDiagnostics(conn, nil)
}

func newPeerWithDiagnostics(conn *websocket.Conn, diagnostics *chatDiagnostics) *peer {
	client := &peer{conn: conn, diagnostics: diagnostics, writerID: uuid.NewString(),
		queue: make(chan outputFrame, 1024), done: make(chan struct{})}
	client.bulkQueue = make(chan outputFrame, 32)
	client.alive.Store(true)
	conn.SetPongHandler(func(string) error { client.alive.Store(true); return nil })
	go client.writeLoop()
	return client
}

func (p *peer) send(value interface{}, sent func(int)) {
	p.sendGuarded(value, sent, nil)
}

func (p *peer) sendGuarded(value interface{}, sent func(int), guard func(int, func() error) error) {
	if p == nil || p.closed.Load() {
		return
	}
	if p.buffered.Load() > chatBufferLimit {
		p.close(4008, "Connection is too slow")
		return
	}
	kind, data, err := p.encodeFrame(value)
	if err != nil {
		p.close(4001, "Invalid message")
		return
	}
	p.buffered.Add(int64(len(data)))
	select {
	case p.queue <- outputFrame{kind: kind, bytes: data, sent: sent, guard: guard}:
		p.diagnostics.queued(value)
	default:
		p.buffered.Add(-int64(len(data)))
		p.close(4008, "Connection is too slow")
	}
}

func (p *peer) encodeFrame(value interface{}) (int, []byte, error) {
	if p.binaryRelay.Load() {
		if data, ok := encodeRelay(value); ok {
			return websocket.BinaryMessage, data, nil
		}
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(platform.JSONValue(value))
	return websocket.TextMessage, bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), err
}

func (p *peer) writeLoop() {
	timer := time.NewTicker(heartbeatInterval)
	defer timer.Stop()
	defer p.drainBulk()
	for {
		// Control/RPC frames take priority over the next bounded file record.
		select {
		case frame := <-p.queue:
			if !p.writeQueued(frame, false) {
				return
			}
			continue
		default:
		}
		if p.pendingBulk != nil {
			frame := *p.pendingBulk
			p.pendingBulk = nil
			if !p.writeQueued(frame, true) {
				return
			}
			continue
		}
		select {
		case <-p.done:
			return
		case frame := <-p.queue:
			if !p.writeQueued(frame, false) {
				return
			}
		case frame := <-p.bulkQueue:
			if !p.writeQueued(frame, true) {
				return
			}
		case <-timer.C:
			if !p.alive.Swap(false) {
				p.diagnostics.log("chat websocket heartbeat timeout")
				p.terminate()
				return
			}
			if err := p.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(time.Second)); err != nil {
				p.terminate()
				return
			}
		}
	}
}

func (p *peer) writeFrame(frame outputFrame) error {
	write := func() error {
		// Start the network timeout after any wait for accounting storage or a fresh quota grant.
		if err := p.conn.SetWriteDeadline(time.Now().Add(heartbeatInterval)); err != nil {
			return err
		}
		return p.conn.WriteMessage(frame.kind, frame.bytes)
	}
	var err error
	if frame.guard != nil {
		err = frame.guard(len(frame.bytes), write)
	} else {
		err = write()
	}
	if errors.Is(err, errRelaySkipped) {
		return nil
	}
	if err == nil && frame.sent != nil {
		frame.sent(len(frame.bytes))
	}
	return err
}

func (p *peer) writeQueued(frame outputFrame, bulk bool) bool {
	if bulk && frame.lease != nil {
		return p.writeBulkBatch(frame)
	}
	if frame.release != nil {
		defer frame.release()
	}
	err := p.writeFrame(frame)
	if !bulk {
		p.buffered.Add(-int64(len(frame.bytes)))
	}
	if err != nil {
		p.diagnostics.log("chat write failed")
		p.terminate()
		return false
	}
	return true
}

func (p *peer) drainBulk() {
	p.bulkQueueMu.Lock()
	defer p.bulkQueueMu.Unlock()
	if p.pendingBulk != nil {
		p.pendingBulk.release()
		p.pendingBulk = nil
	}
	for {
		select {
		case frame := <-p.bulkQueue:
			if frame.release != nil {
				frame.release()
			}
		default:
			return
		}
	}
}

func (p *peer) close(code int, reason string) {
	p.closeOnce.Do(func() {
		p.closed.Store(true)
		close(p.done)
		// Callers may own a gateway/session lock. Mark closed immediately and perform
		// the bounded close handshake separately, at most once per connection.
		go func() {
			p.diagnostics.close(code, reason)
			// A failed close frame still requires releasing the underlying socket.
			_ = p.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
			_ = p.conn.Close()
		}()
	})
}

func (p *peer) terminate() {
	p.closeOnce.Do(func() {
		p.diagnostics.close(1006, "transport closed")
		p.closed.Store(true)
		_ = p.conn.Close()
		close(p.done)
	})
}

func parseObject(data []byte) (platform.JSON, error) {
	var object platform.JSON
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, err
	}
	if object == nil {
		return nil, errors.New("invalid message")
	}
	return object, nil
}

func socketIdentity(deps *platform.Dependencies, token string) (string, time.Time, error) {
	secret := strings.TrimSpace(deps.Config.Get("KONG_JWT_SECRET", ""))
	if secret == "" {
		secret = "change-me-kong-jwt-secret"
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (interface{}, error) { return []byte(secret), nil },
		jwt.WithValidMethods([]string{"HS256", "HS384", "HS512"}))
	if err != nil {
		return "", time.Time{}, err
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return "", time.Time{}, errors.New("invalid subject")
	}
	var count int64
	if err := deps.DB.Table("users").Where("id = ? AND disabled = false", sub).Count(&count).Error; err != nil {
		return "", time.Time{}, err
	}
	if count != 1 {
		return "", time.Time{}, errors.New("user is unavailable")
	}
	expires := time.Time{}
	if date, _ := claims.GetExpirationTime(); date != nil {
		expires = date.Time
	}
	return sub, expires, nil
}
