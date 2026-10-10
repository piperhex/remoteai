package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type service struct {
	deps     *platform.Dependencies
	outbound outboundClients
}

const metadataPermission = "self.official-accounts.metadata.write"
const epoch = "1970-01-01T00:00:00.000Z"

func str(v interface{}) string { s, _ := v.(string); return s }
func obj(v interface{}) object {
	m, _ := v.(map[string]interface{})
	if m == nil {
		return object{}
	}
	return m
}
func arr(v interface{}) []interface{} {
	a, _ := v.([]interface{})
	if a == nil {
		return []interface{}{}
	}
	return a
}
func number(v interface{}) float64  { n, _ := v.(float64); return n }
func has(m object, key string) bool { _, ok := m[key]; return ok }
func copyObject(m object) object {
	result := object{}
	for k, v := range m {
		result[k] = v
	}
	return result
}
func valueOr(v, fallback interface{}) interface{} {
	if v == nil {
		return fallback
	}
	return v
}
func first(values ...interface{}) string {
	for _, v := range values {
		if s := str(v); s != "" {
			return s
		}
	}
	return ""
}
func iso(t time.Time) string {
	if t.IsZero() {
		return epoch
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
func date(v interface{}) time.Time {
	if t, ok := v.(time.Time); ok {
		return t
	}
	for _, format := range []string{time.RFC3339Nano, "2006-01-02", "2006-01-02T15:04:05"} {
		if t, e := time.Parse(format, str(v)); e == nil {
			return t
		}
	}
	return time.Time{}
}
func timestamp(v interface{}) string {
	t := date(v)
	if t.IsZero() {
		t = time.Now()
	}
	return iso(t)
}
func newer(a, b interface{}) bool { return date(a).After(date(b)) }
func latest(m object) string {
	value := epoch
	found := false
	for _, v := range m {
		if !found || newer(v, value) {
			value = str(v)
			found = true
		}
	}
	return value
}
func versions(m object, fallback interface{}, fields []string) object {
	result := object{}
	base := timestamp(fallback)
	for _, key := range fields {
		result[key] = timestamp(valueOr(m[key], base))
	}
	return result
}
func hasVersions(m object) bool {
	for _, v := range m {
		if strings.TrimSpace(str(v)) != "" {
			return true
		}
	}
	return false
}
func encodeMap(v interface{}) object {
	raw, _ := json.Marshal(v)
	result := object{}
	_ = json.Unmarshal(raw, &result)
	return result
}
func decodeMap(m object, v interface{}) error {
	raw, e := json.Marshal(m)
	if e != nil {
		return e
	}
	return json.Unmarshal(raw, v)
}
func permission(c *gin.Context, code string) bool {
	return platform.HasPermissions(platform.User(c), []string{code}, false)
}
func body(c *gin.Context) (object, error) {
	value := object{}
	if err := c.ShouldBindJSON(&value); err != nil {
		return nil, platform.NewError(400, "Bad Request")
	}
	return value, nil
}
func notFound(err error, message string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return platform.NewError(404, message)
	}
	return err
}
func unique(values []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, v := range values {
		if !seen[v] {
			result = append(result, v)
			seen[v] = true
		}
	}
	return result
}
func stringsOf(v interface{}) []string {
	values := []string{}
	for _, x := range arr(v) {
		values = append(values, str(x))
	}
	return values
}
func (s *service) invalidate(owner string, providers bool) error {
	if s.deps.Redis == nil {
		return nil
	}
	prefix := "sync:accounts:"
	if providers {
		prefix = "sync:providers:"
	}
	return s.deps.Redis.Del(context.Background(), prefix+owner).Err()
}
func newID() string { return uuid.NewString() }
