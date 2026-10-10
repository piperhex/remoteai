package accounts

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

const outboundTimeout = 20 * time.Second
const outboundIdlePerHost = 10

// Direct and proxied traffic keep separate pools for the lifetime of the service.
type outboundClients struct {
	once          sync.Once
	direct, proxy *http.Client
	err           error
}

func (clients *outboundClients) client(config platform.Config, proxied bool) (*http.Client, error) {
	clients.once.Do(func() {
		clients.direct = newOutboundClient(nil)
		clients.proxy = clients.direct
		address := strings.TrimSpace(config.Get("CODEX_OUTBOUND_PROXY", ""))
		if clients.err = validateOutboundProxy(address); clients.err != nil || address == "" {
			return
		}
		var proxy *url.URL
		proxy, clients.err = url.Parse(address)
		if clients.err == nil {
			clients.proxy = newOutboundClient(proxy)
		}
	})
	if proxied {
		return clients.proxy, clients.err
	}
	return clients.direct, clients.err
}

func newOutboundClient(proxy *url.URL) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.MaxIdleConnsPerHost = outboundIdlePerHost
	if proxy != nil {
		transport.Proxy = http.ProxyURL(proxy)
	}
	return &http.Client{Timeout: outboundTimeout, Transport: transport}
}
