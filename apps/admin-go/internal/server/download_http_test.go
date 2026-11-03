package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strconv"
	"testing"
	"time"
)

const (
	slowDownloadReadRounds = 5
	slowDownloadReadBytes  = 1024
)

func TestUpdateDownloadsHTTP(t *testing.T) {
	server, finished := startDownloadFixture(t)
	t.Run("protocol", func(t *testing.T) { checkDownloadProtocol(t, server) })
	t.Run("bounded_memory", func(t *testing.T) { checkDownloadMemory(t, server) })
	t.Run("slow_clients", func(t *testing.T) { checkDownloadAdmission(t, server, finished) })
}

func downloadResponse(t *testing.T, client *http.Client, request *http.Request, status int) *http.Response {
	t.Helper()
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status {
		response.Body.Close()
		t.Fatalf("%s %s: status=%d, want %d", request.Method, request.URL, response.StatusCode, status)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func downloadRequest(t *testing.T, method, url string, headers http.Header) *http.Request {
	t.Helper()
	request, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if headers != nil {
		request.Header = headers
	}
	return request
}

func checkDownloadProtocol(t *testing.T, server *httptest.Server) {
	url := server.URL + "/update-packages/v1.0.0/small.exe"
	head := downloadResponse(t, server.Client(), downloadRequest(t, "HEAD", url, nil), 200)
	etag, modified := head.Header.Get("ETag"), head.Header.Get("Last-Modified")
	if head.ContentLength != 4<<20 || etag == "" || modified == "" ||
		head.Header.Get("Cache-Control") != "public, max-age=3600" ||
		head.Header.Get("X-Content-Type-Options") != "nosniff" || head.Header.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("HEAD headers=%v", head.Header)
	}
	cases := []struct {
		method  string
		headers http.Header
		status  int
		length  int64
	}{
		{"GET", http.Header{"Range": {"bytes=13-120"}, "Accept-Encoding": {"gzip"}}, 206, 108},
		{"HEAD", http.Header{"Range": {"bytes=13-120"}}, 206, 0},
		{"GET", http.Header{"Range": {"bytes=999999999-"}}, 416, -1},
		{"GET", http.Header{"Range": {"bytes=0-1,3-4"}}, 416, 0},
		{"GET", http.Header{"If-None-Match": {etag}}, 304, 0},
		{"HEAD", http.Header{"If-None-Match": {etag}}, 304, 0},
		{"GET", http.Header{"If-Modified-Since": {modified}}, 304, 0},
		{"GET", http.Header{"If-Match": {`"different"`}}, 412, 0},
		{"GET", http.Header{"Range": {"bytes=13-120"}, "If-Range": {etag}}, 206, 108},
		{"GET", http.Header{"Range": {"bytes=13-120"}, "If-Range": {`"different"`}}, 200, 4 << 20},
	}
	for _, item := range cases {
		response := downloadResponse(t, server.Client(), downloadRequest(t, item.method, url, item.headers), item.status)
		size, err := io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if err != nil || (item.length >= 0 && size != item.length) || response.Header.Get("Content-Encoding") != "" {
			t.Fatalf("%s %v: size=%d err=%v headers=%v", item.method, item.headers, size, err, response.Header)
		}
		if item.status == 206 &&
			(response.ContentLength != 108 || response.Header.Get("Content-Range") != "bytes 13-120/4194304") {
			t.Fatalf("range headers=%v", response.Header)
		}
		if item.headers.Get("Range") == "bytes=999999999-" && response.Header.Get("Content-Range") != "bytes */4194304" {
			t.Fatalf("unsatisfiable range headers=%v", response.Header)
		}
	}
}

func checkDownloadMemory(t *testing.T, server *httptest.Server) {
	for _, item := range []struct {
		id   string
		size int64
	}{{"101", 4 << 20}, {"102", 512 << 20}} {
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		started := time.Now()
		request := downloadRequest(t, "GET", server.URL+"/update-packages/assets/"+item.id, nil)
		response := downloadResponse(t, server.Client(), request, 200)
		first := make([]byte, 1)
		if _, err := io.ReadFull(response.Body, first); err != nil {
			t.Fatal(err)
		}
		firstByte := time.Since(started)
		size, err := io.Copy(io.Discard, response.Body)
		response.Body.Close()
		runtime.ReadMemStats(&after)
		allocated := after.TotalAlloc - before.TotalAlloc
		if err != nil || size+1 != item.size || allocated > 8<<20 {
			t.Fatalf("size=%d err=%v allocated=%d", size+1, err, allocated)
		}
		t.Logf("HTTP download=%d MiB, first byte=%s, total Go allocation=%d KiB, duration=%s",
			item.size>>20, firstByte, allocated>>10, time.Since(started))
	}
}

func checkDownloadAdmission(t *testing.T, server *httptest.Server, finished <-chan string) {
	client := slowDownloadClient(t)
	open := func(id string, status int) *http.Response {
		url := server.URL + "/update-packages/assets/102?client=" + id
		request := downloadRequest(t, "GET", url, http.Header{"Range": {"bytes=0-8388607"}})
		return downloadResponse(t, client, request, status)
	}
	responses := openSlowDownloads(t, open)
	open("rejected", 503).Body.Close()
	waitForDownloadEnd(t, finished, "rejected")
	responses[1].Body.Close()
	waitForDownloadEnd(t, finished, "1")
	open("after-cancel", 206)
	remaining, err := io.Copy(io.Discard, responses[0].Body)
	responses[0].Body.Close()
	if err != nil || remaining != (8<<20)-slowDownloadReadRounds*slowDownloadReadBytes {
		t.Fatalf("complete download: bytes=%d err=%v", remaining, err)
	}
	waitForDownloadEnd(t, finished, "0")
	open("after-complete", 206)
	open("still-full", 503).Body.Close()
	waitForDownloadEnd(t, finished, "still-full")
	t.Log("16 slow downloads remained admitted; request 17 returned 503; cancellation and completion each freed one slot")
}

func openSlowDownloads(t *testing.T, open func(string, int) *http.Response) []*http.Response {
	t.Helper()
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	responses := make([]*http.Response, 16)
	for index := range responses {
		responses[index] = open(strconv.Itoa(index), 206)
	}
	// Drain only a small block at controlled intervals; each 8 MiB response remains active.
	block := make([]byte, slowDownloadReadBytes)
	for range slowDownloadReadRounds {
		for _, response := range responses {
			if _, err := io.ReadFull(response.Body, block); err != nil {
				t.Fatal(err)
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	runtime.ReadMemStats(&after)
	allocated := after.TotalAlloc - before.TotalAlloc
	if allocated > 16<<20 {
		t.Fatalf("16 slow downloads allocated %d bytes", allocated)
	}
	t.Logf("16 concurrent slow downloads: total Go allocation=%d KiB", allocated>>10)
	return responses
}

func waitForDownloadEnd(t *testing.T, finished <-chan string, id string) {
	t.Helper()
	select {
	case actual := <-finished:
		if actual != id {
			t.Fatalf("download %s ended while waiting for %s; a slow response completed prematurely", actual, id)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("download %s did not end after completion/cancellation", id)
	}
}
