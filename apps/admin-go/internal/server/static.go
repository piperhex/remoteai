package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

var apiPrefixes = []string{
	"/auth",
	"/sync",
	"/official-usage",
	"/admin/api",
	"/announcements",
	"/notifications",
	"/faqs",
	"/currency-rates",
	"/token-cost-presets",
	"/feedback",
	"/telemetry",
	"/devices",
	"/remote-assistance",
	"/device-switch",
	"/device-chat",
	"/skills",
	"/prompt-plugins",
	"/codex-home-presets",
}

func staticRoutes(router *gin.Engine, directory string) {
	page := func(c *gin.Context) { serveStaticFile(c, filepath.Join(directory, "admin.html")) }
	router.GET("/admin", page)
	router.GET("/admin/reset-password", page)
	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet || apiPath(c.Request.URL.Path) {
			notFound(c)
			return
		}
		relative := strings.TrimPrefix(c.Request.URL.Path, "/")
		if !filepath.IsLocal(relative) {
			notFound(c)
			return
		}
		file := filepath.Join(directory, relative)
		info, err := os.Stat(file)
		if err != nil {
			notFound(c)
			return
		}
		if info.IsDir() && !strings.HasSuffix(c.Request.URL.Path, "/") {
			redirectStaticDirectory(c)
			return
		}
		if !info.Mode().IsRegular() {
			notFound(c)
			return
		}
		serveStaticFile(c, file)
	})
}

func apiPath(path string) bool {
	for _, prefix := range apiPrefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

func notFound(c *gin.Context) {
	original, ok := c.Request.Context().Value(originalRequestKey{}).(originalRequest)
	if !ok {
		original = originalRequest{c.Request.Method, c.Request.URL.RequestURI()}
	}
	platform.Fail(c, 404, "Cannot "+original.Method+" "+original.URI)
}
func serveStaticFile(c *gin.Context, file string) {
	info, err := os.Stat(file)
	if err != nil {
		notFound(c)
		return
	}
	c.Header("Cache-Control", "public, max-age=0")
	// Node's Stats.mtime rounds fractional milliseconds when creating the Date used by etag.
	modifiedMillis := info.ModTime().Round(time.Millisecond).UnixMilli()
	c.Header("ETag", fmt.Sprintf(`W/"%x-%x"`, info.Size(), modifiedMillis))
	c.Header("Accept-Ranges", "bytes")
	c.Header("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))
	if !prepareStaticRequest(c, info) {
		return
	}
	c.File(file)
}

func redirectStaticDirectory(c *gin.Context) {
	target := *c.Request.URL
	target.Path = "/" + strings.TrimLeft(target.Path, "/") + "/"
	if target.RawPath != "" {
		target.RawPath = "/" + strings.TrimLeft(target.RawPath, "/") + "/"
	}
	location := target.RequestURI()
	escaped := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").
		Replace(location)
	body := "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
		"<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to " + escaped + "</pre>\n</body>\n</html>\n"
	c.Set("skipETag", true)
	c.Header("Location", location)
	c.Header("Content-Security-Policy", "default-src 'none'")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusMovedPermanently, "text/html; charset=UTF-8", []byte(body))
}
