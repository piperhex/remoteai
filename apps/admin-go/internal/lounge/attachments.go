package lounge

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/codex-switch/admin-go/internal/content"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const maxAttachments = 3

type attachment struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Mime   string `json:"mime"`
	Device string `json:"device"`
	Kind   string `json:"kind"`
	Grant  string `json:"grant,omitempty"`
}

type attachmentClaims struct {
	Generation int64      `json:"generation"`
	Device     string     `json:"device"`
	Recipient  string     `json:"recipient"`
	File       attachment `json:"file"`
	jwt.RegisteredClaims
}

// Images belong to local history: signed recipient, blocking and deletion-generation checks
// remain authoritative after seven days, including for images issued by older servers.
// Ordinary file grants retain their original expiration requirement.
func (value attachmentClaims) GetExpirationTime() (*jwt.NumericDate, error) {
	if value.File.Kind == "image" {
		return nil, nil
	}
	if value.ExpiresAt == nil {
		return nil, errInvalid
	}
	return value.ExpiresAt, nil
}

func (h *hub) registerAttachments(deps *platform.Dependencies) {
	h.attachmentPolicy = func() (map[string]interface{}, error) { return content.ReadChatPolicy(deps.DB) }
	deps.LoungeAttachment = h.verifyAttachment
}

func (h *hub) verifyAttachment(token, viewer string) (string, string, string, error) {
	var value attachmentClaims
	if len(token) > 8192 {
		return "", "", "", errInvalid
	}
	_, err := jwt.ParseWithClaims(token, &value, func(*jwt.Token) (interface{}, error) { return h.key, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithAudience("lounge-attachment"))
	if err != nil || value.Subject == "" || value.Device == "" ||
		(value.Recipient != "" && viewer != value.Recipient && viewer != value.Subject) {
		return "", "", "", errInvalid
	}
	privacy, err := h.readRelationships(viewer)
	if err != nil {
		return "", "", "", err
	}
	for _, blocked := range privacy.Blocked {
		if blocked.ID == value.Subject {
			return "", "", "", errInvalid
		}
	}
	for _, blocked := range privacy.BlockedBy {
		if blocked == value.Subject {
			return "", "", "", errInvalid
		}
	}
	if err := h.checkAttachmentGeneration(value); err != nil {
		return "", "", "", err
	}
	return value.Subject, value.Device, value.File.ID, nil
}

func (h *hub) checkAttachmentGeneration(value attachmentClaims) error {
	if value.Recipient == "" || h.directPolicy == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	states, err := h.directPolicy.States(ctx, value.Subject, []string{value.Recipient})
	if err != nil {
		return err
	}
	if states.Generations[value.Recipient] != value.Generation {
		return errDirectReset
	}
	return nil
}

func (h *hub) attachmentLimits() (map[string]interface{}, error) {
	if h.attachmentPolicy != nil {
		return h.attachmentPolicy()
	}
	return map[string]interface{}{"loungeFileMaxMb": float64(300),
		"loungeGroupImageMaxMb": float64(1), "loungeDirectImageMaxMb": float64(1)}, nil
}

func attachmentLimit(policy map[string]interface{}, kind, to string) int64 {
	key := "loungeGroupImageMaxMb"
	if to != "" {
		key = "loungeDirectImageMaxMb"
	}
	if kind == "file" {
		key = "loungeFileMaxMb"
	}
	mb, _ := policy[key].(float64)
	// Keep multiplication within exact byte-offset range even for an oversized administrator value.
	return int64(min(mb*1024*1024, 9007199254740991))
}

func (h *hub) prepareAttachments(sender *peer, input *incoming) error {
	if len(input.Attachments) == 0 && len(input.Images) == 0 {
		return nil
	}
	policy, err := h.attachmentLimits()
	if err != nil {
		return err
	}
	if len(input.Attachments) > maxAttachments {
		return errInvalid
	}
	imageCount := len(input.Images)
	for index, file := range input.Attachments {
		if file.Kind == "image" {
			imageCount++
		}
		if !validAttachment(file, input.To) || file.Size > attachmentLimit(policy, file.Kind, input.To) {
			return errors.New("client.lounge.attachmentLimit")
		}
		file.Grant = ""
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, attachmentClaims{
			Device: file.Device, Recipient: input.To, File: file, Generation: input.Generation,
			RegisteredClaims: jwt.RegisteredClaims{Subject: sender.user.ID, Audience: []string{"lounge-attachment"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour))},
		}).SignedString(h.key)
		if err != nil {
			return err
		}
		file.Grant = token
		input.Attachments[index] = file
	}
	if imageCount > maxImages {
		return errInvalid
	}
	for _, data := range input.Images {
		if _, err := validateImageLimit(data, attachmentLimit(policy, "image", input.To)); err != nil {
			return err
		}
	}
	return nil
}

func validAttachment(file attachment, to string) bool {
	_, idErr := uuid.Parse(file.ID)
	_, deviceErr := uuid.Parse(file.Device)
	if idErr != nil || deviceErr != nil || file.Size < 0 || file.Name == "" || utf8.RuneCountInString(file.Name) > 255 ||
		file.Name == "." || file.Name == ".." || strings.ContainsAny(file.Name, "/\\") ||
		strings.ContainsFunc(file.Name, unicode.IsControl) || len(file.Mime) > 100 {
		return false
	}
	if file.Kind == "file" {
		return to != ""
	}
	return file.Kind == "image" && file.Size > 0 &&
		(file.Mime == "image/png" || file.Mime == "image/jpeg" || file.Mime == "image/gif")
}
