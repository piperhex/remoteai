package server

import (
	"bytes"
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

type captureWriter struct {
	gin.ResponseWriter
	Body          bytes.Buffer
	Code          int
	WrittenHeader bool
	Context       context.Context
	Head          bool
	Streaming     bool
}

func (writer *captureWriter) WriteHeader(code int) {
	if !writer.WrittenHeader {
		writer.Code = code
	}
}

func (writer *captureWriter) WriteHeaderNow() {
	if writer.WrittenHeader {
		return
	}
	writer.WrittenHeader = true
	// ServeContent/ServeFile supply validators and lengths before writing. Binary files and
	// partial files need no whole-body transforms; complete text keeps Express compression.
	headers := writer.Header()
	writer.Streaming = headers.Get("Accept-Ranges") == "bytes" &&
		(writer.Code == http.StatusPartialContent ||
			(writer.Code == http.StatusOK && !compressibleContentType(headers.Get("Content-Type"))))
	if writer.Streaming {
		writer.ResponseWriter.WriteHeader(writer.Code)
		writer.ResponseWriter.WriteHeaderNow()
	}
}

func (writer *captureWriter) Write(data []byte) (int, error) {
	writer.WriteHeaderNow()
	if !writer.Streaming {
		return writer.Body.Write(data)
	}
	if err := writer.Context.Err(); err != nil {
		return 0, err
	}
	if writer.Head {
		// GET-only static routes still handle HEAD. Stop ServeFile's copy without reading
		// the entire binary file; explicit download HEAD routes do not start a copy at all.
		return 0, http.ErrBodyNotAllowed
	}
	n, err := writer.ResponseWriter.Write(data)
	if err == nil {
		// Flush even the final short block before the handler releases its admission slot.
		// Unwrap Gin so ResponseController can observe the underlying FlushError result.
		target := http.ResponseWriter(writer.ResponseWriter)
		if unwrapper, ok := target.(interface{ Unwrap() http.ResponseWriter }); ok {
			target = unwrapper.Unwrap()
		}
		err = http.NewResponseController(target).Flush()
	}
	return n, err
}

func (writer *captureWriter) WriteString(data string) (int, error) { return writer.Write([]byte(data)) }
func (writer *captureWriter) Status() int                          { return writer.Code }
func (writer *captureWriter) Size() int {
	if writer.Streaming {
		return writer.ResponseWriter.Size()
	}
	if !writer.WrittenHeader {
		return -1
	}
	return writer.Body.Len()
}
func (writer *captureWriter) Written() bool { return writer.WrittenHeader }
