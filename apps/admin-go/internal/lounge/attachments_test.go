package lounge

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func historicalImageClaims() attachmentClaims {
	return attachmentClaims{Device: uuid.NewString(), Recipient: uuid.NewString(),
		File: attachment{ID: uuid.NewString(), Kind: "image"},
		RegisteredClaims: jwt.RegisteredClaims{Subject: uuid.NewString(), Audience: []string{"lounge-attachment"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-30 * 24 * time.Hour))}}
}

func signAttachment(t *testing.T, h *hub, claims attachmentClaims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.key)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestHistoricalImageGrantsKeepPrivacyChecksAfterExpiration(t *testing.T) {
	h := newHub([]byte("attachment-test-key"))
	h.relationships = &memoryRelationships{blocks: map[string]map[string]bool{}}
	policy := &attachmentGenerationPolicy{}
	h.directPolicy = policy
	claims := historicalImageClaims()
	grant := signAttachment(t, h, claims)
	if _, _, _, err := h.verifyAttachment(grant, claims.Recipient); err != nil {
		t.Fatal("historical image expired", err)
	}
	if _, _, _, err := h.verifyAttachment(grant+"x", claims.Recipient); err == nil {
		t.Fatal("bad signature accepted")
	}
	if _, _, _, err := h.verifyAttachment(grant, uuid.NewString()); err == nil {
		t.Fatal("private image leaked")
	}
	policy.generation++
	if _, _, _, err := h.verifyAttachment(grant, claims.Recipient); !errors.Is(err, errDirectReset) {
		t.Fatal("deleted image remained accessible", err)
	}
	policy.generation--
	if _, err := h.relationships.SetBlock(context.Background(),
		blockChange{Actor: claims.Subject, Target: claims.Recipient, Blocked: true}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := h.verifyAttachment(grant, claims.Recipient); err == nil {
		t.Fatal("blocked image remained accessible")
	}
}

func TestHistoricalImageGrantStillValidatesOtherClaimsAndFileExpiration(t *testing.T) {
	for _, kind := range []string{"expired-file", "file-without-expiry", "audience", "not-before"} {
		t.Run(kind, func(t *testing.T) {
			h := newHub([]byte("attachment-test-key"))
			h.relationships = &memoryRelationships{blocks: map[string]map[string]bool{}}
			claims := historicalImageClaims()
			switch kind {
			case "expired-file":
				claims.File.Kind = "file"
			case "file-without-expiry":
				claims.File.Kind, claims.ExpiresAt = "file", nil
			case "audience":
				claims.Audience = []string{"other"}
			case "not-before":
				claims.NotBefore = jwt.NewNumericDate(time.Now().Add(time.Hour))
			}
			if _, _, _, err := h.verifyAttachment(signAttachment(t, h, claims), claims.Recipient); err == nil {
				t.Fatal("invalid grant accepted")
			}
		})
	}
}

type attachmentGenerationPolicy struct {
	directPolicyRepository
	generation int64
}

func (p *attachmentGenerationPolicy) States(_ context.Context, _ string, peers []string) (directStates, error) {
	return directStates{Generations: map[string]int64{peers[0]: p.generation}}, nil
}

func TestAttachmentGrantIsRevokedByConversationDeletion(t *testing.T) {
	h := newHub([]byte("attachment-test-key"))
	h.relationships = &memoryRelationships{blocks: map[string]map[string]bool{}}
	policy := &attachmentGenerationPolicy{}
	h.directPolicy = policy
	sender, recipient := uuid.NewString(), uuid.NewString()
	input := incoming{To: recipient, Attachments: []attachment{{ID: uuid.NewString(), Device: uuid.NewString(),
		Name: "file.zip", Kind: "file", Mime: "application/zip", Size: 1}}}
	if err := h.prepareAttachments(&peer{user: account{ID: sender}}, &input); err != nil {
		t.Fatal(err)
	}
	grant := input.Attachments[0].Grant
	if _, _, _, err := h.verifyAttachment(grant, recipient); err != nil {
		t.Fatal(err)
	}
	policy.generation++
	if _, _, _, err := h.verifyAttachment(grant, recipient); !errors.Is(err, errDirectReset) {
		t.Fatal("deleted private conversation retained download permission", err)
	}
}

func TestAttachmentFingerprintExcludesRenewedGrantButIncludesFile(t *testing.T) {
	h := newHub([]byte("test-key"))
	input := incoming{ID: "message", To: uuid.NewString(), Attachments: []attachment{{
		ID: uuid.NewString(), Device: uuid.NewString(), Name: "file.zip", Size: 1, Kind: "file", Grant: "first"}}}
	sender := uuid.NewString()
	first, err := h.directPermission(sender, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Attachments[0].Grant = "renewed"
	renewed, err := h.directPermission(sender, input)
	if err != nil || first.Fingerprint != renewed.Fingerprint {
		t.Fatal("renewed grant changed the retry fingerprint", err)
	}
	input.Attachments[0].ID = uuid.NewString()
	changed, err := h.directPermission(sender, input)
	if err != nil || first.Fingerprint == changed.Fingerprint {
		t.Fatal("different file reused the same opening permission", err)
	}
}

func TestAttachmentRejectsUnsafeNames(t *testing.T) {
	file := attachment{ID: uuid.NewString(), Device: uuid.NewString(), Kind: "file"}
	for _, name := range []string{".", "..", "a/b", "a\\b", "a\tb", "a\x7fb"} {
		file.Name = name
		if validAttachment(file, "recipient") {
			t.Fatal("unsafe name accepted", name)
		}
	}
}

func TestAttachmentLimitsAndPrivateGrants(t *testing.T) {
	h := newHub([]byte("attachment-test-key"))
	h.relationships = &memoryRelationships{blocks: map[string]map[string]bool{}}
	sender := &peer{user: account{ID: uuid.NewString()}}
	recipient := uuid.NewString()
	file := attachment{ID: uuid.NewString(), Device: uuid.NewString(), Name: "report.zip",
		Mime: "application/zip", Kind: "file", Size: 300 * 1024 * 1024}
	input := incoming{ID: "send", To: recipient, Attachments: []attachment{file}}
	if err := h.prepareAttachments(sender, &input); err != nil {
		t.Fatal(err)
	}
	grant := input.Attachments[0].Grant
	owner, device, id, err := h.verifyAttachment(grant, recipient)
	if err != nil || owner != sender.user.ID || device != file.Device || id != file.ID {
		t.Fatal("grant mismatch", err)
	}
	if _, _, _, err := h.verifyAttachment(grant, uuid.NewString()); err == nil {
		t.Fatal("private file leaked")
	}
	if _, _, _, err := h.verifyAttachment(grant+"x", recipient); err == nil {
		t.Fatal("modified grant accepted")
	}
	file.Size++
	input.Attachments = []attachment{file}
	if h.prepareAttachments(sender, &input) == nil {
		t.Fatal("accepted file over 300 MB")
	}
	input.To = ""
	file.Size = 1
	input.Attachments = []attachment{file}
	if h.prepareAttachments(sender, &input) == nil {
		t.Fatal("group accepted generic file")
	}
	_, err = h.relationships.SetBlock(context.Background(), blockChange{Actor: sender.user.ID, Target: recipient, Blocked: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := h.verifyAttachment(grant, recipient); err == nil {
		t.Fatal("block ignored on download")
	}
}

func TestGroupAndPrivateImagesHaveIndependentLimits(t *testing.T) {
	h := newHub([]byte("test"))
	h.attachmentPolicy = func() (map[string]interface{}, error) {
		return map[string]interface{}{
			"loungeFileMaxMb": float64(300), "loungeGroupImageMaxMb": float64(2), "loungeDirectImageMaxMb": float64(5)}, nil
	}
	sender := &peer{user: account{ID: uuid.NewString()}}
	file := attachment{ID: uuid.NewString(), Device: uuid.NewString(), Name: "photo.png", Mime: "image/png",
		Kind: "image", Size: 3 * 1024 * 1024}
	input := incoming{ID: "image", Attachments: []attachment{file}}
	if h.prepareAttachments(sender, &input) == nil {
		t.Fatal("group used private image limit")
	}
	input.To = uuid.NewString()
	if err := h.prepareAttachments(sender, &input); err != nil {
		t.Fatal("private image rejected", err)
	}
	file.Size = 6 * 1024 * 1024
	input.Attachments = []attachment{file}
	if h.prepareAttachments(sender, &input) == nil {
		t.Fatal("private image over limit accepted")
	}
}
