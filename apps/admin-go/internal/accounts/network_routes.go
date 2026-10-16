package accounts

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func (s *service) registerAccountNetwork(r *gin.RouterGroup, read, write gin.HandlerFunc) {
	s.registerQuotaConsumption(r, write)
	r.GET(
		"/accounts/:id/usage",
		read,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.usage(platform.User(c).ID, c.Param("id")) }),
	)
	r.GET(
		"/accounts/:id/reset-credits",
		read,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.credits(platform.User(c).ID, c.Param("id")) }),
	)
	r.POST(
		"/accounts/:id/reset-credits/consume",
		write,
		endpoint(
			func(c *gin.Context) (interface{}, error) { return s.consumeCredit(platform.User(c).ID, c.Param("id")) },
		),
	)
	r.POST("/accounts/import", write, noStore, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.importAccounts(platform.User(c), in, "personal")
	}))
	s.registerPersonalOAuth(r, write)
}

func (s *service) registerPersonalOAuth(r *gin.RouterGroup, write gin.HandlerFunc) {
	r.POST(
		"/accounts/oauth/start",
		write,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.oauthStart(platform.User(c), personalOAuth) }),
	)
	r.POST("/accounts/oauth/:sessionId/poll", write, noStore, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.oauthPoll(platform.User(c), c.Param("sessionId"), personalOAuth)
	}))
	r.POST(
		"/accounts/oauth/embedded/start",
		write,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.oauthStart(platform.User(c), embeddedOAuth) }),
	)
	r.POST(
		"/accounts/oauth/embedded/:sessionId/poll",
		write,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) {
			return s.oauthPoll(platform.User(c), c.Param("sessionId"), embeddedOAuth)
		}),
	)
	r.POST(
		"/accounts/oauth/embedded/:sessionId/complete",
		write,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) {
			in, e := body(c)
			if e != nil {
				return nil, e
			}
			return s.embeddedComplete(platform.User(c), c.Param("sessionId"), in)
		}),
	)
}

func (s *service) registerOfficialNetwork(r *gin.RouterGroup, manage gin.HandlerFunc) {
	r.POST("/official-accounts/import", manage, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.importAccounts(platform.User(c), in, "compatible")
	}))
	r.POST("/official-accounts/import/sub2api", manage, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.importAccounts(platform.User(c), in, "sub2api")
	}))
	r.POST(
		"/official-accounts/oauth/start",
		manage,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.oauthStart(platform.User(c), officialOAuth) }),
	)
	r.POST("/official-accounts/oauth/:sessionId/poll", manage, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.oauthPoll(platform.User(c), c.Param("sessionId"), officialOAuth)
	}))
}
