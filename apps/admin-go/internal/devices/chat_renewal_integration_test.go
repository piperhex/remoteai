//go:build integration

package devices

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func renewalGateway(t *testing.T) (*ChatGateway, chatIdentity) {
	t.Helper()
	db, err := gorm.Open(postgres.Open(
		"host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=admin_go sslmode=disable"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	identity := chatIdentity{uuid.NewString(), uuid.NewString(), "desktop", time.Now().Add(time.Minute)}
	if err = tx.Exec(`INSERT INTO users(id,email,"passwordHash") VALUES(?,?,?)`,
		identity.owner, identity.owner+"@example.test", "fixture-only").Error; err != nil {
		t.Fatal(err)
	}
	if err = tx.Exec(`INSERT INTO remote_devices("ownerId","deviceId",name,platform) VALUES(?,?,?,?)`,
		identity.owner, identity.device, "Renewal fixture", "Windows").Error; err != nil {
		t.Fatal(err)
	}
	deps := &platform.Dependencies{DB: tx, Config: platform.Config{"KONG_JWT_SECRET": "local-renewal-test-only"}}
	return &ChatGateway{service: &Service{deps}, sessions: newChatSessions(nil)}, identity
}

func renewalToken(t *testing.T, identity chatIdentity) string {
	t.Helper()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": identity.owner, "exp": identity.expires.Unix(),
	}).SignedString([]byte("local-renewal-test-only"))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestChatRenewalChecksFreshCredentialsAndKeepsTheRegisteredSocket(t *testing.T) {
	gateway, identity := renewalGateway(t)
	client := queuedPeer()
	state := &chatConnection{identity: &identity, timer: time.NewTimer(time.Hour)}
	t.Cleanup(func() { state.timer.Stop() })
	if err := gateway.sessions.join(client, identity, platform.JSON{"transportVersion": float64(2)}, nil); err != nil {
		t.Fatal(err)
	}
	<-client.queue // Initial registration.
	renewed := identity
	renewed.expires = time.Now().Add(time.Hour).Truncate(time.Second)
	message := platform.JSON{"type": "renew-auth", "accessToken": renewalToken(t, renewed)}
	if err := gateway.receive(client, state, message, 256); err != nil {
		t.Fatal(err)
	}
	if !state.identity.expires.Equal(renewed.expires) || client.closed.Load() ||
		gateway.sessions.desktops[identity.owner+":"+identity.device] != client {
		t.Fatal("valid renewal replaced or closed the socket")
	}
	frame := <-client.queue
	var ack platform.JSON
	if err := json.Unmarshal(frame.bytes, &ack); err != nil {
		t.Fatal(err)
	}
	if ack["type"] != "auth-renewed" || ack["expiresAt"] != float64(renewed.expires.UnixMilli()) {
		t.Fatal("missing renewal acknowledgement", string(frame.bytes))
	}
	assertRenewalCredentialsRejected(t, gateway, client, state)
}

func assertRenewalCredentialsRejected(t *testing.T, gateway *ChatGateway, client *peer, state *chatConnection) {
	t.Helper()
	identity := *state.identity
	message := platform.JSON{"type": "renew-auth"}
	message["accessToken"] = "forged-token"
	if err := gateway.receive(client, state, message, 256); err == nil {
		t.Fatal("forged credential renewed the connection")
	}
	expired := identity
	expired.expires = time.Now().Add(-time.Second)
	message["accessToken"] = renewalToken(t, expired)
	if err := gateway.receive(client, state, message, 256); err == nil {
		t.Fatal("expired credential renewed the connection")
	}
	assertOtherOwnerRejected(t, gateway, client, state)
	err := gateway.service.deps.DB.Exec("UPDATE users SET disabled = true WHERE id = ?", identity.owner).Error
	if err != nil {
		t.Fatal(err)
	}
	message["accessToken"] = renewalToken(t, identity)
	if err := gateway.receive(client, state, message, 256); err == nil {
		t.Fatal("disabled account renewed the connection")
	}
}

func assertOtherOwnerRejected(t *testing.T, gateway *ChatGateway, client *peer, state *chatConnection) {
	t.Helper()
	other := *state.identity
	other.owner = uuid.NewString()
	db := gateway.service.deps.DB
	if err := db.Exec(`INSERT INTO users(id,email,"passwordHash") VALUES(?,?,?)`,
		other.owner, other.owner+"@example.test", "fixture-only").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO remote_devices("ownerId","deviceId",name,platform) VALUES(?,?,?,?)`,
		other.owner, other.device, "Other account fixture", "Windows").Error; err != nil {
		t.Fatal(err)
	}
	previous := state.identity
	err := gateway.receive(client, state, platform.JSON{"type": "renew-auth", "accessToken": renewalToken(t, other)}, 256)
	if err == nil || state.identity != previous {
		t.Fatal("a valid token from another account changed the authenticated connection")
	}
}
