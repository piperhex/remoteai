package updatecache

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

type countedFile struct {
	io.ReadSeeker
	reads int
}

func (file *countedFile) Read(data []byte) (int, error) {
	file.reads++
	return file.ReadSeeker.Read(data)
}

func TestDownloadCancellationStopsFileReads(t *testing.T) {
	for _, cancelBeforeRead := range []bool{true, false} {
		ctx, cancel := context.WithCancel(context.Background())
		file := &countedFile{ReadSeeker: strings.NewReader("download content")}
		content := &downloadContent{ReadSeeker: file, ctx: ctx}
		data := make([]byte, 1)
		if !cancelBeforeRead {
			if _, err := content.Read(data); err != nil {
				t.Fatal(err)
			}
		}
		cancel()
		reads := file.reads
		if n, err := content.Read(data); n != 0 || !errors.Is(err, context.Canceled) || file.reads != reads {
			t.Fatalf("read after cancellation: n=%d err=%v reads=%d before=%d", n, err, file.reads, reads)
		}
	}
}
