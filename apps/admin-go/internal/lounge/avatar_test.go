package lounge

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"strings"
	"testing"
)

func avatarPicture(t *testing.T, size int) string {
	t.Helper()
	var output bytes.Buffer
	if err := png.Encode(&output, image.NewNRGBA(image.Rect(0, 0, size, size))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
}

func TestLoungeAvatarAcceptsCompleteSquarePNGsUpTo128Pixels(t *testing.T) {
	valid := avatarPicture(t, avatarSize)
	for _, avatar := range []string{"", valid, avatarPicture(t, 48), avatarPicture(t, 32)} {
		if validate(incoming{ID: "valid", Text: "message", Avatar: avatar}) != nil {
			t.Fatal("valid avatar rejected")
		}
	}
	for _, avatar := range []string{avatarPicture(t, 129),
		"https://tracking.example/avatar.png", strings.Replace(valid, "image/png", "image/jpeg", 1),
		"data:image/png;base64," + base64.StdEncoding.EncodeToString(make([]byte, maxAvatarBytes+1)),
		valid[:len(valid)-12]} {
		if validate(incoming{ID: "invalid", Text: "message", Avatar: avatar}) == nil {
			t.Fatal("invalid avatar accepted")
		}
	}
}

func TestLoungeMessageCannotOverwriteServerAvatar(t *testing.T) {
	h, url := fixture(t)
	alice, bob := connect(t, h, url, "alice"), connect(t, h, url, "bob")
	avatar := avatarPicture(t, avatarSize)
	write(t, alice, incoming{Type: "message", ID: "avatar", Text: "hello", Avatar: avatar})
	read(t, alice)
	profile := read(t, bob)["sender"].(map[string]interface{})
	if profile["id"] != "alice" || profile["avatar"] != nil {
		t.Fatal("untrusted message avatar replaced the server profile")
	}
	write(t, alice, incoming{Type: "message", ID: "default", Text: "default avatar"})
	read(t, alice)
	if _, present := read(t, bob)["sender"].(map[string]interface{})["avatar"]; present {
		t.Fatal("server retained a previous avatar")
	}
}

func detailedAvatar(t *testing.T) string {
	t.Helper()
	bitmap := image.NewNRGBA(image.Rect(0, 0, avatarSize, avatarSize))
	random := rand.New(rand.NewSource(1))
	for y := range avatarSize {
		for x := range avatarSize {
			bitmap.SetNRGBA(x, y, color.NRGBA{R: uint8(random.Intn(256)), G: uint8(random.Intn(256)),
				B: uint8(random.Intn(256)), A: uint8(random.Intn(256))})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, bitmap); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
}

func TestLoungeAvatarPreservesDetailed128PixelPNG(t *testing.T) {
	avatar := detailedAvatar(t)
	if len(avatar) <= 21870 {
		t.Fatal("fixture must exceed the old avatar storage limit")
	}
	if _, err := canonicalAvatar(avatar); err != nil {
		t.Fatal("detailed 128px avatar rejected", err)
	}
	var output bytes.Buffer
	if err := png.Encode(&output, image.NewNRGBA(image.Rect(0, 0, 128, 127))); err != nil {
		t.Fatal(err)
	}
	if validateAvatar("data:image/png;base64,"+base64.StdEncoding.EncodeToString(output.Bytes())) == nil {
		t.Fatal("non-square avatar accepted")
	}
}

func TestLoungeAvatarRemovesUploadMetadata(t *testing.T) {
	avatar := avatarPicture(t, avatarSize)
	encoded := strings.TrimPrefix(avatar, "data:image/png;base64,")
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	withMetadata := "data:image/png;base64," + base64.StdEncoding.EncodeToString(append(decoded, []byte("private-extra")...))
	clean, err := canonicalAvatar(withMetadata)
	if err != nil || clean != avatar {
		t.Fatal("profile upload metadata was not stripped", err)
	}
}
