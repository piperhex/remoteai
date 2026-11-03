package updatecache

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

const maxConcurrentDownloads = 16

// Register serves only already cached official assets. Public requests cannot trigger fetches or choose upstream URLs.
func Register(router *gin.Engine, config platform.Config) func() {
	ctx, cancel := context.WithCancel(context.Background())
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxy, err := url.Parse(config.Get("UPDATE_CACHE_PROXY", "")); err == nil && proxy.Host != "" {
		transport.Proxy = http.ProxyURL(proxy)
	}
	s := &cache{root: config.Get("UPDATE_CACHE_DIR", ""), catalogURL: releaseAPI,
		client:  &http.Client{Transport: transport, Timeout: 20 * time.Minute},
		records: map[string]record{}, done: make(chan struct{})}
	if s.root != "" {
		go s.run(ctx)
	} else {
		close(s.done)
	}
	s.registerRoutes(router)
	return func() { cancel(); <-s.done; transport.CloseIdleConnections() }
}

func (s *cache) registerRoutes(router *gin.Engine) {
	slots := make(chan struct{}, maxConcurrentDownloads)
	handler := func(c *gin.Context) {
		defer func() {
			if c.Writer.Status() >= http.StatusBadRequest {
				slog.Warn("update server download failed", "status", c.Writer.Status(), "method", c.Request.Method)
			}
		}()
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			c.Status(http.StatusServiceUnavailable)
			return
		}
		s.serve(c)
	}
	router.GET("/update-packages/:version/:name", handler)
	router.HEAD("/update-packages/:version/:name", handler)
	router.GET("/update-packages", s.status)
}

func (s *cache) serve(c *gin.Context) {
	version, name := c.Param("version"), c.Param("name")
	if len(c.GetHeader("Range")) > 128 || strings.Contains(c.GetHeader("Range"), ",") {
		c.Status(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	s.mu.RLock()
	entry, ok := s.lookup(version, name)
	var file *os.File
	var err error
	if ok {
		file, err = os.Open(filepath.Join(s.root, entry.Version, entry.Asset.Name))
	}
	s.mu.RUnlock()
	if !ok || err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != entry.Asset.Size {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("ETag", `"`+entry.Asset.Digest+`"`)
	c.Header("Cache-Control", "public, max-age=3600")
	c.Header("Content-Type", "application/octet-stream")
	c.Header("X-Content-Type-Options", "nosniff")
	content := &downloadContent{ReadSeeker: file, ctx: c.Request.Context()}
	http.ServeContent(c.Writer, c.Request, entry.Asset.Name, info.ModTime(), content)
}

// Keep cancellation visible between file reads, including before the first network write.
// Wrapping the file also prevents optional copy fast paths from bypassing this check.
type downloadContent struct {
	io.ReadSeeker
	ctx context.Context
}

func (content *downloadContent) Read(data []byte) (int, error) {
	if err := content.ctx.Err(); err != nil {
		return 0, err
	}
	return content.ReadSeeker.Read(data)
}

// lookup requires mu to be held. Asset IDs only resolve already verified, retained files.
func (s *cache) lookup(version, name string) (record, bool) {
	if version == "assets" {
		id, err := strconv.ParseInt(name, 10, 64)
		if err != nil || id <= 0 || strconv.FormatInt(id, 10) != name {
			return record{}, false
		}
		for _, entry := range s.records {
			if entry.Asset.ID == id {
				return entry, true
			}
		}
		return record{}, false
	}
	if versionParts(version) == nil || !namePattern.MatchString(name) {
		return record{}, false
	}
	entry, ok := s.records[key(version, name)]
	return entry, ok
}

func (s *cache) status(c *gin.Context) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	versions := append([]string{}, s.versions...)
	sort.Strings(versions)
	var bytes int64
	for _, entry := range s.records {
		bytes += entry.Asset.Size
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"versions": versions, "files": len(s.records), "bytes": bytes})
}
