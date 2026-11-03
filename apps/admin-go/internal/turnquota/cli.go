package turnquota

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const cliTimeout = 2 * time.Second
const maxCLIResponse = 65536

// Never include CLI responses in errors: pc can contain server secrets and paths.
var errControl = errors.New("TURN control channel unavailable or invalid response")
var quotaLine = regexp.MustCompile(`(?m)^\s*(Default total-quota|current realm total-quota): (\d+)`)

type runtimeQuota struct{ Default, Current int }
type cli struct {
	conn   net.Conn
	reader *bufio.Reader
}

func connect(ctx context.Context, config controlConfig) (*cli, error) {
	conn, err := (&net.Dialer{Timeout: cliTimeout}).DialContext(ctx, "tcp", config.address)
	if err != nil {
		return nil, errControl
	}
	c := &cli{conn: conn, reader: bufio.NewReader(conn)}
	deadline := time.Now().Add(cliTimeout)
	if end, ok := ctx.Deadline(); ok && end.Before(deadline) {
		deadline = end
	}
	if err := conn.SetDeadline(deadline); err != nil {
		conn.Close()
		return nil, errControl
	}
	if _, err := c.until("Enter password: "); err != nil {
		conn.Close()
		return nil, err
	}
	if _, err := c.command(config.password); err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

func (c *cli) until(suffix string) (string, error) {
	var response strings.Builder
	for response.Len() < maxCLIResponse {
		value, err := c.reader.ReadByte()
		if err != nil {
			return "", errControl
		}
		response.WriteByte(value)
		if strings.HasSuffix(response.String(), suffix) {
			return response.String(), nil
		}
	}
	return "", errControl
}

func (c *cli) command(value string) (string, error) {
	if _, err := fmt.Fprintf(c.conn, "%s\n", value); err != nil {
		return "", errControl
	}
	return c.until("> ")
}

func (c *cli) read(realm string) (runtimeQuota, error) {
	response, err := c.command("pc")
	if err != nil {
		return runtimeQuota{}, err
	}
	response = strings.ReplaceAll(response, "\r\n", "\n")
	if !strings.Contains(response, "Default realm: "+realm+"\n") {
		return runtimeQuota{}, errControl
	}
	values := map[string]int{}
	for _, match := range quotaLine.FindAllStringSubmatch(response, -1) {
		value, err := strconv.Atoi(match[2])
		if err != nil {
			return runtimeQuota{}, errControl
		}
		values[match[1]] = value
	}
	if len(values) != 2 {
		return runtimeQuota{}, errControl
	}
	return runtimeQuota{Default: values["Default total-quota"], Current: values["current realm total-quota"]}, nil
}

func (c *cli) set(value int) error {
	_, err := c.command("cc total-quota " + strconv.Itoa(value))
	return err
}
