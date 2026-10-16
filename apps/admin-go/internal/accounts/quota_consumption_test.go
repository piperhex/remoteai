package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func TestQuotaCompletionRequiresCompletedEvent(t *testing.T) {
	for _, raw := range []string{"", "data: [DONE]\n\n", "data: {\"type\":\"response.failed\"}\n\n",
		"data: {\"type\":\"response.incomplete\"}\n\n", "data: broken\n\n"} {
		if quotaCompleted([]byte(raw)) {
			t.Fatalf("accepted incomplete response: %s", raw)
		}
	}
	for _, raw := range []string{"data: {\"type\":\"response.completed\"}\n\n",
		"event: message\r\ndata: {\"type\":\r\ndata: \"response.completed\"}\r\n\r\n"} {
		if !quotaCompleted([]byte(raw)) {
			t.Fatalf("rejected completed response: %s", raw)
		}
	}
}

type quotaTransport func(*http.Request) (*http.Response, error)

func (f quotaTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestQuotaGenerationNeverRetriesAndKeepsCredentialsServerSide(t *testing.T) {
	for _, status := range []int{200, 401, 429, 500} {
		calls := 0
		transport := quotaTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			if r.Method != "POST" || r.URL.String() != quotaResponsesURL ||
				r.Header.Get("Authorization") != "Bearer sample-token" ||
				r.Header.Get("ChatGPT-Account-Id") != "workspace" || r.Header.Get("session-id") != "batch-id" {
				t.Fatal("incorrect upstream request")
			}
			var body object
			if json.NewDecoder(r.Body).Decode(&body) != nil || body["model"] != quotaModel || body["store"] != false {
				t.Fatal("incorrect generation payload")
			}
			return &http.Response{StatusCode: status,
				Body: io.NopCloser(strings.NewReader("data: {\"type\":\"response.completed\"}\n\n"))}, nil
		})
		s := &service{deps: &platform.Dependencies{Config: platform.Config{}}}
		s.outbound.once.Do(func() {
			s.outbound.proxy = &http.Client{Transport: transport, Timeout: outboundTimeout}
		})
		workspace := "workspace"
		row := &storedAccount{Personal: &account{CodexAccountID: &workspace,
			Auth: object{"tokens": object{"access_token": "sample-token", "refresh_token": "never-used"}}}}
		result, err := s.executeQuota(t.Context(), row, "batch-id")
		if calls != 1 || result.Consumed != (status == 200) || (err == nil) != (status == 200) {
			t.Fatalf("status %d: calls=%d, result=%+v, err=%v", status, calls, result, err)
		}
		if s.outbound.proxy.Timeout != outboundTimeout {
			t.Fatal("shared client timeout was mutated")
		}
	}
}

func TestQuotaPermissionAndInvalidInput(t *testing.T) {
	s := &service{deps: &platform.Dependencies{}}
	s.deps.Authenticate = func(c *gin.Context) (*platform.Principal, error) {
		permission := c.GetHeader("test-permission")
		if permission == "" {
			return nil, nil
		}
		return &platform.Principal{ID: "reader", Permissions: []string{permission}}, nil
	}
	router := gin.New()
	s.registerQuotaConsumption(router.Group("/sync", s.deps.RequireAuth()),
		s.deps.RequirePermissions("self.accounts.write"))
	for _, tc := range []struct {
		permission string
		status     int
	}{
		{"", 401}, {"self.accounts.read", 403}, {"self.accounts.write", 400},
	} {
		request := httptest.NewRequest("POST", "/sync/accounts/other-account/quota/consume",
			strings.NewReader(`{"requestId":"invalid"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("test-permission", tc.permission)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != tc.status {
			t.Fatalf("%s: %d", tc.permission, recorder.Code)
		}
		if recorder.Header().Get("Cache-Control") != "no-store" && tc.status == 400 {
			t.Fatal("quota response may be cached")
		}
	}
}

type quotaRedisHook struct {
	result  int64
	failure error
	calls   int
}

func (h *quotaRedisHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (h *quotaRedisHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (h *quotaRedisHook) ProcessHook(_ redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error {
		h.calls++
		if h.failure != nil {
			cmd.SetErr(h.failure)
			return h.failure
		}
		cmd.(*redis.Cmd).SetVal(h.result)
		return nil
	}
}

func TestQuotaLeaseRejectsDuplicateAndUnavailableCache(t *testing.T) {
	for _, result := range []int64{-1, 0, 1} {
		client := redis.NewClient(&redis.Options{Addr: "unused"})
		hook := &quotaRedisHook{result: result}
		client.AddHook(hook)
		s := &service{deps: &platform.Dependencies{Redis: client}}
		release, err := s.claimQuota(t.Context(), "owner", "account", "request")
		if (err == nil) != (result == 1) {
			t.Fatalf("claim %d: %v", result, err)
		}
		if release != nil {
			release()
		}
		if result == 1 && hook.calls != 2 {
			t.Fatal("lease was not released")
		}
		client.Close()
	}
	client := redis.NewClient(&redis.Options{Addr: "unused"})
	defer client.Close()
	client.AddHook(&quotaRedisHook{failure: errors.New("cache unavailable")})
	s := &service{deps: &platform.Dependencies{Redis: client}}
	if release, err := s.claimQuota(t.Context(), "owner", "account", "request"); release != nil || err == nil {
		t.Fatal("cache failure allowed generation")
	}
}

func TestQuotaTimeoutAndBodyLimit(t *testing.T) {
	s := &service{deps: &platform.Dependencies{Config: platform.Config{}}}
	s.outbound.once.Do(func() {
		s.outbound.proxy = &http.Client{Transport: quotaTransport(func(r *http.Request) (*http.Response, error) {
			if _, ok := r.Context().Deadline(); !ok {
				t.Fatal("missing generation deadline")
			}
			return &http.Response{StatusCode: 200,
				Body: io.NopCloser(strings.NewReader(strings.Repeat("x", quotaMaxBytes+1)))}, nil
		})}
	})
	row := &storedAccount{Personal: &account{Auth: object{"tokens": object{"access_token": "sample"}}}}
	if _, err := s.executeQuota(t.Context(), row, "request"); err == nil {
		t.Fatal("oversized response accepted")
	}
}
