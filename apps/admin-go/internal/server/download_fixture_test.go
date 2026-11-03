package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/updatecache"
)

const downloadTestVersion = "v1.0.0"

type downloadTestRecord struct {
	Version string `json:"version"`
	Asset   struct {
		ID     int64  `json:"id"`
		Name   string `json:"name"`
		URL    string `json:"browser_download_url"`
		Digest string `json:"digest"`
		Size   int64  `json:"size"`
	} `json:"asset"`
}

func writeDownloadFixture(t *testing.T, directory, name string, size int64) downloadTestRecord {
	t.Helper()
	file, err := os.Create(filepath.Join(directory, downloadTestVersion, name))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	_, err = io.Copy(io.MultiWriter(file, hash), &generatedContent{size: size})
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		t.Fatalf("write fixture: %v, close: %v", err, closeErr)
	}
	entry := downloadTestRecord{Version: downloadTestVersion}
	entry.Asset.Name, entry.Asset.Size = name, size
	entry.Asset.URL = "https://github.com/piperhex/remoteai/releases/download/" + downloadTestVersion + "/" + name
	entry.Asset.Digest = fmt.Sprintf("sha256:%x", hash.Sum(nil))
	return entry
}

func startDownloadFixture(t *testing.T) (*httptest.Server, <-chan string) {
	t.Helper()
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, downloadTestVersion), 0700); err != nil {
		t.Fatal(err)
	}
	entries := []downloadTestRecord{
		writeDownloadFixture(t, directory, "small.exe", 4<<20),
		writeDownloadFixture(t, directory, "large.exe", 512<<20),
	}
	entries[0].Asset.ID, entries[1].Asset.ID = 101, 102
	data, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "index.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	// Keep the production cache registration, restore, and admission handler. No external
	// release service is needed: a failed refresh leaves the verified local index intact.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(proxy.Close)
	router := transportRouter()
	stop := updatecache.Register(router, platform.Config{"UPDATE_CACHE_DIR": directory, "UPDATE_CACHE_PROXY": proxy.URL})
	t.Cleanup(stop)
	finished := make(chan string, 128)
	handler := Handler(router)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if id := r.URL.Query().Get("client"); id != "" {
				finished <- id
			}
		}()
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	waitForDownloadFixture(t, server)
	return server, finished
}

func waitForDownloadFixture(t *testing.T, server *httptest.Server) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		response, err := server.Client().Head(server.URL + "/update-packages/assets/102")
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode == http.StatusOK {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("verified download cache did not become ready")
}

func slowDownloadClient(t *testing.T) *http.Client {
	t.Helper()
	transport := &http.Transport{
		DisableCompression: true, ResponseHeaderTimeout: 5 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			connection, err := (&net.Dialer{}).DialContext(ctx, network, address)
			if err != nil {
				return nil, err
			}
			if err := connection.(*net.TCPConn).SetReadBuffer(64 * 1024); err != nil {
				connection.Close()
				return nil, err
			}
			return connection, nil
		},
	}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: 30 * time.Second}
}
