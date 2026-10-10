package identity

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type authRequest struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	VerificationCode string `json:"verificationCode"`
	InviteToken      string `json:"inviteToken"`
	NewPassword      string `json:"newPassword"`
	RefreshToken     string `json:"refreshToken"`
}

func (s *service) registerAuth(router *gin.Engine) {
	g := router.Group("/auth")
	g.POST("/register", handle(s.register))
	g.POST("/register/code", handle(s.registrationCode))
	g.POST("/password-reset/code", handle(s.passwordResetCode))
	g.POST("/password-reset", handle(s.resetPassword))
	g.POST("/login", handle(s.login))
	g.POST("/refresh", handle(s.refresh))
	g.POST("/logout", handle(s.logout))
	g.GET(
		"/me",
		s.deps.RequireAuth(),
		handle(func(c *gin.Context) (interface{}, error) { return platform.User(c), nil }),
	)
}
func parseToken(encoded, secret string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(
		encoded,
		func(t *jwt.Token) (interface{}, error) { return []byte(secret), nil },
		jwt.WithValidMethods([]string{"HS256", "HS384", "HS512"}),
	)
	if err != nil {
		return nil, err
	}
	claims, valid := token.Claims.(jwt.MapClaims)
	if !valid || !token.Valid {
		return nil, errors.New("invalid claims")
	}
	return claims, nil
}
func (s *service) authenticate(c *gin.Context) (*platform.Principal, error) {
	parts := strings.Fields(c.GetHeader("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return nil, platform.NewError(401, "Unauthorized")
	}
	claims, err := parseToken(parts[1], s.secret())
	if err != nil {
		return nil, platform.NewError(401, "Unauthorized")
	}
	id, _ := claims["sub"].(string)
	if id == "" {
		return nil, platform.NewError(401, "User is disabled or no longer exists")
	}
	var u user
	ctx, cancel := platform.DatabaseContext(c.Request.Context())
	defer cancel()
	db := s.deps.DB.WithContext(ctx)
	err = db.Where("id = ? AND disabled = ?", id, false).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, platform.NewError(401, "User is disabled or no longer exists")
	}
	if err != nil {
		return nil, err
	}
	return principal(db, &u)
}

var lifetimePattern = regexp.MustCompile(
	`(?i)^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|` +
		`hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$`,
)

