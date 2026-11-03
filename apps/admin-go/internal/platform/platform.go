// Package platform contains the shared HTTP and persistence boundaries.
package platform

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/bandwidth"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type Config map[string]string

func (c Config) Get(key, fallback string) string {
	if value, ok := c[key]; ok {
		return value
	}
	return fallback
}

func Environment() Config {
	c := Config{}
	for _, entry := range os.Environ() {
		key, value, _ := strings.Cut(entry, "=")
		c[key] = value
	}
	return c
}

type Principal struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Role        string   `json:"role"`
	RoleName    string   `json:"roleName"`
	Permissions []string `json:"permissions"`
}

type Dependencies struct {
	LoungeIdentity             func(string) (string, time.Time, error)
	LoungeAttachment           func(string, string) (string, string, string, error)
	LoungeGenerations          func(context.Context, string, []string) (map[string]int64, error)
	DB                         *gorm.DB
	Redis                      *redis.Client
	Config                     Config
	Authenticate               func(*gin.Context) (*Principal, error)
	FlushTraffic               func() error
	ReadBandwidth              func() bandwidth.Snapshot
	ChatPolicyChanged          func()
	RemoteCommandPolicyChanged func()
}

func User(c *gin.Context) *Principal {
	value, _ := c.Get("principal")
	user, _ := value.(*Principal)
	return user
}

func (d *Dependencies) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if User(c) != nil {
			c.Next()
			return
		}
		if d.Authenticate == nil {
			Fail(c, 401, "Unauthorized")
			return
		}
		user, err := d.Authenticate(c)
		if err != nil {
			Respond(c, nil, err)
			return
		}
		if user == nil {
			Fail(c, 401, "Unauthorized")
			return
		}
		c.Set("principal", user)
		c.Next()
	}
}

func (d *Dependencies) RequirePermissions(codes ...string) gin.HandlerFunc {
	return d.permissionGuard(codes, false)
}

func (d *Dependencies) RequireAnyPermission(codes ...string) gin.HandlerFunc {
	return d.permissionGuard(codes, true)
}

func (d *Dependencies) permissionGuard(codes []string, anyOf bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if User(c) == nil {
			if d.Authenticate == nil {
				Fail(c, 401, "Unauthorized")
				return
			}
			user, err := d.Authenticate(c)
			if err != nil {
				Respond(c, nil, err)
				return
			}
			if user == nil {
				Fail(c, 401, "Unauthorized")
				return
			}
			c.Set("principal", user)
		}
		if len(codes) == 0 {
			Fail(c, 403, "Route permission is not configured")
			return
		}
		if !HasPermissions(User(c), codes, anyOf) {
			Fail(c, 403, "Insufficient permission")
			return
		}
		c.Next()
	}
}

func HasPermissions(user *Principal, codes []string, anyOf bool) bool {
	if user == nil {
		return false
	}
	granted := make(map[string]bool, len(user.Permissions))
	for _, permission := range user.Permissions {
		granted[permission] = true
	}
	for _, permission := range codes {
		if anyOf && granted[permission] {
			return true
		}
		if !anyOf && !granted[permission] {
			return false
		}
	}
	return !anyOf
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string              { return e.Message }
func NewError(status int, message string) error { return &HTTPError{status, message} }

func Fail(c *gin.Context, status int, message string) {
	if (status == 401 && message == "Unauthorized") || status == 429 {
		c.AbortWithStatusJSON(status, gin.H{"message": message, "statusCode": status})
		return
	}
	label := http.StatusText(status)
	if status == http.StatusRequestEntityTooLarge {
		label = "Payload Too Large"
	}
	c.AbortWithStatusJSON(status, gin.H{"message": message, "error": label, "statusCode": status})
}

// Respond accepts heterogeneous JSON response DTOs at the transport boundary.
func Respond(c *gin.Context, value interface{}, err error) {
	if err != nil {
		var public *HTTPError
		if errors.As(err, &public) {
			Fail(c, public.Status, public.Message)
			return
		}
		if !IsLoungeRequest(c) {
			slog.Error("request failed", "method", c.Request.Method, "path", c.FullPath(), "error", err)
		}
		c.AbortWithStatusJSON(500, gin.H{"statusCode": 500, "message": "Internal server error"})
		return
	}
	status := http.StatusOK
	if c.Request.Method == http.MethodPost {
		status = http.StatusCreated
	}
	WriteJSON(c, status, value)
}
