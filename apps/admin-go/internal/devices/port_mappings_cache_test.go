package devices

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/readcache/testfixture"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type mappingFixture struct {
	testfixture.Store
	service *Service
	owner   string
	device  string
	router  *gin.Engine
}

func newMappingFixture(t *testing.T) mappingFixture {
	t.Helper()
	store := testfixture.Open(t)
	if err := store.DB.AutoMigrate(&Device{}, &mappingDocument{}, &serviceCredential{}); err != nil {
		t.Fatal(err)
	}
	if err := store.DB.Exec(`ALTER TABLE device_port_mappings ADD FOREIGN KEY ("ownerId", "deviceId")
		REFERENCES remote_devices("ownerId", "deviceId") ON DELETE CASCADE`).Error; err != nil {
		t.Fatal(err)
	}
	f := mappingFixture{Store: store, service: &Service{&platform.Dependencies{DB: store.DB, Redis: store.Redis}},
		owner: uuid.NewString(), device: uuid.NewString(), router: gin.New()}
	if err := store.DB.Create(&Device{OwnerID: f.owner, DeviceID: f.device, Name: "fixture"}).Error; err != nil {
		t.Fatal(err)
	}
	f.router.Use(func(c *gin.Context) {
		owner := c.GetHeader("X-Fixture-Owner")
		if owner == "" {
			owner = f.owner
		}
		c.Set("principal", &platform.Principal{ID: owner})
	})
	f.service.registerPortMappings(f.router.Group("/devices"))
	gateway := &ControlGateway{service: f.service, sockets: map[string]*peer{}}
	f.router.DELETE("/devices/:deviceId", gateway.remove)
	t.Cleanup(func() { platform.InvalidatePortMappings(f.service.deps, f.owner, f.device) })
	return f
}

