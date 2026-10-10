package identity

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const recoveryLifetime = 120 * time.Second
const nonceBytes = 12
const tagBytes = 16

func recoveryCipher(previous string) (cipher.AEAD, error) {
	key := sha256.Sum256([]byte("codex-switch:refresh-recovery\x00" + previous))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func sealRecovery(previous, replacement string) (string, error) {
	aead, err := recoveryCipher(previous)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, nonceBytes)
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nil, nonce, []byte(replacement), nil)
	// Node crypto serializes nonce, authentication tag, and ciphertext in that order.
	serialized := append(nonce, sealed[len(sealed)-tagBytes:]...)
	serialized = append(serialized, sealed[:len(sealed)-tagBytes]...)
	return base64.StdEncoding.EncodeToString(serialized), nil
}
func openRecovery(previous, serialized string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(serialized)
	if err != nil {
		return "", err
	}
	if len(data) < nonceBytes+tagBytes {
		return "", errors.New("invalid recovery length")
	}
	aead, err := recoveryCipher(previous)
	if err != nil {
		return "", err
	}
	encrypted := append([]byte{}, data[nonceBytes+tagBytes:]...)
	encrypted = append(encrypted, data[nonceBytes:nonceBytes+tagBytes]...)
	plaintext, err := aead.Open(nil, data[:nonceBytes], encrypted, nil)
	return string(plaintext), err
}
func recoveryUnavailable() error {
	return platform.NewError(503, "Sign-in renewal is temporarily unavailable. Please retry.")
}
func (s *service) rememberRefresh(c *gin.Context, previous, replacement string) error {
	serialized, err := sealRecovery(previous, replacement)
	if err != nil {
		return recoveryUnavailable()
	}
	key := "auth:refresh-recovery:" + hash(previous)
	if err = s.deps.Redis.Set(c.Request.Context(), key, serialized, recoveryLifetime).Err(); err != nil {
		return recoveryUnavailable()
	}
	return nil
}
func (s *service) recallRefresh(c *gin.Context, previous string) (string, error) {
	serialized, err := s.deps.Redis.Get(c.Request.Context(), "auth:refresh-recovery:"+hash(previous)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	if err != nil {
		return "", recoveryUnavailable()
	}
	result, err := openRecovery(previous, serialized)
	if err != nil {
		return "", recoveryUnavailable()
	}
	return result, nil
}

type refreshRecovery struct {
	Previous string
	Token    refreshToken
	User     *user
}

func (s *service) recoverRefresh(c *gin.Context, tx *gorm.DB, options refreshRecovery) (gin.H, error) {
	if options.Token.RevokedAt == nil || time.Since(*options.Token.RevokedAt) >= recoveryLifetime {
		return nil, expiredRefresh()
	}
	replacement, err := s.recallRefresh(c, options.Previous)
	if err != nil {
		return nil, err
	}
	if replacement == "" {
		return nil, expiredRefresh()
	}
	var successor refreshToken
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(`"userId" = ? AND "tokenHash" = ? AND "revokedAt" IS NULL`, options.User.ID, hash(replacement)).
		First(&successor).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && !successor.ExpiresAt.After(now()) {
		return nil, expiredRefresh()
	}
	if err != nil {
		return nil, err
	}
	result, err := s.issueAccess(tx, options.User)
	if err != nil {
		return nil, err
	}
	result["refreshToken"] = replacement
	return result, nil
}
