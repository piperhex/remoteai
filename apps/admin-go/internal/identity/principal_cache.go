package identity

import (
	"context"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache"
)

// User existence, disabled status, role assignment and role revision stay authoritative on
// every request. Only the permissions of that exact committed role version are cached.
// saveRole updates the role and its permission rows in one transaction; xmin distinguishes
// even multiple writes with an identical updatedAt timestamp, across all service instances.
func (s *service) currentPrincipal(ctx context.Context, id string) (*platform.Principal, error) {
	var row struct {
		ID, Email, Role string
		RoleName        *string
		Revision        string
	}
	db := s.deps.DB.WithContext(ctx)
	result := db.Raw(`SELECT u.id,u.email,u.role,r.name AS role_name,COALESCE(r.xmin::text,'') AS revision
 FROM users u LEFT JOIN rbac_roles r ON r.code=u.role WHERE u.id=? AND NOT u.disabled`, id).Scan(&row)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, platform.NewError(401, "User is disabled or no longer exists")
	}
	if row.RoleName == nil {
		return nil, platform.NewError(401, "User role is no longer available")
	}
	permissions, err := readcache.Load(ctx, readcache.Options{Client: s.deps.Redis,
		Key: "client-read:v1:role:" + row.Role + ":" + row.Revision, Lifetime: time.Minute},
		func(ctx context.Context) ([]string, error) {
			codes := []string{}
			err := db.WithContext(ctx).Table("rbac_role_permissions p").
				Joins(`JOIN rbac_roles r ON r.code=p."roleCode" AND r.xmin::text=?`, row.Revision).
				Where(`p."roleCode" = ?`, row.Role).Pluck(`p."permissionCode"`, &codes).Error
			return codes, err
		})
	if err != nil {
		return nil, err
	}
	return &platform.Principal{ID: row.ID, Email: row.Email, Role: row.Role,
		RoleName: *row.RoleName, Permissions: permissions}, nil
}
