//go:build integration

package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoginAndRefreshUseOneTransactionConnection(t *testing.T) {
	f := newLoginFixture(t)
	if err := Initialize(f.service.deps); err != nil {
		t.Fatal(err)
	}
	pool, err := f.service.deps.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	f.service.deps.DB = f.service.deps.DB.WithContext(ctx)
	login := f.login(loginFixturePassword)
	assertLoginStatus(t, login, http.StatusCreated)
	var tokens struct{ RefreshToken string }
	if err := json.Unmarshal(login.Body.Bytes(), &tokens); err != nil || tokens.RefreshToken == "" {
		t.Fatal("missing login token", err)
	}
	// Both rotation and retry recovery must use the already-held SQL transaction.
	for range 2 {
		body, err := json.Marshal(authRequest{RefreshToken: tokens.RefreshToken})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/auth/refresh", strings.NewReader(string(body))).WithContext(ctx)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		f.router.ServeHTTP(response, request)
		assertLoginStatus(t, response, http.StatusCreated)
	}
	if waits := pool.Stats().WaitCount; waits != 0 {
		t.Fatalf("authentication acquired a connection outside its transaction: %d waits", waits)
	}
}
