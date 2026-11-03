package identity

import (
	"errors"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"strings"
)

type userPatch struct {
	Email    *string `json:"email"`
	Password *string `json:"password"`
	Role     *string `json:"role"`
	Disabled *bool   `json:"disabled"`
}

func (s *service) registerUsers(router *gin.Engine) {
	g := router.Group("/admin/api")
	g.GET("/users", s.deps.RequirePermissions("admin.users.read"), handle(s.listUsers))
	g.POST("/users", s.deps.RequirePermissions("admin.users.manage"), handle(s.createUser))
	g.PATCH("/users/:id", s.deps.RequirePermissions("admin.users.manage"), handle(s.updateUser))
	g.DELETE("/users/:id", s.deps.RequirePermissions("admin.users.manage"), handle(s.deleteUser))
	g.PATCH("/profile/password", s.deps.RequirePermissions("self.password.update"), handle(s.changePassword))
}
func passwordHash(password string) (string, error) {
	// bcryptjs truncates UTF-8 passwords to the algorithm's 72-byte limit.
	bytes := []byte(password)
	if len(bytes) > 72 {
		bytes = bytes[:72]
	}
	result, err := bcrypt.GenerateFromPassword(bytes, 12)
	return string(result), err
}
func passwordMatches(encoded, password string) bool {
	bytes := []byte(password)
	if len(bytes) > 72 {
		bytes = bytes[:72]
	}
	return bcrypt.CompareHashAndPassword([]byte(encoded), bytes) == nil
}
func findUser(db *gorm.DB, id string) (*user, error) {
	result := &user{}
	err := db.First(result, "id = ?", id).Error
	return result, dbNotFound(err, "User not found")
}
func (s *service) newUser(db *gorm.DB, request userPatch) (*user, error) {
	email := ""
	password := ""
	if request.Email != nil {
		email = normalizedEmail(*request.Email)
	}
	if request.Password != nil {
		password = *request.Password
	}
	var count int64
	if err := db.Model(&user{}).Where("email = ?", email).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(400, "Email already exists")
	}
	if err := db.Model(&user{}).Count(&count).Error; err != nil {
		return nil, err
	}
	roleCode := "user"
	if count == 0 {
		roleCode = "admin"
	}
	if request.Role != nil {
		roleCode = *request.Role
	}
	encoded, err := passwordHash(password)
	if err != nil {
		return nil, err
	}
	result := &user{ID: uuid.NewString(), Email: email, PasswordHash: encoded, Role: roleCode}
	if request.Disabled != nil {
		result.Disabled = *request.Disabled
	}
	return result, db.Create(result).Error
}
func ensureAnotherAdmin(db *gorm.DB, id string) error {
	var count int64
	err := db.Model(&user{}).Where("role = ? AND disabled = ? AND id <> ?", "admin", false, id).Count(&count).Error
	if err != nil {
		return err
	}
	if count == 0 {
		return platform.NewError(400, "At least one active admin must remain")
	}
	return nil
}
func (s *service) patchUser(id string, request userPatch) (*user, error) {
	u, err := findUser(s.deps.DB, id)
	if err != nil {
		return nil, err
	}
	changesAdmin := request.Role != nil && *request.Role != "admin" || request.Disabled != nil && *request.Disabled
	if u.Role == "admin" && !u.Disabled && changesAdmin {
		if err = ensureAnotherAdmin(s.deps.DB, id); err != nil {
			return nil, err
		}
	}
	if request.Email != nil {
		email := normalizedEmail(*request.Email)
		var count int64
		if err = s.deps.DB.Model(&user{}).Where("email = ? AND id <> ?", email, id).Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, platform.NewError(400, "Email already exists")
		}
		u.Email = email
	}
	if request.Password != nil {
		u.PasswordHash, err = passwordHash(*request.Password)
		if err != nil {
			return nil, err
		}
	}
	if request.Disabled != nil {
		u.Disabled = *request.Disabled
	}
	if request.Role != nil && *request.Role != "" {
		u.Role = *request.Role
	}
	if err = s.saveUser(u, request.Password != nil); err != nil {
		return nil, err
	}
	if request.Password == nil {
		u.PasswordHash = ""
	}
	return u, nil
}
func (s *service) saveUser(u *user, passwordChanged bool) error {
	return s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(u).Error; err != nil {
			return err
		}
		if passwordChanged {
			return clearLoginLock(tx, u.ID)
		}
		return nil
	})
}
func (s *service) listUsers(c *gin.Context) (interface{}, error) {
	db := s.deps.DB.Model(&user{}).Omit("passwordHash")
	if role := c.Query("role"); role != "" {
		db = db.Where("role = ?", role)
	}
	if status := c.Query("status"); status != "" {
		db = db.Where("disabled = ?", status == "disabled")
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		db = db.Where("email ILIKE ?", "%"+search+"%")
	}
	return paginated[user](db, c)
}
func (s *service) createUser(c *gin.Context) (interface{}, error) {
	var request userPatch
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	code := "user"
	if request.Role != nil {
		code = *request.Role
	}
	if err := s.assignable(platform.User(c), code); err != nil {
		return nil, err
	}
	u, err := s.newUser(s.deps.DB, request)
	if err != nil {
		return nil, err
	}
	return u, s.record(
		platform.User(c),
		auditLog{
			Action:      "user.create",
			TargetType:  "user",
			TargetID:    &u.ID,
			TargetEmail: &u.Email,
			Metadata:    gin.H{"role": u.Role},
		},
	)
}
func (s *service) updateUser(c *gin.Context) (interface{}, error) {
	var request userPatch
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	if err := rejectNullFields(c, "email", "password", "disabled"); err != nil {
		return nil, err
	}
	if request.Role != nil && *request.Role != "" {
		if err := s.assignable(platform.User(c), *request.Role); err != nil {
			return nil, err
		}
	}
	u, err := s.patchUser(c.Param("id"), request)
	if err != nil {
		return nil, err
	}
	// ES2022 DTO instances enumerate all declared fields, even omitted properties.
	keys := auditFields(c, "email", "disabled", "role")
	return u, s.record(
		platform.User(c),
		auditLog{Action: "user.update", TargetType: "user", TargetID: &u.ID, TargetEmail: &u.Email,
			Metadata: gin.H{"fields": keys, "passwordChanged": request.Password != nil}},
	)
}
func (s *service) deleteUser(c *gin.Context) (interface{}, error) {
	actor := platform.User(c)
	id := c.Param("id")
	if id == actor.ID {
		return nil, platform.NewError(400, "You cannot delete your own account")
	}
	u, err := findUser(s.deps.DB, id)
	if err != nil {
		return nil, err
	}
	if u.Role == "admin" && !u.Disabled {
		if err = ensureAnotherAdmin(s.deps.DB, id); err != nil {
			return nil, err
		}
	}
	if err = s.deleteUserRecord(u); err != nil {
		return nil, err
	}
	return gin.H{
			"id":    id,
			"email": u.Email,
		}, s.record(
			actor,
			auditLog{Action: "user.delete", TargetType: "user", TargetID: &id, TargetEmail: &u.Email},
		)
}
func (s *service) changePassword(c *gin.Context) (interface{}, error) {
	var request struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	actor := platform.User(c)
	u, err := findUser(s.deps.DB, actor.ID)
	var httpError *platform.HTTPError
	if err != nil && !errors.As(err, &httpError) {
		return nil, err
	}
	if err != nil || u.Disabled || !passwordMatches(u.PasswordHash, request.CurrentPassword) {
		return nil, platform.NewError(401, "Current password is invalid")
	}
	encoded, err := passwordHash(request.NewPassword)
	if err != nil {
		return nil, err
	}
	err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(u).Update("passwordHash", encoded).Error; err != nil {
			return err
		}
		return clearLoginLock(tx, u.ID)
	})
	if err != nil {
		return nil, err
	}
	return ok(), s.record(
		actor,
		auditLog{Action: "profile.password.change", TargetType: "user", TargetID: &actor.ID, TargetEmail: &actor.Email},
	)
}
