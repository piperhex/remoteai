package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

const streamTestBlock = 32 * 1024

type generatedContent struct {
	size, offset, read int64
	failAfter          int64
}

func (content *generatedContent) Read(data []byte) (int, error) {
	if content.failAfter > 0 && content.read >= content.failAfter {
		return 0, io.ErrUnexpectedEOF
	}
	n := int(min(int64(len(data)), content.size-content.offset))
	clear(data[:n])
	content.offset += int64(n)
	content.read += int64(n)
	if n == 0 {
		return 0, io.EOF
	}
	return n, nil
}

func (content *generatedContent) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekStart:
		content.offset = offset
	case io.SeekCurrent:
		content.offset += offset
	case io.SeekEnd:
		content.offset = content.size + offset
	}
	return content.offset, nil
}

type observedStream struct {
	header                 http.Header
	bytes, writes, flushes int
	write                  func([]byte) error
	flush                  func() error
}

func (writer *observedStream) Header() http.Header { return writer.header }
func (writer *observedStream) WriteHeader(int)     {}
func (writer *observedStream) Write(data []byte) (int, error) {
	writer.writes++
	if writer.write != nil {
		if err := writer.write(data); err != nil {
			return 0, err
		}
	}
	writer.bytes += len(data)
	return len(data), nil
}
func (writer *observedStream) FlushError() error {
	writer.flushes++
	if writer.flush != nil {
		return writer.flush()
	}
	return nil
}

func TestFileResponseStreamsWithBoundedReadsAndOccupiedSlot(t *testing.T) {
	for _, size := range []int64{4 << 20, 512 << 20} {
		t.Run(strconv.FormatInt(size, 10), func(t *testing.T) {
			content := &generatedContent{size: size}
			slots := make(chan struct{}, 16)
			response := &observedStream{header: make(http.Header)}
			response.write = func(data []byte) error {
				if len(slots) != 1 || len(data) > streamTestBlock || content.read > int64(response.bytes+streamTestBlock) {
					t.Fatalf("slot=%d block=%d file reads=%d sent=%d", len(slots), len(data), content.read, response.bytes)
				}
				return nil
			}
			response.flush = func() error {
				if len(slots) != 1 {
					t.Fatal("slot released before network flush")
				}
				return nil
			}
			handler := fileStreamHandler(content, slots)
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/download", nil))
			if int64(response.bytes) != size || response.writes != response.flushes || len(slots) != 0 {
				t.Fatalf("bytes=%d writes=%d flushes=%d slots=%d", response.bytes, response.writes, response.flushes, len(slots))
			}
		})
	}
}

func fileStreamHandler(content io.ReadSeeker, slots chan struct{}) http.Handler {
	router := transportRouter()
	serve := func(c *gin.Context) {
		slots <- struct{}{}
		defer func() { <-slots }()
		c.Header("Content-Type", "application/octet-stream")
		http.ServeContent(c.Writer, c.Request, "download.exe", time.Time{}, content)
	}
	router.GET("/download", serve)
	router.HEAD("/download", serve)
	return Handler(router)
}

func TestFileStreamFailuresStopCopyAndReleaseSlot(t *testing.T) {
	for _, failure := range []string{"write", "flush", "read", "cancel"} {
		t.Run(failure, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			content := &generatedContent{size: 4 << 20}
			slots := make(chan struct{}, 16)
			response := &observedStream{header: make(http.Header)}
			failureError := errors.New("test transfer failed")
			switch failure {
			case "write":
				response.write = func([]byte) error { return failureError }
			case "flush":
				response.flush = func() error { return failureError }
			case "read":
				content.failAfter = streamTestBlock
			case "cancel":
				response.flush = func() error { cancel(); return nil }
			}
			request := httptest.NewRequest("GET", "/download", nil).WithContext(ctx)
			fileStreamHandler(content, slots).ServeHTTP(response, request)
			if content.read > 2*streamTestBlock || response.writes != 1 || len(slots) != 0 {
				t.Fatalf("read=%d writes=%d slots=%d", content.read, response.writes, len(slots))
			}
		})
	}
}

func TestExplicitFileHeadDoesNotReadContent(t *testing.T) {
	content := &generatedContent{size: 512 << 20}
	handler := fileStreamHandler(content, make(chan struct{}, 16))
	response := responseFor(handler, "HEAD", "/DOWNLOAD/", http.Header{"Range": {"bytes=13-120"}})
	if response.Code != 206 || response.Body.Len() != 0 || content.read != 0 ||
		response.Header().Get("Content-Length") != "108" {
		t.Fatalf("HEAD status=%d headers=%v bytes read=%d", response.Code, response.Header(), content.read)
	}
}

func TestStaticBinaryAndTextRangesStream(t *testing.T) {
	root := t.TempDir()
	data := strings.Repeat("body{color:green}\n", 4096)
	for _, name := range []string{"download.zip", "app.css"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	router := transportRouter()
	staticRoutes(router, root)
	for _, name := range []string{"download.zip", "app.css"} {
		response := &observedStream{header: make(http.Header)}
		request := httptest.NewRequest("GET", "/"+name, nil)
		if name == "app.css" {
			request.Header.Set("Range", "bytes=0-65535")
		}
		Handler(router).ServeHTTP(response, request)
		if response.writes < 2 || response.writes != response.flushes {
			t.Fatalf("%s was not streamed: writes=%d flushes=%d", name, response.writes, response.flushes)
		}
	}
	head := responseFor(Handler(router), "HEAD", "/download.zip", http.Header{})
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Length") != strconv.Itoa(len(data)) {
		t.Fatalf("static HEAD = %d %v", head.Code, head.Header())
	}
}
