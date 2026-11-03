package devices

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Authentication is supplied by the fixture; frames use production decoding, receive,
// ownership/capability checks, forwarding, result routing and disconnect cleanup.
func commandSocket(t *testing.T, g *ControlGateway, session controlSession) *websocket.Conn {
	t.Helper()
	ready, finished := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := newPeer(conn)
		defer close(finished)
		defer client.terminate()
		defer g.disconnect(client)
		g.mu.Lock()
		g.sessions[client] = session
		if session.kind == "device" {
			g.sockets[session.owner+":"+session.device] = client
		}
		g.mu.Unlock()
		close(ready)
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			message, err := parseObject(raw)
			if err != nil || g.receive(client, message, nil) != nil {
				return
			}
		}
	}))
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	<-ready
	t.Cleanup(func() {
		conn.Close()
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Error("control reader leaked")
		}
		server.Close()
	})
	return conn
}

func commandWireRead(t *testing.T, socket *websocket.Conn) platform.JSON {
	t.Helper()
	if err := socket.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var frame platform.JSON
	if err := socket.ReadJSON(&frame); err != nil {
		t.Fatal(err)
	}
	return frame
}

func commandWireWrite(t *testing.T, socket *websocket.Conn, frame platform.JSON) {
	t.Helper()
	if err := socket.WriteJSON(frame); err != nil {
		t.Fatal(err)
	}
}

func TestRemoteCommandWebsocketOverlapRoutingAndDisconnect(t *testing.T) {
	db := commandPolicyDatabase(t)
	if err := db.AutoMigrate(&Device{}); err != nil {
		t.Fatal(err)
	}
	device := Device{OwnerID: "owner", DeviceID: uuid.NewString(), Name: "Test", Platform: "Windows",
		Capabilities: []string{"remote-command"}}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	g := newControlGateway(&Service{&platform.Dependencies{DB: db}})
	desktop := commandSocket(t, g, controlSession{owner: "owner", device: device.DeviceID, kind: "device"})
	caller := commandSocket(t, g, controlSession{owner: "owner", kind: "subscriber"})
	send := func(index int) {
		commandWireWrite(t, caller, platform.JSON{"type": "remote-command", "deviceId": device.DeviceID,
			"requestId": fmt.Sprint(index), "request": platform.JSON{"command": "whoami"}})
	}
	commands := make([]string, 5)
	for index := range commands {
		send(index)
		frame := commandWireRead(t, desktop)
		commands[index] = frame["commandId"].(string)
		if frame["concurrencyLimit"] != float64(5) {
			t.Fatal(frame)
		}
	}
	send(5)
	if commandWireRead(t, caller)["errorCode"] != "client.remoteCommand.busy" {
		t.Fatal("sixth command accepted")
	}
	for index := 4; index >= 0; index-- {
		commandWireWrite(t, desktop, platform.JSON{"type": "remote-command-result", "commandId": commands[index],
			"data": platform.JSON{"stdout": fmt.Sprint(index), "exitCode": 0}})
		if commandWireRead(t, caller)["requestId"] != fmt.Sprint(index) {
			t.Fatal("crossed request IDs")
		}
	}
	for index := range commands {
		send(index)
		commands[index] = commandWireRead(t, desktop)["commandId"].(string)
	}
	if err := caller.Close(); err != nil {
		t.Fatal(err)
	}
	cancelled := map[string]bool{}
	for range commands {
		frame := commandWireRead(t, desktop)
		if frame["type"] != "remote-command-cancel" {
			t.Fatal(frame)
		}
		cancelled[frame["commandId"].(string)] = true
	}
	for _, id := range commands {
		if !cancelled[id] {
			t.Fatal("missing cancellation", id)
		}
	}
	g.mu.Lock()
	remaining := len(g.commands)
	g.mu.Unlock()
	if remaining != 0 {
		t.Fatal("disconnect leaked command slots", remaining)
	}
}
