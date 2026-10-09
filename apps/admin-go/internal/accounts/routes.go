package accounts

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

// Register installs the native sync, profile, and official account endpoints.
func Register(router *gin.Engine, deps *platform.Dependencies) error {
	if err := validateOutboundProxy(deps.Config.Get("CODEX_OUTBOUND_PROXY", "")); err != nil {
		return err
	}
	s := &service{deps: deps}
	sync := router.Group("/sync", deps.RequireAuth())
	s.registerSync(sync)
	s.registerOfficialUsage(router.Group("/official-usage", deps.RequireAuth()),
		deps.RequirePermissions("self.accounts.read"))
	s.registerAdmin(router.Group("/admin/api", deps.RequireAuth()))
	return nil
}

type handler func(*gin.Context) (interface{}, error)

func endpoint(fn handler) gin.HandlerFunc {
	return func(c *gin.Context) { value, err := fn(c); platform.Respond(c, value, err) }
}
func noStore(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() }
func (s *service) registerSync(r *gin.RouterGroup) {
	read := s.deps.RequirePermissions("self.accounts.read")
	write := s.deps.RequirePermissions("self.accounts.write")
	anyWrite := s.deps.RequireAnyPermission("self.accounts.write", metadataPermission)
	r.GET("/accounts", read, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.list(platform.User(c).ID, c.GetHeader("x-device-id"), permission(c, metadataPermission))
	}))
	r.GET("/accounts/summary", read, noStore, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.summary(platform.User(c).ID, permission(c, metadataPermission), false)
	}))
	r.GET(
		"/accounts/web-summary",
		read,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.summary(platform.User(c).ID, false, true) }),
	)
	r.GET(
		"/accounts/:id/details",
		read,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.details(platform.User(c).ID, c.Param("id")) }),
	)
	r.PATCH("/accounts/:id/details", write, noStore, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.updateDetails(requestOptions(c), c.Param("id"), in)
	}))
	r.PUT("/accounts", anyWrite, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.upsertAccounts(requestOptions(c), objects(in["accounts"]))
	}))
	r.PUT("/accounts/:id", anyWrite, endpoint(s.putAccount))
	r.DELETE(
		"/accounts/:id",
		write,
		endpoint(
			func(c *gin.Context) (interface{}, error) { return s.deleteAccount(platform.User(c).ID, c.Param("id")) },
		),
	)
	s.registerTotp(r, read, write)
	s.registerProviders(r)
	s.registerAccountNetwork(r, read, write)
}

func (s *service) registerTotp(r *gin.RouterGroup, read, write gin.HandlerFunc) {
	r.GET(
		"/totp",
		read,
		noStore,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.getVault(platform.User(c).ID) }),
	)
	r.PUT("/totp", write, noStore, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.putVault(platform.User(c).ID, in)
	}))
}

func (s *service) registerProviders(r *gin.RouterGroup) {
	read := s.deps.RequirePermissions("self.providers.read")
	write := s.deps.RequirePermissions("self.providers.write")
	r.GET(
		"/providers",
		read,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.providers(platform.User(c).ID) }),
	)
	r.PUT("/providers", write, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.upsertProviders(platform.User(c).ID, objects(in["providers"]))
	}))
	r.PUT("/providers/:id", write, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		if in["id"] != c.Param("id") {
			return nil, mismatch("provider")
		}
		_, e = s.upsertProviders(platform.User(c).ID, []object{in})
		return object{"id": c.Param("id")}, e
	}))
	r.DELETE(
		"/providers/:id",
		write,
		endpoint(
			func(c *gin.Context) (interface{}, error) { return s.deleteProvider(platform.User(c).ID, c.Param("id")) },
		),
	)
}

func requestOptions(c *gin.Context) writeOptions {
	return writeOptions{
		Owner:    platform.User(c).ID,
		Device:   c.GetHeader("x-device-id"),
		Editable: permission(c, metadataPermission),
	}
}
func objects(value interface{}) []object {
	result := []object{}
	for _, v := range arr(value) {
		result = append(result, obj(v))
	}
	return result
}
func (s *service) putAccount(c *gin.Context) (interface{}, error) {
	in, err := body(c)
	if err != nil {
		return nil, err
	}
	if in["id"] != c.Param("id") {
		return nil, mismatch("account")
	}
	options := requestOptions(c)
	options.RejectMetadata = true
	_, err = s.upsertAccounts(options, []object{in})
	return object{"id": c.Param("id")}, err
}
