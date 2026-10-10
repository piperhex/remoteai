package accounts

import (
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
)

func countingHTTPServer(t *testing.T, connections *atomic.Int32) *httptest.Server {
	t.Helper()
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	server.Start()
	t.Cleanup(server.Close)
	return server
}

func TestOutboundReusesSeparateDirectAndProxyConnections(t *testing.T) {
	var directConnections, proxyConnections atomic.Int32
	direct := countingHTTPServer(t, &directConnections)
	proxy := countingHTTPServer(t, &proxyConnections)
	s := &service{deps: &platform.Dependencies{Config: platform.Config{"CODEX_OUTBOUND_PROXY": proxy.URL}}}
	for range 5 {
		for _, proxied := range []bool{false, true} {
			if _, err := s.request(requestOptionsHTTP{URL: direct.URL, Proxy: proxied}); err != nil {
				t.Fatal(err)
			}
		}
	}
	defer s.outbound.direct.CloseIdleConnections()
	defer s.outbound.proxy.CloseIdleConnections()
	if directConnections.Load() != 1 || proxyConnections.Load() != 1 {
		t.Fatal("connections were not reused or proxy routing changed",
			directConnections.Load(), proxyConnections.Load())
	}
}
