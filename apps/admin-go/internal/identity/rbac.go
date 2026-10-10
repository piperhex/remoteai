package identity

import (
	_ "embed"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

//go:embed catalog.json
var catalogJSON []byte

type permissionCatalog struct {
	Permissions     []permission        `json:"permissions"`
	UserPermissions []string            `json:"userPermissions"`
	Dependencies    map[string][]string `json:"dependencies"`
}

func catalog() permissionCatalog {
	var result permissionCatalog
	// The embedded catalog is generated from the checked-in legacy permission definitions.
	if err := json.Unmarshal(catalogJSON, &result); err != nil {
		panic(err)
	}
	return result
}

// Initialize synchronizes built-in permissions while preserving customized user roles.
func Initialize(deps *platform.Dependencies) error {
	cat := catalog()
	s := &service{deps}
	for _, p := range cat.Permissions {
		p.System = true
		conflict := clause.OnConflict{Columns: []clause.Column{{Name: "code"}}, UpdateAll: true}
		if err := deps.DB.Clauses(conflict).Create(&p).Error; err != nil {
			return err
		}
	}
	var existing role
	err := deps.DB.First(&existing, "code = ?", "user").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		existing = role{Code: "user", Name: "User", Description: "Default self-service role.", System: true}
		if err = s.saveRole(&existing, cat.UserPermissions); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if err = deps.DB.Model(&existing).Update("system", true).Error; err != nil {
		return err
	}
	var all []string
	if err = deps.DB.Model(&permission{}).Pluck("code", &all).Error; err != nil {
		return err
	}
	var admin role
	err = deps.DB.First(&admin, "code = ?", "admin").Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	admin.Code = "admin"
	admin.Name = "Administrator"
	admin.Description = "Built-in role with every permission."
	admin.System = true
	return s.saveRole(&admin, all)
}
func (s *service) saveRole(r *role, codes []string) error {
	return s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(r).Error; err != nil {
			return err
		}
		if err := tx.Where(`"roleCode" = ?`, r.Code).Delete(&rolePermission{}).Error; err != nil {
			return err
		}
		for _, code := range codes {
			if err := tx.Create(&rolePermission{r.Code, code}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
func (s *service) getRole(code string) (*role, []string, error) {
	return getRole(s.deps.DB, code)
}

func getRole(db *gorm.DB, code string) (*role, []string, error) {
	r := &role{}
	if err := db.First(r, "code = ?", code).Error; err != nil {
		return nil, nil, dbNotFound(err, "Role not found")
	}
	codes := []string{}
	err := db.Model(&rolePermission{}).Where(`"roleCode" = ?`, code).Pluck("permissionCode", &codes).Error
	return r, codes, err
}
func principal(db *gorm.DB, u *user) (*platform.Principal, error) {
	r, codes, err := getRole(db, u.Role)
	if err != nil {
		var h *platform.HTTPError
		if errors.As(err, &h) && h.Status == 404 {
			return nil, platform.NewError(401, "User role is no longer available")
		}
		return nil, err
	}
	return &platform.Principal{ID: u.ID, Email: u.Email, Role: u.Role, RoleName: r.Name, Permissions: codes}, nil
}
func (s *service) assignable(actor *platform.Principal, code string) error {
	_, permissions, err := s.getRole(code)
	if err != nil {
		return err
	}
	if code == "user" {
		return nil
	}
	if code == "admin" && actor.Role != "admin" {
		return platform.NewError(403, "Only a built-in administrator can assign the administrator role")
	}
	return canGrant(actor, permissions)
}
func canGrant(actor *platform.Principal, permissions []string) error {
	if actor.Role == "admin" {
		return nil
	}
	if !platform.HasPermissions(actor, permissions, false) {
		return platform.NewError(403, "You cannot grant permissions you do not have")
	}
	return nil
}
func expandPermissions(codes []string) []string {
	out := []string{}
	seen := map[string]bool{}
	pending := []string{}
	for _, code := range codes {
		if !seen[code] {
			seen[code] = true
			out = append(out, code)
			pending = append(pending, code)
		}
	}
	dependencies := catalog().Dependencies
	for len(pending) > 0 {
		code := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for _, dep := range dependencies[code] {
			if !seen[dep] {
				seen[dep] = true
				out = append(out, dep)
				pending = append(pending, dep)
			}
		}
	}
	return out
}
func (s *service) resolvePermissions(codes []string) ([]string, error) {
	expanded := expandPermissions(codes)
	if len(expanded) == 0 {
		return expanded, nil
	}
	var count int64
	if err := s.deps.DB.Model(&permission{}).Where("code IN ?", expanded).Count(&count).Error; err != nil {
		return nil, err
	}
	if count != int64(len(expanded)) {
		return nil, platform.NewError(400, "One or more permissions are invalid")
	}
	return expanded, nil
}
func (s *service) presentRole(r role) (interface{}, error) {
	_, codes, err := s.getRole(r.Code)
	if err != nil {
		return nil, err
	}
	sort.Strings(codes)
	var count int64
	if err = s.deps.DB.Model(&user{}).Where("role = ?", r.Code).Count(&count).Error; err != nil {
		return nil, err
	}
	return gin.H{"code": r.Code, "name": r.Name, "description": r.Description, "system": r.System, "permissions": codes,
		"userCount": count, "createdAt": r.CreatedAt, "updatedAt": r.UpdatedAt}, nil
}
func (s *service) registerRBAC(router *gin.Engine) {
	group := router.Group("/admin/api")
	group.GET("/roles", s.deps.RequirePermissions("admin.roles.read"), handle(s.listRoles))
	group.GET("/permissions", s.deps.RequirePermissions("admin.roles.read"), handle(s.listPermissions))
	group.POST("/permissions", s.deps.RequirePermissions("admin.permissions.manage"), handle(s.createPermission))
	group.PATCH("/permissions/:code", s.deps.RequirePermissions("admin.permissions.manage"), handle(s.updatePermission))
	group.POST("/roles", s.deps.RequirePermissions("admin.roles.manage"), handle(s.createRole))
	group.PATCH("/roles/:code", s.deps.RequirePermissions("admin.roles.manage"), handle(s.updateRole))
	group.DELETE("/roles/:code", s.deps.RequirePermissions("admin.roles.manage"), handle(s.deleteRole))
}
func (s *service) listPermissions(*gin.Context) (interface{}, error) {
	result := []permission{}
	err := s.deps.DB.Order(`"group" ASC`).Order("code ASC").Find(&result).Error
	return result, err
}
func (s *service) listRoles(*gin.Context) (interface{}, error) {
	rows := []role{}
	if err := s.deps.DB.Order("system DESC").Order("name ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	result := []interface{}{}
	for _, r := range rows {
		view, err := s.presentRole(r)
		if err != nil {
			return nil, err
		}
		result = append(result, view)
	}
	return result, nil
}
func (s *service) createPermission(c *gin.Context) (interface{}, error) {
	var p permission
	if err := bind(c, &p); err != nil {
		return nil, err
	}
	p.Code = strings.ToLower(strings.TrimSpace(p.Code))
	p.Name = strings.TrimSpace(p.Name)
	p.Group = strings.TrimSpace(p.Group)
	p.Description = strings.TrimSpace(p.Description)
	if p.Name == "" || p.Group == "" {
		return nil, platform.NewError(400, "Permission name and group are required")
	}
	if strings.HasPrefix(p.Code, "admin.") || strings.HasPrefix(p.Code, "self.") {
		return nil, platform.NewError(400, "The admin.* and self.* permission namespaces are reserved")
	}
	var count int64
	if err := s.deps.DB.Model(&permission{}).Where("code = ?", p.Code).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(400, "Permission code already exists")
	}
	if err := s.deps.DB.Create(&p).Error; err != nil {
		return nil, err
	}
	r, codes, err := s.getRole("admin")
	if err == nil {
		err = s.saveRole(r, append(codes, p.Code))
	}
	if err != nil {
		return nil, err
	}
	err = s.record(
		platform.User(c),
		auditLog{
			Action:     "permission.create",
			TargetType: "permission",
			TargetID:   &p.Code,
			Metadata:   gin.H{"name": p.Name, "group": p.Group},
		},
	)
	return p, err
}
func (s *service) updatePermission(c *gin.Context) (interface{}, error) {
	var request map[string]string
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	if err := rejectNullFields(c, "name", "group", "description"); err != nil {
		return nil, err
	}
	var p permission
	if err := s.deps.DB.First(&p, "code = ?", c.Param("code")).Error; err != nil {
		return nil, dbNotFound(err, "Permission not found")
	}
	if p.System {
		return nil, platform.NewError(400, "Built-in permissions cannot be modified")
	}
	for key, value := range request {
		value = strings.TrimSpace(value)
		if (key == "name" || key == "group") && value == "" {
			return nil, platform.NewError(400, "Permission "+key+" is required")
		}
		switch key {
		case "name":
			p.Name = value
		case "group":
			p.Group = value
		case "description":
			p.Description = value
		}
	}
	if err := s.deps.DB.Save(&p).Error; err != nil {
		return nil, err
	}
	keys := auditFields(c, "name", "group", "description")
	return p, s.record(
		platform.User(c),
		auditLog{
			Action:     "permission.update",
			TargetType: "permission",
			TargetID:   &p.Code,
			Metadata:   gin.H{"fields": keys},
		},
	)
}
