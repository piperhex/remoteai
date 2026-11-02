// Package lounge forwards live conversation frames without persistence or logging.
package lounge

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
	"unicode/utf8"
)

const (
	maxFrameBytes      = 6 * 1024 * 1024
	maxImageBytes      = 1024 * 1024
	maxTotalImageBytes = 3 * 1024 * 1024
	maxImages          = 3
	maxTextLength      = 4000
	maxImagePixels     = 20_000_000
)

type incoming struct {
	AvatarCache    bool              `json:"avatarCache"`
	AvatarVersions map[string]string `json:"avatarVersions"`
	Attachments    []attachment      `json:"attachments,omitempty"`
	Conversation   *string           `json:"conversation"`
	Muted          *bool             `json:"muted"`
	Type           string            `json:"type"`
	Ticket         string            `json:"ticket"`
	ID             string            `json:"id"`
	Text           string            `json:"text"`
	Query          string            `json:"query"`
	Cursor         string            `json:"cursor"`
	Images         []string          `json:"images"`
	Avatar         string            `json:"avatar"`
	Nickname       string            `json:"nickname"`
	Remark         string            `json:"remark"`
	UserID         string            `json:"userId"`
	Minutes        *int              `json:"minutes"`
	Reply          *replyQuote       `json:"reply,omitempty"`
	To             string            `json:"to,omitempty"`
	Blocked        *bool             `json:"blocked"`
	Watch          []string          `json:"watch"`
	Direct         bool              `json:"direct"`
	Receipts       bool              `json:"receipts"`
	GroupAcks      bool              `json:"groupAcks"`
	Status         string            `json:"status"`
	Generation     int64             `json:"generation,omitempty"`
}

type account struct {
	ID        string `json:"id"`
	Account   string `json:"account"`
	Avatar    string `json:"avatar,omitempty"`
	Nickname  string `json:"nickname,omitempty"`
	Moderator bool   `json:"moderator"`
}

type message struct {
	Attachments []attachment `json:"attachments,omitempty"`
	Type        string       `json:"type"`
	ID          string       `json:"id"`
	Sender      account      `json:"sender"`
	Text        string       `json:"text"`
	Images      []string     `json:"images"`
	SentAt      string       `json:"sentAt"`
	Reply       *replyQuote  `json:"reply,omitempty"`
	Recipient   *account     `json:"recipient,omitempty"`
	Receipts    bool         `json:"receipts,omitempty"`
	Generation  int64        `json:"generation,omitempty"`
}

var errInvalid = errors.New("invalid lounge frame")

func validate(input incoming) error {
	if len(input.ID) < 1 || len(input.ID) > 80 || utf8.RuneCountInString(input.Text) > maxTextLength ||
		len(input.Images) > maxImages || len(input.To) > 80 || input.Generation < 0 ||
		(strings.TrimSpace(input.Text) == "" && len(input.Images) == 0 && len(input.Attachments) == 0) {
		return errInvalid
	}
	total := 0
	for _, data := range input.Images {
		size, err := validateImage(data)
		if err != nil {
			return err
		}
		total += size
	}
	if total > maxTotalImageBytes {
		return errInvalid
	}
	if validateAvatar(input.Avatar) != nil || validateReply(input.Reply) != nil {
		return errInvalid
	}
	return nil
}

func validateImage(data string) (int, error) {
	return validateImageLimit(data, maxImageBytes)
}

func validateImageLimit(data string, limit int64) (int, error) {
	header, payload, ok := strings.Cut(data, ",")
	formats := map[string]string{"data:image/png;base64": "png", "data:image/jpeg;base64": "jpeg",
		"data:image/gif;base64": "gif"}
	format := formats[header]
	if !ok || format == "" || int64(len(payload)) > (limit+2)/3*4 {
		return 0, errInvalid
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil || int64(len(decoded)) > limit {
		return 0, errInvalid
	}
	config, actual, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || actual != format || config.Width <= 0 || config.Height <= 0 ||
		int64(config.Width)*int64(config.Height) > maxImagePixels {
		return 0, errInvalid
	}
	return len(decoded), nil
}
