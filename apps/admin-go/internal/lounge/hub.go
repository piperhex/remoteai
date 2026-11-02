package lounge

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const maxQueuedBytes = 12 * 1024 * 1024

type peer struct {
	conn           *websocket.Conn
	queue          chan []byte
	done           chan struct{}
	once           sync.Once
	mu             sync.Mutex
	queued         int
	user           account
	expires        time.Time
	moderator      bool // Guarded by hub.mu, including live permission revocation.
	direct         bool
	receipts       bool
	groupAcks      bool
	avatarCache    bool
	avatarVersions map[string]string // Guarded by hub.mu; bounded by profileWatch.
	blocks         map[string]bool
	blockedBy      map[string]bool
	watching       map[string]bool
	presence       map[string]*bool
	profileWatch   map[string]bool
	presenceExpiry *time.Timer // Guarded by hub.mu.
}

type hub struct {
	attachmentPolicy func() (map[string]interface{}, error)
	policies         policyRepository
	key              []byte
	mu               sync.Mutex
	clients          map[*peer]bool
	clientsByUser    map[string]map[*peer]struct{}
	contactWatchers  map[string]map[*peer]struct{}
	closed           bool
	presenceCount    int
	relationships    relationshipRepository
	directPolicy     directPolicyRepository
	directKey        []byte
	settingsMu       sync.Mutex
	profiles         profileRepository
	names            nameRepository
	accountLookup    accountLookupRepository
	savedContacts    savedContactRepository
	notifications    notificationRepository
}

func newHub(key []byte) *hub {
	return &hub{key: key, clients: make(map[*peer]bool),
		clientsByUser: make(map[string]map[*peer]struct{}), contactWatchers: make(map[string]map[*peer]struct{})}
}

func (p *peer) stop() { p.once.Do(func() { close(p.done) }) }

func (p *peer) close() {
	p.stop()
	if p.conn != nil {
		// Closing an already broken socket is best effort; no connection or content is logged.
		_ = p.conn.Close()
	}
}

// Overflow must interrupt even a writer blocked in I/O without waiting under hub.mu.
func (p *peer) closeLater() {
	p.stop()
	go p.close()
}

func (p *peer) enqueue(data []byte) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	select {
	case <-p.done:
		return false
	default:
	}
	if p.queued+len(data) > maxQueuedBytes {
		p.closeLater()
		return false
	}
	select {
	case <-p.done:
		return false
	case p.queue <- data:
		p.queued += len(data)
		return true
	default:
		p.closeLater()
		return false
	}
}

func (p *peer) write() {
	defer p.close()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-p.done:
			return
		case data := <-p.queue:
			p.mu.Lock()
			p.queued -= len(data)
			p.mu.Unlock()
			if p.conn.SetWriteDeadline(time.Now().Add(10*time.Second)) != nil {
				return
			}
			if p.conn.WriteMessage(websocket.TextMessage, data) != nil {
				return
			}
		case <-ticker.C:
			if p.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)) != nil {
				return
			}
		}
	}
}

func (h *hub) broadcast(sender *peer, input incoming) {
	h.mu.Lock()
	defer h.mu.Unlock()
	profile := sender.user
	sentAt := time.Now().UTC().Format(time.RFC3339Nano)
	// Confirm validation before fan-out, without sending uploaded images back over the sender's connection.
	// Older clients still use their full message echo as confirmation.
	if sender.groupAcks {
		ack, err := json.Marshal(struct {
			Type        string       `json:"type"`
			ID          string       `json:"id"`
			SentAt      string       `json:"sentAt"`
			Attachments []attachment `json:"attachments,omitempty"`
		}{"accepted", input.ID, sentAt, input.Attachments})
		if err != nil {
			return
		}
		sender.enqueue(ack)
	}
	frames, err := encodeMessage(message{Type: "message", ID: input.ID, Sender: profile,
		Text: input.Text, Images: input.Images, Attachments: input.Attachments, Reply: input.Reply, SentAt: sentAt})
	if err != nil {
		return
	}
	// Only current authenticated connections receive this frame. There is no history, log, or replay store.
	for client, authenticated := range h.clients {
		if client == sender && sender.groupAcks {
			continue
		}
		if authenticated && client.expires.After(time.Now()) && !client.blocks[sender.user.ID] {
			client.enqueue(frames.forPeer(client))
		}
	}
}

func (h *hub) close() {
	h.mu.Lock()
	h.closed = true
	clients := make([]*peer, 0, len(h.clients))
	for client := range h.clients {
		client.stop()
		if client.presenceExpiry != nil {
			client.presenceExpiry.Stop()
		}
		clients = append(clients, client)
	}
	h.mu.Unlock()
	for _, client := range clients {
		client.close()
	}
}
