package lounge

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"strings"
)

const avatarSize = 128

// Allow an uncompressed RGBA bitmap plus PNG framing without reducing image quality.
const maxAvatarBytes = 80 * 1024

// Both profile uploads and legacy message fields are limited to complete, small PNGs.
func validateAvatar(data string) error {
	if data == "" {
		return nil
	}
	payload, ok := strings.CutPrefix(data, "data:image/png;base64,")
	if !ok || len(payload) > base64.StdEncoding.EncodedLen(maxAvatarBytes) {
		return errInvalid
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil || len(decoded) > maxAvatarBytes {
		return errInvalid
	}
	config, err := png.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || config.Width < 1 || config.Width > avatarSize || config.Height != config.Width {
		return errInvalid
	}
	if _, err := png.Decode(bytes.NewReader(decoded)); err != nil {
		return errInvalid
	}
	return nil
}

// Re-encode just the bitmap so uploaded metadata and trailing bytes are never persisted.
func canonicalAvatar(data string) (string, error) {
	if err := validateAvatar(data); err != nil || data == "" {
		return "", err
	}
	payload := strings.TrimPrefix(data, "data:image/png;base64,")
	decoded, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil {
		return "", errInvalid
	}
	bitmap, err := png.Decode(bytes.NewReader(decoded))
	if err != nil {
		return "", errInvalid
	}
	var output bytes.Buffer
	if err := png.Encode(&output, bitmap); err != nil || output.Len() > maxAvatarBytes {
		return "", errInvalid
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes()), nil
}
