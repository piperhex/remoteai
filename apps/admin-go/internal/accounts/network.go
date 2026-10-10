package accounts

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
)

const defaultIssuer = "https://auth.openai.com"
const defaultClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

func validateOutboundProxy(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" {
		return errors.New("CODEX_OUTBOUND_PROXY must be a valid HTTP(S) proxy URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("CODEX_OUTBOUND_PROXY must use the http or https protocol")
	}
	if parsed.Host == "" {
		return errors.New("CODEX_OUTBOUND_PROXY must be a valid HTTP(S) proxy URL")
	}
	return nil
}

type requestOptionsHTTP struct {
	URL, Method string
	Body        interface{}
	Form        url.Values
	Headers     map[string]string
	Proxy       bool
}
type responseHTTP struct {
	Status int
	Raw    []byte
}

func (s *service) request(options requestOptionsHTTP) (*responseHTTP, error) {
	request, err := outboundRequest(options)
	if err != nil {
		return nil, err
	}
	client, err := s.outbound.client(s.deps.Config, options.Proxy)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	return &responseHTTP{Status: response.StatusCode, Raw: raw}, nil
}

func outboundRequest(options requestOptionsHTTP) (*http.Request, error) {
	var reader io.Reader
	contentType := ""
	if options.Form != nil {
		reader = strings.NewReader(options.Form.Encode())
		contentType = "application/x-www-form-urlencoded"
	} else if options.Body != nil {
		raw, e := json.Marshal(options.Body)
		if e != nil {
			return nil, e
		}
		reader = bytes.NewReader(raw)
		contentType = "application/json"
	}
	method := options.Method
	if method == "" {
		method = "GET"
	}
	request, err := http.NewRequest(method, options.URL, reader)
	if err != nil {
		return nil, err
	}
	request.Header.Set("originator", "codex_cli_rs")
	request.Header.Set("User-Agent", "codex_cli_rs/0.1.0")
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	for k, v := range options.Headers {
		request.Header.Set(k, v)
	}
	return request, nil
}

func (response *responseHTTP) object(context string) (object, error) {
	var value interface{}
	if err := json.Unmarshal(response.Raw, &value); err != nil {
		return nil, platform.NewError(502, context+" is not valid JSON")
	}
	result, ok := value.(map[string]interface{})
	if !ok {
		return nil, platform.NewError(502, context+" is invalid")
	}
	return result, nil
}
func (response *responseHTTP) ok() bool { return response.Status >= 200 && response.Status < 300 }
func (s *service) issuer() string {
	return strings.TrimRight(first(strings.TrimSpace(s.deps.Config.Get("CODEX_OAUTH_ISSUER", "")), defaultIssuer), "/")
}
func (s *service) clientID() string {
	return first(strings.TrimSpace(s.deps.Config.Get("CODEX_OAUTH_CLIENT_ID", "")), defaultClientID)
}
