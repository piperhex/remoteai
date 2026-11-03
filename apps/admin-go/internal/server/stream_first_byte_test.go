package server

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type gatedContent struct {
	generatedContent
	ctx    context.Context
	resume <-chan struct{}
}

func (content *gatedContent) Read(data []byte) (int, error) {
	if content.read >= streamTestBlock {
		select {
		case <-content.resume:
		case <-content.ctx.Done():
			return 0, content.ctx.Err()
		}
	}
	return content.generatedContent.Read(data)
}

func TestFileStreamFirstBytePrecedesRemainingFileReads(t *testing.T) {
	resume := make(chan struct{})
	release := sync.OnceFunc(func() { close(resume) })
	defer release()
	router := transportRouter()
	router.GET("/download", func(c *gin.Context) {
		content := &gatedContent{generatedContent: generatedContent{size: 4 << 20}, ctx: c.Request.Context(), resume: resume}
		c.Header("Content-Type", "application/octet-stream")
		http.ServeContent(c.Writer, c.Request, "download.exe", time.Time{}, content)
	})
	server := httptest.NewServer(Handler(router))
	defer server.Close()
	client := server.Client()
	client.Timeout = 5 * time.Second
	response, err := client.Get(server.URL + "/download")
	if err != nil {
		release()
		t.Fatal(err)
	}
	defer response.Body.Close()
	first := make([]byte, 1)
	if _, err := io.ReadFull(response.Body, first); err != nil {
		t.Fatal(err)
	}
	// The server cannot read the rest until the client has actually received body bytes.
	release()
	remaining, err := io.Copy(io.Discard, response.Body)
	if err != nil || remaining != (4<<20)-1 {
		t.Fatalf("remaining=%d err=%v", remaining, err)
	}
}
