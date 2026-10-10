//go:build integration

package devices

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type assistanceHTTPFixture struct {
	gateway      *ChatGateway
	host, helper chatIdentity
	principal    *platform.Principal
	router       *gin.Engine
}

func newAssistanceHTTPFixture(t *testing.T) *assistanceHTTPFixture {
	t.Helper()
	g, host := renewalGateway(t)
	helper := chatIdentity{uuid.NewString(), uuid.NewString(), "desktop", time.Now().Add(time.Hour)}
	db := g.service.deps.DB
	if err := db.Exec(`INSERT INTO users(id,email,"passwordHash") VALUES(?,?,?)`,
		helper.owner, helper.owner+"@example.test", "fixture-only").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&Device{OwnerID: helper.owner, DeviceID: helper.device,
		Name: "Assistance helper", Platform: "Windows", Capabilities: []string{}, LastSeenAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	fixture := &assistanceHTTPFixture{gateway: g, host: host, helper: helper, router: gin.New()}
	for _, identity := range []chatIdentity{host, helper} {
		if err := g.sessions.join(queuedPeer(), identity,
			platform.JSON{"transportVersion": float64(2), "remoteAssistance": true}, nil); err != nil {
			t.Fatal(err)
		}
	}
	g.service.deps.Authenticate = func(*gin.Context) (*platform.Principal, error) { return fixture.principal, nil }
	g.registerAssistance(fixture.router)
	return fixture
}

func (f *assistanceHTTPFixture) call(actor chatIdentity, path string, body platform.JSON) *httptest.ResponseRecorder {
	f.principal = &platform.Principal{ID: actor.owner, Email: actor.owner + "@example.test"}
	method := "GET"
	if body != nil {
		method = "POST"
	}
	encoded, _ := json.Marshal(body)
	request := httptest.NewRequest(method, "/remote-assistance"+path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	result := httptest.NewRecorder()
	f.router.ServeHTTP(result, request)
	return result
}

func TestAssistanceHTTPAndSocketAuthorizationLifecycle(t *testing.T) {
	f := newAssistanceHTTPFixture(t)
	created := f.call(f.host, "", platform.JSON{"deviceId": f.host.device, "email": f.helper.owner + "@example.test"})
	if created.Code != 201 {
		t.Fatal(created.Code, created.Body.String())
	}
	var invitation assistanceRequest
	if err := json.Unmarshal(created.Body.Bytes(), &invitation); err != nil {
		t.Fatal(err)
	}
	frame := assistanceFrame(invitation.ID)
	frame["type"], frame["role"] = "authenticate", "mobile"
	frame["accessToken"], frame["deviceId"] = renewalToken(t, f.helper), f.host.device
	frame["assistingDeviceId"] = f.helper.device
	if _, err := f.gateway.authenticate(frame); err == nil {
		t.Fatal("pending invitation accepted by socket")
	}
	listed := f.call(f.helper, "?deviceId="+f.helper.device, nil)
	if listed.Code != 200 || !bytes.Contains(listed.Body.Bytes(), []byte(invitation.ID)) {
		t.Fatal("recipient inbox omitted invitation", listed.Body.String())
	}
	accepted := f.call(f.helper, "/"+invitation.ID, platform.JSON{"deviceId": f.helper.device, "action": "accept"})
	if accepted.Code != 201 {
		t.Fatal(accepted.Code, accepted.Body.String())
	}
	identity, err := f.gateway.authenticate(frame)
	if err != nil || identity.owner != f.host.owner {
		t.Fatal("cross-account authentication failed", err)
	}
	viewer := sessionLimitPeer(t)
	if err := f.gateway.sessions.join(viewer, identity, frame, nil); err != nil {
		t.Fatal(err)
	}
	state := &chatConnection{identity: &identity, timer: time.NewTimer(time.Hour),
		assistanceID: invitation.ID, assistingDeviceID: f.helper.device}
	t.Cleanup(func() { state.timer.Stop() })
	if err := f.gateway.renewAuthentication(viewer, state,
		platform.JSON{"accessToken": renewalToken(t, f.helper)}); err != nil {
		t.Fatal("renewal lost scoped identity", err)
	}
	ended := f.call(f.host, "/"+invitation.ID, platform.JSON{"deviceId": f.host.device, "action": "end"})
	if ended.Code != 201 || !viewer.closed.Load() {
		t.Fatal("host could not revoke active assistance")
	}
	if _, err := f.gateway.authenticate(frame); err == nil {
		t.Fatal("revoked invitation authenticated again")
	}
}

func TestAssistanceHTTPRejectsInvalidEmailAndForeignDevices(t *testing.T) {
	f := newAssistanceHTTPFixture(t)
	for _, input := range []platform.JSON{
		{"deviceId": f.host.device, "email": "invalid"},
		{"deviceId": f.helper.device, "email": f.helper.owner + "@example.test"},
	} {
		response := f.call(f.host, "", input)
		if response.Code < 400 || response.Code >= 500 {
			t.Fatal(response.Code, response.Body.String())
		}
	}
}

func assistancePrivacyEmail(t *testing.T, f *assistanceHTTPFixture, scenario string) string {
	t.Helper()
	email := f.helper.owner + "@example.test"
	sessions := f.gateway.sessions
	switch scenario {
	case "missing":
		email = "missing@example.test"
	case "self":
		email = f.host.owner + "@example.test"
	case "disabled":
		err := f.gateway.service.deps.DB.Exec("UPDATE users SET disabled = true WHERE id = ?", f.helper.owner).Error
		if err != nil {
			t.Fatal(err)
		}
	case "offline":
		sessions.disconnect(sessions.desktops[f.helper.owner+":"+f.helper.device], false)
	case "full inbox":
		for range assistanceInboxLimit {
			id := uuid.NewString()
			sessions.assistance[id] = &assistanceRequest{ID: id, HelperOwner: f.helper.owner,
				State: assistancePending, ExpiresAt: time.Now().Add(assistancePendingLifetime)}
		}
	}
	return email
}

func assertPrivatePendingResponse(t *testing.T, response *httptest.ResponseRecorder, email string) assistanceRequest {
	t.Helper()
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	var invitation assistanceRequest
	var actual platform.JSON
	if err := json.Unmarshal(response.Body.Bytes(), &invitation); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
		t.Fatal(err)
	}
	expected := platform.JSON{"id": invitation.ID, "hostDeviceId": invitation.HostDeviceID,
		"hostName": invitation.HostName, "hostEmail": invitation.HostEmail, "helperEmail": email,
		"state": "pending", "expiresAt": invitation.ExpiresAt.Format(time.RFC3339Nano)}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal("response disclosed recipient information", actual)
	}
	if _, err := uuid.Parse(invitation.ID); err != nil {
		t.Fatal("missing request ID", err)
	}
	remaining := time.Until(invitation.ExpiresAt)
	if remaining > assistancePendingLifetime || remaining < assistancePendingLifetime-time.Second {
		t.Fatal("recipient changed the pending lifetime", remaining)
	}
	return invitation
}

