package turnquota

import (
	"crypto/tls"
	"encoding/binary"
	"io"
	"net"
	"os"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/mediarelay"
	"github.com/google/uuid"
	"github.com/pion/stun/v3"
)

const testSecret = "local_turn_quota_test_secret_123456789"

type turnAllocation struct {
	conn               net.Conn
	stream             bool
	username, password string
	nonce              stun.Nonce
	realm              stun.Realm
}

func allocation(t *testing.T, address, transport, owner string) *turnAllocation {
	t.Helper()
	var conn net.Conn
	var err error
	if transport == "tls" {
		// Test-only self-signed certificate on loopback.
		conn, err = tls.Dial("tcp", address, &tls.Config{InsecureSkipVerify: true})
	} else {
		conn, err = net.Dial(transport, address)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	credential := mediarelay.Issue(testSecret, uuid.NewSHA1(uuid.NameSpaceOID, []byte(owner)).String(),
		time.Now().Add(time.Hour))
	a := &turnAllocation{conn: conn, stream: transport != "udp", username: credential.Username,
		password: credential.Credential}
	challenge := a.exchange(t, stun.MethodAllocate, false, 600)
	var code stun.ErrorCodeAttribute
	if code.GetFrom(challenge) != nil || code.Code != stun.CodeUnauthorized {
		t.Fatal("missing challenge", challenge)
	}
	if a.nonce.GetFrom(challenge) != nil || a.realm.GetFrom(challenge) != nil {
		t.Fatal("invalid challenge")
	}
	return a
}

func (a *turnAllocation) exchange(t *testing.T, method stun.Method, auth bool, lifetime uint32) *stun.Message {
	t.Helper()
	setters := []stun.Setter{stun.TransactionID, stun.NewType(method, stun.ClassRequest)}
	if method == stun.MethodAllocate {
		setters = append(setters, stun.RawAttribute{Type: stun.AttrRequestedTransport, Value: []byte{17, 0, 0, 0}})
	}
	value := make([]byte, 4)
	binary.BigEndian.PutUint32(value, lifetime)
	setters = append(setters, stun.RawAttribute{Type: stun.AttrLifetime, Value: value})
	if auth {
		setters = append(setters, stun.NewUsername(a.username), a.realm, a.nonce,
			stun.NewLongTermIntegrity(a.username, string(a.realm), a.password))
	}
	request, err := stun.Build(setters...)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.conn.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := a.conn.Write(request.Raw); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 65536)
	n := 0
	if a.stream {
		if _, err := io.ReadFull(a.conn, data[:20]); err != nil {
			t.Fatal(err)
		}
		n = 20 + int(binary.BigEndian.Uint16(data[2:4]))
		if _, err := io.ReadFull(a.conn, data[20:n]); err != nil {
			t.Fatal(err)
		}
	} else {
		n, err = a.conn.Read(data)
		if err != nil {
			t.Fatal(err)
		}
	}
	response := &stun.Message{Raw: data[:n]}
	if err := response.Decode(); err != nil {
		t.Fatal(err)
	}
	if response.TransactionID != request.TransactionID {
		t.Fatal("transaction mismatch")
	}
	return response
}

func (a *turnAllocation) expect(t *testing.T, method stun.Method, lifetime uint32, code int) {
	t.Helper()
	response := a.exchange(t, method, true, lifetime)
	if code == 0 {
		if response.Type.Class != stun.ClassSuccessResponse {
			var actual stun.ErrorCodeAttribute
			actual.GetFrom(response)
			t.Fatal(response, actual)
		}
		return
	}
	var actual stun.ErrorCodeAttribute
	if actual.GetFrom(response) != nil || int(actual.Code) != code {
		t.Fatal("unexpected TURN error", response)
	}
}

func (a *turnAllocation) awaitReleasedSlot(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		response := a.exchange(t, stun.MethodAllocate, true, 600)
		if response.Type.Class == stun.ClassSuccessResponse {
			return
		}
		var code stun.ErrorCodeAttribute
		if code.GetFrom(response) != nil || code.Code != 486 {
			t.Fatal(response, code)
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("released allocation quota was not reclaimed")
}

func TestRealAllocationAdmission(t *testing.T) {
	if os.Getenv("TURN_QUOTA_TEST_BACKEND") == "" {
		t.Skip("requires isolated real coturn")
	}
	deps := integrationDeps(t)
	addresses := startMeteredProxy(t)
	saveQuota(t, deps, 2)
	awaitQuota(t, deps, 2)
	first := allocation(t, addresses[0], "udp", "account-one")
	first.expect(t, stun.MethodAllocate, 600, 0)
	second := allocation(t, addresses[0], "tcp", "account-two")
	second.expect(t, stun.MethodAllocate, 600, 0)
	third := allocation(t, addresses[1], "tls", "account-three")
	third.expect(t, stun.MethodAllocate, 600, 486)
	first.expect(t, stun.MethodRefresh, 0, 0)
	third.awaitReleasedSlot(t)
	saveQuota(t, deps, 3)
	awaitQuota(t, deps, 3)
	fourth := allocation(t, addresses[0], "udp", "account-four")
	fourth.expect(t, stun.MethodAllocate, 600, 0)
	saveQuota(t, deps, 1)
	awaitQuota(t, deps, 1)
	for _, existing := range []*turnAllocation{second, third, fourth} {
		existing.expect(t, stun.MethodRefresh, 600, 0)
	}
	fifth := allocation(t, addresses[1], "tls", "account-five")
	fifth.expect(t, stun.MethodAllocate, 600, 486)
	for _, existing := range []*turnAllocation{second, third, fourth} {
		existing.expect(t, stun.MethodRefresh, 0, 0)
	}
	fifth.awaitReleasedSlot(t)
	fifth.expect(t, stun.MethodRefresh, 0, 0)
	t.Log("UDP + TCP + TLS share the coturn quota; 486 at cap; release/reapply succeeds; lowering preserves refresh")
}
