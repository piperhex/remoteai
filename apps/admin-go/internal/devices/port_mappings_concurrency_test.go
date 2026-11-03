package devices

import (
	"sync"
	"sync/atomic"
	"testing"

	"gorm.io/gorm"
)

func TestPortMappingsConcurrentCAS(t *testing.T) {
	f := newMappingFixture(t)
	f.request(t, "GET", nil)
	var accepted atomic.Int64
	var group sync.WaitGroup
	for range 16 {
		group.Go(func() {
			result, err := f.service.syncPortMappings(t.Context(), f.owner, f.device,
				&mappingDocument{Mappings: []portMapping{}})
			if err != nil || result.Revision != 1 {
				t.Error(result, err)
				return
			}
			if result.Accepted {
				accepted.Add(1)
			}
		})
	}
	group.Wait()
	if accepted.Load() != 1 {
		t.Fatal("CAS winners", accepted.Load())
	}
	if read := f.request(t, "GET", nil); read.Revision != 1 || read.Accepted {
		t.Fatal(read)
	}
}

func TestPortMappingsWriteFencesOlderRead(t *testing.T) {
	f := newMappingFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	var reads atomic.Int64
	if err := f.DB.Callback().Query().After("gorm:query").Register("pause-mapping-read", func(db *gorm.DB) {
		if db.Statement.Table == "device_port_mappings" && reads.Add(1) == 1 {
			close(started)
			<-release
		}
	}); err != nil {
		t.Fatal(err)
	}
	done := make(chan mappingDocument, 1)
	go func() {
		result, err := f.service.cachedPortMappings(t.Context(), f.owner, f.device)
		if err != nil {
			t.Error(err)
		}
		done <- result
	}()
	<-started
	written, err := f.service.syncPortMappings(t.Context(), f.owner, f.device, &mappingDocument{Mappings: []portMapping{}})
	close(release)
	if err != nil || !written.Accepted {
		t.Fatal(written, err)
	}
	if read := <-done; read.Revision != 1 {
		t.Fatal("old read refilled invalidated cache", read)
	}
	if read := f.request(t, "GET", nil); read.Revision != 1 {
		t.Fatal(read)
	}
}
