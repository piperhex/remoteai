package server

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type originalRequest struct{ Method, URI string }
type originalRequestKey struct{}

// Handler matches Express' case-insensitive routing, optional trailing slash and HEAD support.
func Handler(router *gin.Engine) http.Handler {
	routes := router.Routes()
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		original := originalRequest{request.Method, request.URL.RequestURI()}
		request = request.Clone(context.WithValue(request.Context(), originalRequestKey{}, original))
		if request.Method == http.MethodHead && canonicalRoute(routes, http.MethodHead, request.URL.EscapedPath()) == "" {
			request.Method = http.MethodGet
		}
		path := request.URL.EscapedPath()
		canonical := canonicalRoute(routes, request.Method, path)
		if canonical != "" && canonical != path {
			request.URL.RawPath = canonical
			decoded, err := url.PathUnescape(canonical)
			if err == nil {
				request.URL.Path = decoded
			}
		}
		router.ServeHTTP(writer, request)
	})
}
func canonicalRoute(routes gin.RoutesInfo, method, path string) string {
	candidate := strings.TrimSuffix(path, "/")
	if candidate == "" {
		candidate = "/"
	}
	parts := strings.Split(candidate, "/")
	for _, route := range routes {
		if route.Method != method {
			continue
		}
		pattern := strings.Split(route.Path, "/")
		if len(pattern) != len(parts) {
			continue
		}
		output := append([]string{}, parts...)
		matched := true
		for index, part := range pattern {
			if strings.HasPrefix(part, ":") {
				if parts[index] == "" {
					matched = false
				}
				continue
			}
			if !strings.EqualFold(part, parts[index]) {
				matched = false
				break
			}
			output[index] = part
		}
		if matched {
			return strings.Join(output, "/")
		}
	}
	return ""
}

func transportHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Powered-By", "Express")
		if strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
			c.Next()
			return
		}
		original, _ := c.Request.Context().Value(originalRequestKey{}).(originalRequest)
		writer := &captureWriter{ResponseWriter: c.Writer, Code: http.StatusOK,
			Context: c.Request.Context(), Head: original.Method == http.MethodHead}
		c.Writer = writer
		c.Next()
		if writer.Streaming {
			return
		}
		data := writer.Body.Bytes()
		headers := writer.Header()
		if len(data) > 0 && headers.Get("ETag") == "" && !c.GetBool("skipETag") {
			sum := sha1.Sum(data)
			headers.Set("ETag", fmt.Sprintf(`W/"%x-%s"`, len(data), base64.RawStdEncoding.EncodeToString(sum[:])))
		}
		if freshResponse(c, writer.Code, headers.Get("ETag")) {
			writer.Code = http.StatusNotModified
			data = nil
			headers.Del("Content-Type")
			headers.Del("Content-Length")
		}
		data = compressResponse(c.Request, writer, data)
		if headers.Get("Content-Length") == "" && writer.Code != 204 && writer.Code != 304 {
			headers.Set("Content-Length", strconv.Itoa(len(data)))
		}
		if writer.Code == http.StatusNoContent && c.Request.Method == http.MethodOptions {
			// net/http removes canonical Content-Length on 204; Express exposes a zero-length preflight.
			headers.Del("Content-Length")
			headers["content-length"] = []string{"0"}
		}
		writer.ResponseWriter.WriteHeader(writer.Code)
		if len(data) > 0 && original.Method != http.MethodHead {
			// A disconnected client cannot receive another error response after headers have been written.
			_, _ = writer.ResponseWriter.Write(data)
		}
		writer.ResponseWriter.WriteHeaderNow()
	}
}
func freshResponse(c *gin.Context, status int, etag string) bool {
	if c.Request.Method != http.MethodGet || status < 200 || status >= 300 ||
		strings.Contains(c.GetHeader("Cache-Control"), "no-cache") {
		return false
	}
	for _, tag := range strings.Split(c.GetHeader("If-None-Match"), ",") {
		tag = strings.TrimSpace(tag)
		if tag == "*" || (etag != "" && strings.TrimPrefix(tag, "W/") == strings.TrimPrefix(etag, "W/")) {
			return true
		}
	}
	return false
}