func accessLifetime(value string) (time.Duration, error) {
	match := lifetimePattern.FindStringSubmatch(value)
	if len(match) != 3 {
		return 0, errors.New("invalid access token lifetime")
	}
	amount, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0, err
	}
	unit := strings.ToLower(match[2])
	multiplier := float64(time.Millisecond)
	switch {
	case unit == "y" || strings.HasPrefix(unit, "yr") || strings.HasPrefix(unit, "year"):
		multiplier = float64(365.25 * 24 * time.Hour)
	case unit == "w" || strings.HasPrefix(unit, "week"):
		multiplier = float64(7 * 24 * time.Hour)
	case unit == "d" || strings.HasPrefix(unit, "day"):
		multiplier = float64(24 * time.Hour)
	case unit == "h" || strings.HasPrefix(unit, "hr") || strings.HasPrefix(unit, "hour"):
		multiplier = float64(time.Hour)
	case unit == "m" || strings.HasPrefix(unit, "min"):
		multiplier = float64(time.Minute)
	case unit == "s" || strings.HasPrefix(unit, "sec"):
		multiplier = float64(time.Second)
	}
	return time.Duration(amount * multiplier), nil
}
func (s *service) issueAccess(db *gorm.DB, u *user) (gin.H, error) {
	principal, err := principal(db, u)
	if err != nil {
		return nil, err
	}
	lifetime, err := accessLifetime(s.deps.Config.Get("JWT_ACCESS_EXPIRES", "15m"))
	if err != nil {
		return nil, err
	}
	issued := time.Now().Unix()
	claims := jwt.MapClaims{"sub": u.ID, "email": u.Email, "role": u.Role,
		"iss": s.deps.Config.Get(
			"KONG_JWT_KEY",
			"codex-switch",
		), "iat": issued, "exp": issued + int64(lifetime/time.Second)}
	encoded, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.secret()))
	return gin.H{"accessToken": encoded, "user": principal}, err
}
func (s *service) issueTokens(db *gorm.DB, u *user) (gin.H, error) {
	result, err := s.issueAccess(db, u)
	if err != nil {
		return nil, err
	}
	seconds, err := strconv.ParseInt(s.deps.Config.Get("REFRESH_TOKEN_TTL_SECONDS", "2592000"), 10, 64)
	if err != nil {
		return nil, err
	}
	token := refreshToken{
		ID:        uuid.NewString(),
		UserID:    u.ID,
		ExpiresAt: now().Add(time.Duration(seconds) * time.Second),
	}
	issued := time.Now().Unix()
	claims := jwt.MapClaims{"sub": u.ID, "tokenId": token.ID, "typ": "refresh", "iat": issued, "exp": issued + seconds}
	encoded, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.refreshSecret()))
	if err != nil {
		return nil, err
	}
	token.TokenHash = hash(encoded)
	if err = db.Create(&token).Error; err != nil {
		return nil, err
	}
	result["refreshToken"] = encoded
	return result, nil
}
func (s *service) login(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	var outcome loginOutcome
	ctx, cancel := platform.DatabaseContext(c.Request.Context())
	defer cancel()
	err := s.deps.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		outcome, err = s.attemptLogin(tx, request)
		return err
	})
	if err != nil {
		return nil, err
	}
	if outcome.LockedUntil != nil {
		return nil, loginLockedError(c, outcome.LockedUntil.Sub(now()))
	}
	if outcome.Invalid {
		return nil, platform.NewError(401, "Invalid email or password")
	}
	return outcome.Tokens, nil
}
func (s *service) register(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	if err := s.verifyCode(c, request, "registration"); err != nil {
		return nil, err
	}
	patch := userPatch{Email: &request.Email, Password: &request.Password}
	var u *user
	var err error
	if request.InviteToken == "" {
		u, err = s.newUser(s.deps.DB, patch)
	} else {
		err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
			invitation, e := s.validateInvitation(tx, request.InviteToken, request.Email)
			if e != nil {
				return e
			}
			patch.Role = &invitation.Role
			u, e = s.newUser(tx, patch)
			if e != nil {
				return e
			}
			return acceptInvitation(tx, invitation, u)
		})
	}
	if err != nil {
		return nil, err
	}
	return s.issueTokens(s.deps.DB, u)
}
func (s *service) registrationCode(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	var count int64
	if err := s.deps.DB.Model(&user{}).Where("email = ?", normalizedEmail(request.Email)).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(400, "Email is already registered")
	}
	return s.sendCode(c, request.Email, "registration")
}
func (s *service) passwordResetCode(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	var count int64
	err := s.deps.DB.Model(&user{}).
		Where("email = ? AND disabled = ?", normalizedEmail(request.Email), false).Count(&count).Error
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return s.sendCode(c, request.Email, "password-reset")
	}
	return gin.H{"ok": true, "expiresInSeconds": 300}, nil
}
func (s *service) resetPassword(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	var u user
	err := s.deps.DB.Where("email = ? AND disabled = ?", normalizedEmail(request.Email), false).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, invalidCode()
	}
	if err != nil {
		return nil, err
	}
	if err = s.verifyCode(c, request, "password-reset"); err != nil {
		return nil, err
	}
	encoded, err := passwordHash(request.NewPassword)
	if err != nil {
		return nil, err
	}
	err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Model(&u).Update("passwordHash", encoded).Error; e != nil {
			return e
		}
		if e := clearLoginLock(tx, u.ID); e != nil {
			return e
		}
		return tx.Model(&refreshToken{}).
			Where(`"userId" = ? AND "revokedAt" IS NULL`, u.ID).
			Update("revokedAt", now()).
			Error
	})
	return ok(), err
}
func (s *service) refresh(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	claims, err := parseToken(request.RefreshToken, s.refreshSecret())
	if err != nil || claims["typ"] != "refresh" {
		return nil, platform.NewError(401, "Refresh token is invalid")
	}
	var result gin.H
	ctx, cancel := platform.DatabaseContext(c.Request.Context())
	defer cancel()
	err = s.deps.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var token refreshToken
		e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(`id = ? AND "userId" = ? AND "tokenHash" = ?`, claims["tokenId"], claims["sub"], hash(request.RefreshToken)).
			First(&token).
			Error
		if errors.Is(e, gorm.ErrRecordNotFound) || e == nil && !token.ExpiresAt.After(now()) {
			return expiredRefresh()
		}
		if e != nil {
			return e
		}
		var u user
		e = tx.Where("id = ? AND disabled = ?", token.UserID, false).First(&u).Error
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return expiredRefresh()
		}
		if e != nil {
			return e
		}
		if token.RevokedAt != nil {
			result, e = s.recoverRefresh(c, tx, refreshRecovery{request.RefreshToken, token, &u})
			return e
		}
		result, e = s.issueTokens(tx, &u)
		if e != nil {
			return e
		}
		if e = tx.Model(&token).Update("revokedAt", now()).Error; e != nil {
			return e
		}
		return s.rememberRefresh(c, request.RefreshToken, result["refreshToken"].(string))
	})
	return result, err
}
func expiredRefresh() error { return platform.NewError(401, "Refresh token expired") }
func (s *service) logout(c *gin.Context) (interface{}, error) {
	var request authRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	err := s.deps.DB.Transaction(func(tx *gorm.DB) error {
		var token refreshToken
		e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(`"tokenHash" = ?`, hash(request.RefreshToken)).
			First(&token).
			Error
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return nil
		}
		if e != nil {
			return e
		}
		replacement := ""
		if token.RevokedAt != nil {
			replacement, e = s.recallRefresh(c, request.RefreshToken)
			if e != nil {
				return e
			}
		}
		e = tx.Model(&refreshToken{}).Where(`"tokenHash" = ? AND "revokedAt" IS NULL`, hash(request.RefreshToken)).
			Update("revokedAt", now()).Error
		if e != nil {
			return e
		}
		if replacement != "" {
			return tx.Model(&refreshToken{}).
				Where(`"userId" = ? AND "tokenHash" = ? AND "revokedAt" IS NULL`, token.UserID, hash(replacement)).
				Update("revokedAt", now()).
				Error
		}
		return nil
	})
	return ok(), err
}