func (f mappingFixture) request(t *testing.T, method string, document *mappingDocument) mappingDocument {
	t.Helper()
	var body bytes.Buffer
	if document != nil {
		if err := json.NewEncoder(&body).Encode(document); err != nil {
			t.Fatal(err)
		}
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, "/devices/"+f.device+"/port-mappings", &body)
	f.router.ServeHTTP(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("%s: %d %s", method, recorder.Code, recorder.Body.String())
	}
	var result mappingDocument
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

type mappingPool struct {
	gorm.ConnPool
	begins atomic.Int64
}

func (pool *mappingPool) BeginTx(ctx context.Context, opts *sql.TxOptions) (gorm.ConnPool, error) {
	pool.begins.Add(1)
	return pool.ConnPool.(gorm.TxBeginner).BeginTx(ctx, opts)
}

func TestPortMappingsReadSQLBudgetAndNoTransactions(t *testing.T) {
	f := newMappingFixture(t)
	pool := &mappingPool{ConnPool: f.DB.Statement.ConnPool}
	f.service.deps.DB = f.DB.Session(&gorm.Session{NewDB: true})
	f.service.deps.DB.Statement.ConnPool = pool
	f.Queries.Count.Store(0)
	f.request(t, "GET", nil)
	if count := f.Queries.Count.Load(); count != 2 {
		t.Fatalf("cold queries=%d, want owner + config", count)
	}
	f.Queries.Count.Store(0)
	// Keep this sample warm even on a slow Windows fixture; the production TTL is asserted separately.
	if err := f.Redis.PExpire(t.Context(), platform.PortMappingsCacheKey(f.owner, f.device), time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	for range 1000 {
		f.request(t, "GET", nil)
	}
	if count := f.Queries.Count.Load(); count != 1000 {
		t.Fatalf("warm queries=%d, want 1000 live owner checks", count)
	}
	if pool.begins.Load() != 0 {
		t.Fatal("GET began a transaction")
	}
	t.Log("1000 warm GETs: 1000 live ownership SELECTs, 0 configuration SELECTs, 0 BEGIN/COMMIT or lock queries")
}

func TestPortMappingsCacheWritesDeletesAndIsolation(t *testing.T) {
	f := newMappingFixture(t)
	initial := f.request(t, "GET", nil)
	initial.Mappings = []portMapping{{ID: "one", RemoteHost: "127.0.0.1", RemotePort: 80, LocalPort: 8080}}
	saved := f.request(t, "PUT", &initial)
	if !saved.Accepted || saved.Revision != 1 {
		t.Fatal(saved)
	}
	read := f.request(t, "GET", nil)
	assertMappingOwnership(t, f)
	read.Mappings[0].LocalPort = 9090
	if next := f.request(t, "GET", nil); next.Accepted || next.Mappings[0].LocalPort != 8080 {
		t.Fatal(next)
	}
	for _, pair := range [][2]string{{uuid.NewString(), f.device}, {f.owner, uuid.NewString()}} {
		other, err := f.service.cachedPortMappings(t.Context(), pair[0], pair[1])
		if err != nil || other.Revision != 0 || len(other.Mappings) != 0 {
			t.Fatal("cache isolation", other, err)
		}
		platform.InvalidatePortMappings(f.service.deps, pair[0], pair[1])
	}
	saved.Mappings = []portMapping{}
	deleted := f.request(t, "PUT", &saved)
	if !deleted.Accepted || deleted.Revision != 2 {
		t.Fatal(deleted)
	}
	if read := f.request(t, "GET", nil); read.Revision != 2 || len(read.Mappings) != 0 {
		t.Fatal(read)
	}
	if stale := f.request(t, "PUT", &initial); stale.Accepted || stale.Revision != 2 {
		t.Fatal(stale)
	}
	if ttl := f.Redis.PTTL(t.Context(), platform.PortMappingsCacheKey(f.owner, f.device)).Val(); ttl <= 0 || ttl > 5*time.Second {
		t.Fatal("unbounded cache lifetime", ttl)
	}
	assertMappingDeviceRemoval(t, f)
}

func assertMappingOwnership(t *testing.T, f mappingFixture) {
	t.Helper()
	for _, method := range []string{"GET", "PUT"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(method, "/devices/"+f.device+"/port-mappings", nil)
		request.Header.Set("X-Fixture-Owner", uuid.NewString())
		f.router.ServeHTTP(recorder, request)
		if recorder.Code != 404 {
			t.Fatal("warm cache bypassed live owner check", method, recorder.Code)
		}
	}
}

func assertMappingDeviceRemoval(t *testing.T, f mappingFixture) {
	t.Helper()
	// A warm cache must not bypass ownership after a cascading device removal.
	recorder := httptest.NewRecorder()
	f.router.ServeHTTP(recorder, httptest.NewRequest("DELETE", "/devices/"+f.device, nil))
	if recorder.Code != 204 {
		t.Fatal(recorder.Code, recorder.Body.String())
	}
	if f.Redis.Exists(t.Context(), platform.PortMappingsCacheKey(f.owner, f.device)).Val() != 0 {
		t.Fatal("device deletion did not invalidate cache")
	}
	recorder = httptest.NewRecorder()
	f.router.ServeHTTP(recorder, httptest.NewRequest("GET", "/devices/"+f.device+"/port-mappings", nil))
	if recorder.Code != 404 {
		t.Fatal("deleted device read from cache", recorder.Code)
	}
}

func TestPortMappingsReadDoesNotWaitForWriterLock(t *testing.T) {
	f := newMappingFixture(t)
	tx := f.DB.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "port-mappings:"+f.owner+":"+f.device).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	read, err := f.service.syncPortMappings(ctx, f.owner, f.device, nil)
	if err != nil || read.Revision != 0 {
		t.Fatal("GET waited on writer lock", read, err)
	}
	// Another device's writes must also remain independent of the held lock.
	other := uuid.NewString()
	if err := f.DB.Create(&Device{OwnerID: f.owner, DeviceID: other}).Error; err != nil {
		t.Fatal(err)
	}
	write, err := f.service.syncPortMappings(ctx, f.owner, other, &mappingDocument{Mappings: []portMapping{}})
	if err != nil || !write.Accepted {
		t.Fatal("different device blocked", write, err)
	}
}
