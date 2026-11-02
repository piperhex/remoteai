package updatecache

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMobileReleaseNamesSurviveCacheRestartAndRangeSharing(t *testing.T) {
	for _, name := range []string{
		"RemoteAI-android-v2.1.13.apk", "CodexSwitch-android-v2.1.13.apk",
		"RemoteAI-ios-unsigned.app.zip", "CodexSwitch-ios-unsigned.app.zip",
	} {
		t.Run(name, func(t *testing.T) {
			s, versions, body := fixture(t)
			version := released("v2.1.13", body)
			value := version.Assets[0]
			value.ID, value.Name, value.URL = 42, name, releasePrefix+version.Tag+"/"+name
			version.Assets = []asset{value}
			*versions = []release{version}
			if err := s.refresh(context.Background()); err != nil {
				t.Fatal(err)
			}
			restarted := &cache{root: s.root, records: map[string]record{}}
			if err := restarted.restore(); err != nil {
				t.Fatal(err)
			}
			if len(restarted.records) != 1 {
				t.Fatal("mobile package was excluded from the verified cache")
			}
			assertMobileRanges(t, restarted, value, body)
		})
	}
}

func assertMobileRanges(t *testing.T, s *cache, value asset, body []byte) {
	t.Helper()
	router := gin.New()
	router.GET("/update-packages/:version/:name", s.serve)
	router.HEAD("/update-packages/:version/:name", s.serve)
	for _, path := range []string{"/update-packages/v2.1.13/" + value.Name, "/update-packages/assets/42"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			request := httptest.NewRequest(method, path, nil)
			request.Header.Set("Range", "bytes=13-120")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusPartialContent || response.Header().Get("ETag") != `"`+value.Digest+`"` {
				t.Fatalf("%s %s lost verified range sharing: %d", method, path, response.Code)
			}
			if method == http.MethodGet && !bytes.Equal(response.Body.Bytes(), body[13:121]) {
				t.Fatal("incorrect shared package bytes")
			}
			if method == http.MethodHead && response.Body.Len() != 0 {
				t.Fatal("HEAD sent package bytes")
			}
		}
	}
}
