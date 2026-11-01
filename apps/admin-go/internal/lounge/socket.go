package lounge

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	HandshakeTimeout: 10 * time.Second,
	// Browser and Tauri origins vary; a ticket in the first frame is required before joining.
	CheckOrigin: func(*http.Request) bool { return true },
}

func (h *hub) serve(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	client := &peer{conn: conn, queue: make(chan []byte, 32), done: make(chan struct{})}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		client.close()
		return
	}
	h.clients[client] = false
	h.mu.Unlock()
	defer h.remove(client)
	conn.SetReadLimit(16 * 1024)
	if conn.SetReadDeadline(time.Now().Add(10*time.Second)) != nil {
		return
	}
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	go client.write()
	h.read(client)
}

func (h *hub) read(client *peer) {
	window, count, receiptCount, bytes := time.Now(), 0, 0, 0
	for {
		kind, data, err := client.conn.ReadMessage()
		if err != nil || kind != websocket.TextMessage {
			return
		}
		if time.Since(window) >= 10*time.Second {
			window, count, receiptCount, bytes = time.Now(), 0, 0, 0
		}
		bytes += len(data)
		if bytes > 2*maxFrameBytes {
			return
		}
		var input incoming
		if json.Unmarshal(data, &input) != nil {
			return
		}
		if input.Type == "receipt" || input.Type == "receipt-confirm" {
			receiptCount++
		} else {
			count++
		}
		if count > 30 || receiptCount > 240 {
			return
		}
		if !h.receive(client, input) {
			return
		}
		if client.conn.SetReadDeadline(time.Now().Add(60*time.Second)) != nil {
			return
		}
	}
}

func (h *hub) receive(client *peer, input incoming) bool {
	if input.Type == "authenticate" {
		return h.authorize(client, input)
	}
	if client.user.ID == "" || !client.expires.After(time.Now()) {
		return false
	}
	switch input.Type {
	case "ping":
		client.enqueue([]byte(`{"type":"pong"}`))
		return true
	case "profile-watch":
		return h.watchProfiles(client, input.Watch)
	case "watch":
		return h.watch(client, input.Watch)
	case "sync-contacts":
		return h.syncSavedContacts(client, input)
	case "receipt", "receipt-confirm":
		return h.forwardReceipt(client, input)
	case "message":
		return h.receiveMessage(client, input)
	default:
		return h.receiveAction(client, input)
	}
}

func (h *hub) receiveAction(client *peer, input incoming) bool {
	if len(input.ID) == 0 || len(input.ID) > 80 {
		return false
	}
	switch input.Type {
	case "avatar":
		h.saveAvatar(client, input)
	case "notification-setting":
		h.saveNotificationSetting(client, input)
	case "nickname":
		h.saveNickname(client, input)
	case "remark":
		h.saveRemark(client, input)
	case "moderate":
		h.moderate(client, input)
	case "block":
		h.block(client, input)
	case "delete-direct":
		h.deleteDirect(client, input)
	case "lookup-account":
		h.lookupAccount(client, input)
	default:
		return false
	}
	return true
}

func (h *hub) receiveMessage(client *peer, input incoming) bool {
	if validate(input) != nil {
		return false
	}
	if h.maySend(client, input.ID) {
		if err := h.prepareAttachments(client, &input); err != nil {
			h.reject(client, input.ID, "client.lounge.attachmentLimit")
			return true
		}
		if input.To != "" {
			h.direct(client, input)
		} else {
			h.broadcast(client, input)
		}
	}
	return true
}

func (h *hub) authorize(client *peer, input incoming) bool {
	user, expires, err := h.authenticate(input.Ticket)
	if err != nil || (client.user.ID != "" && user.ID != client.user.ID) {
		return false
	}
	value, err := h.userPolicy(user.ID)
	if err != nil {
		return false
	}
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	privacy, err := h.readRelationships(user.ID)
	if err != nil {
		return false
	}
	profiles, err := h.readProfiles([]string{user.ID})
	if err != nil {
		return false
	}
	if len(profiles) != 0 {
		user.Avatar = profiles[0].Avatar
	}
	if h.readNickname(&user) != nil {
		return false
	}
	muted, err := h.mutedConversations(user.ID)
	if err != nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false
	}
	client.user, client.expires = user, expires
	client.user.Moderator = value.Moderator
	client.moderator = value.Moderator
	client.direct = input.Direct
	client.receipts = input.Receipts
	client.groupAcks = input.GroupAcks
	client.applyRelationships(privacy)
	h.clients[client] = true
	h.indexContactPeerLocked(client)
	h.scheduleContactExpiryLocked(client)
	if !h.sendReadyLocked(client, value, privacy, muted) {
		return false
	}
	h.publishPresenceLocked(client)
	h.refreshContactPresenceLocked(client)
	h.publishContactPresenceLocked(user.ID)
	client.conn.SetReadLimit(maxFrameBytes)
	return true
}

func (h *hub) sendReadyLocked(client *peer, value policy, privacy relationships, muted []string) bool {
	data, err := json.Marshal(struct {
		Type                 string    `json:"type"`
		User                 account   `json:"user"`
		Policy               policy    `json:"policy"`
		OnlineCount          *int      `json:"onlineCount,omitempty"`
		Direct               bool      `json:"direct"`
		Blocked              []account `json:"blocked"`
		Receipts             bool      `json:"receipts"`
		Profiles             bool      `json:"profiles"`
		DirectReset          bool      `json:"directReset"`
		AccountLookup        bool      `json:"accountLookup"`
		Names                bool      `json:"names"`
		SavedContacts        bool      `json:"savedContacts"`
		DeviceSync           bool      `json:"deviceSync"`
		NotificationSettings bool      `json:"notificationSettings"`
		MutedConversations   []string  `json:"mutedConversations"`
		Attachments          bool      `json:"attachments"`
	}{"ready", client.user, value, h.onlineForLocked(value.Moderator), true, privacy.Blocked, true,
		h.profiles != nil, h.directPolicy != nil, h.accountLookup != nil, h.names != nil, h.savedContacts != nil,
		h.directPolicy != nil, h.notifications != nil, muted, h.attachmentPolicy != nil})
	if err != nil {
		return false
	}
	client.enqueue(data)
	return true
}
