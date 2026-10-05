package devices

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
)

var errRelaySkipped = errors.New("relay frame skipped")

type relayDelivery struct {
	owner, sessionID string
	source, target   *peer
	traffic          *sessionTraffic
	fromDesktop      bool
	device           string
}

type sessionTraffic struct {
	upload, download atomic.Int64
}

func (stats *sessionTraffic) snapshot(id string) platform.JSON {
	return platform.JSON{"type": "relay-traffic", "sessionId": id,
		"uploadBytes": stats.upload.Load(), "downloadBytes": stats.download.Load()}
}

// Client labels are display hints only; ownership always comes from the authenticated identity.
func chatClientInfo(value interface{}) platform.JSON {
	info, _ := value.(map[string]interface{})
	result := platform.JSON{}
	for _, key := range []string{"name", "platform"} {
		text, _ := info[key].(string)
		text = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, text)
		chars := []rune(strings.TrimSpace(text))
		if len(chars) > 80 {
			chars = chars[:80]
		}
		result[key] = string(chars)
	}
	return result
}

func withChatClientInfo(frame platform.JSON, value interface{}) platform.JSON {
	info := chatClientInfo(value)
	if info["name"] != "" || info["platform"] != "" {
		frame["clientInfo"] = info
	}
	return frame
}

func (g *ChatGateway) deliverRelay(delivery relayDelivery, frame platform.JSON) {
	sent := func(bytes int) {
		g.traffic.record(bytes)
		if delivery.fromDesktop {
			delivery.traffic.upload.Add(int64(bytes))
		} else {
			delivery.traffic.download.Add(int64(bytes))
		}
	}
	guard := func(bytes int, write func() error) error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*heartbeatInterval)
		defer cancel()
		err := g.meter.Transmit(ctx, delivery.owner, bytes, write)
		if err == nil {
			return nil
		}
		if !errors.Is(err, chattraffic.ErrQuota) {
			slog.Warn("relay accounting unavailable", "error", err)
		}
		message := platform.JSON{"type": "relay-quota", "sessionId": delivery.sessionID, "blocked": true,
			"reason": "quota"}
		if !errors.Is(err, chattraffic.ErrQuota) {
			message["reason"] = "unavailable"
		}
		delivery.source.send(message, nil)
		delivery.target.send(message, nil)
		return errRelaySkipped
	}
	if frame["type"] == "bulk" {
		data, err := encodeBulkRelay(frame)
		if err != nil {
			delivery.source.close(4001, "Invalid download record")
			return
		}
		output := outputFrame{bytes: data, sent: sent, guard: guard}
		if g.bulkMeter != nil {
			output.lease = &bulkWriter{meter: g.bulkMeter, session: delivery.sessionID, scope: chattraffic.BulkLeaseScope{
				Owner: delivery.owner, Device: delivery.device, Writer: delivery.target.writerID},
				failure: func() {
					message := platform.JSON{"type": "relay-quota", "sessionId": delivery.sessionID,
						"blocked": true, "reason": "unavailable"}
					delivery.source.send(message, nil)
					delivery.target.send(message, nil)
				}}
		}
		delivery.target.sendBulk(output, delivery.owner)
		return
	}
	delivery.target.sendGuarded(frame, sent, guard)
}

func (g *ChatGateway) publishTraffic() {
	type connection struct {
		client *peer
		owner  string
	}
	g.mu.Lock()
	clients := []connection{}
	for client, state := range g.connections {
		if state.identity != nil {
			clients = append(clients, connection{client, state.identity.owner})
		}
	}
	g.mu.Unlock()
	usage := map[string]chattraffic.Usage{}
	for _, client := range clients {
		value, found := usage[client.owner]
		if !found {
			var err error
			value, err = chattraffic.ReadUsage(g.service.deps.DB, client.owner, time.Now())
			if err != nil {
				continue
			}
			usage[client.owner] = value
		}
		client.client.send(platform.JSON{"type": "relay-usage", "usage": value}, nil)
	}
	g.sessions.publishTraffic()
}

func (s *chatSessions) publishTraffic() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, session := range s.sessions {
		session.desktop.send(session.traffic.snapshot(session.id), nil)
	}
	for _, session := range s.hot.sessions {
		session.desktop.socket.send(session.traffic.snapshot(session.id), nil)
	}
}
