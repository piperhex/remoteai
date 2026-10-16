package server

import (
	"os"
	"strings"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/goccy/go-yaml"
)

const kongGoUpstream = "http://codex-switch-admin-go:8080"

type kongRoute struct {
	Paths     []string
	StripPath *bool `yaml:"strip_path"`
	Plugins   []struct {
		Name   string
		Config struct {
			KeyClaimName   string   `yaml:"key_claim_name"`
			RunOnPreflight *bool    `yaml:"run_on_preflight"`
			ClaimsToVerify []string `yaml:"claims_to_verify"`
		}
	}
}

type kongService struct {
	URL    string `yaml:"url"`
	Routes []kongRoute
}

// Kong strips matching path prefixes unless strip_path is explicitly false.
func stripsKongPath(route kongRoute) bool {
	return route.StripPath == nil || *route.StripPath
}

func readKongServices(t *testing.T) []kongService {
	t.Helper()
	data, err := os.ReadFile("../../kong/existing-kong.example.yml")
	if err != nil {
		t.Fatal(err)
	}
	var document struct{ Services []kongService }
	if err := yaml.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Services) == 0 {
		t.Fatal("Kong example has no services")
	}
	return document.Services
}

// The example uses plain prefix routes. The longest prefix must select the intended service and auth policy.
func matchKongRoute(services []kongService, path string) (kongService, kongRoute) {
	var service kongService
	var route kongRoute
	matched := 0
	for _, candidate := range services {
		for _, rule := range candidate.Routes {
			if length := matchingPrefixLength(rule.Paths, path); length > matched {
				service, route, matched = candidate, rule, length
			}
		}
	}
	return service, route
}

func matchingPrefixLength(prefixes []string, path string) int {
	longest := 0
	for _, prefix := range prefixes {
		if len(prefix) > longest && strings.HasPrefix(path, prefix) {
			longest = len(prefix)
		}
	}
	return longest
}

func TestKongRoutesCoverRegisteredGoEndpoints(t *testing.T) {
	services := readKongServices(t)
	// Register the real router without listeners, cache downloads, push workers, or database requests.
	router, runtime, err := New(&platform.Dependencies{Config: platform.Config{"CHAT_STUN_PORT": "0"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := runtime.Close(); err != nil {
			t.Error(err)
		}
	})
	for _, endpoint := range router.Routes() {
		service, route := matchKongRoute(services, endpoint.Path)
		if service.URL != kongGoUpstream || stripsKongPath(route) {
			t.Errorf("%s %s is missing from the Go Kong routes or would lose its path", endpoint.Method, endpoint.Path)
		}
	}
	t.Logf("Checked %d registered Go endpoints against the Kong example", len(router.Routes()))
}

func TestKongRouteAuthenticationBoundaries(t *testing.T) {
	services := readKongServices(t)
	for _, path := range []string{"/sync/accounts", "/sync/accounts/account-id/quota/consume",
		"/admin/api/users", "/devices", "/official-usage",
		"/remote-assistance", "/chat-push/status", "/admin/api/update-sharing"} {
		_, route := matchKongRoute(services, path)
		if !hasKongAccountJWT(route) {
			t.Errorf("%s must use the account JWT route with expiry verification", path)
		}
	}
	for _, path := range []string{"/auth/login", "/device-chat", "/device-switch", "/desktop-service/revoke",
		"/help-assistant/settings", "/official-models", "/update-packages", "/update-sharing/settings",
		"/admin-assets/app.js"} {
		service, route := matchKongRoute(services, path)
		if service.URL != kongGoUpstream || stripsKongPath(route) || len(route.Plugins) != 0 {
			t.Errorf("%s must reach Go unchanged without the account JWT plugin", path)
		}
	}
	service, route := matchKongRoute(services, "/web/assets/app.js")
	if service.URL != "http://codex-switch-web:80" || !stripsKongPath(route) {
		t.Fatal("/web must strip its prefix and reach the independent Web service")
	}
}

func hasKongAccountJWT(route kongRoute) bool {
	for _, plugin := range route.Plugins {
		if plugin.Name == "jwt" && plugin.Config.KeyClaimName == "iss" &&
			plugin.Config.RunOnPreflight != nil && !*plugin.Config.RunOnPreflight &&
			len(plugin.Config.ClaimsToVerify) == 1 && plugin.Config.ClaimsToVerify[0] == "exp" {
			return true
		}
	}
	return false
}