func TestAssistanceHTTPDoesNotDiscloseRecipientExistenceOrAvailability(t *testing.T) {
	for _, scenario := range []string{"online", "offline", "missing", "disabled", "self", "full inbox"} {
		t.Run(scenario, func(t *testing.T) {
			f := newAssistanceHTTPFixture(t)
			email := assistancePrivacyEmail(t, f, scenario)
			created := f.call(f.host, "", platform.JSON{
				"deviceId": f.host.device, "email": " " + strings.ToUpper(email) + " ",
			})
			invitation := assertPrivatePendingResponse(t, created, email)
			listed := f.call(f.host, "?deviceId="+f.host.device, nil)
			if listed.Code != 200 || listed.Body.String() != `{"requests":[`+created.Body.String()+`]}` {
				t.Fatal("polling exposed different request data", listed.Body.String())
			}
			ended := f.call(f.host, "/"+invitation.ID, platform.JSON{"deviceId": f.host.device, "action": "end"})
			if ended.Code != 201 || !bytes.Contains(ended.Body.Bytes(), []byte(`"state":"ended"`)) {
				t.Fatal("recipient changed cancellation behavior", ended.Code, ended.Body.String())
			}
		})
	}
}

func TestAssistanceHTTPRecipientIndependentExpiry(t *testing.T) {
	for _, scenario := range []string{"online", "offline", "missing", "disabled"} {
		t.Run(scenario, func(t *testing.T) {
			f := newAssistanceHTTPFixture(t)
			email := assistancePrivacyEmail(t, f, scenario)
			created := f.call(f.host, "", platform.JSON{"deviceId": f.host.device, "email": email})
			invitation := assertPrivatePendingResponse(t, created, email)
			f.gateway.sessions.assistance[invitation.ID].ExpiresAt = time.Now().Add(-time.Second)
			listed := f.call(f.host, "?deviceId="+f.host.device, nil)
			if listed.Code != 200 || !bytes.Contains(listed.Body.Bytes(), []byte(`"state":"expired"`)) {
				t.Fatal("recipient changed expiry behavior", listed.Code, listed.Body.String())
			}
		})
	}
}
