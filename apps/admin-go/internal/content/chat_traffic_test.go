package content

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/chattraffic"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestChatTrafficRejectsInvalidSorting(t *testing.T) {
	router := gin.New()
	router.GET("/traffic", (&service{}).chatTrafficUsers)
	for _, query := range []url.Values{
		{"sortBy": {"monthlyLimitBytes"}},
		{"sortBy": {"month_bytes DESC; DROP TABLE users"}},
		{"sortOrder": {"desc; SELECT pg_sleep(10)"}},
		{"sortOrder": {"invalid"}},
		{"sortBy": {""}},
		{"sortOrder": {""}},
	} {
		t.Run(query.Encode(), func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/traffic?"+query.Encode(), nil))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status %d, body %s", response.Code, response.Body)
			}
		})
	}
}

// Sorting runs against PostgreSQL so aliases, missing usage and pagination use the real query behavior.
func TestChatTrafficSortingBeforePagination(t *testing.T) {
	db := trafficSortingFixture(t)
	month := chattraffic.MonthStart(time.Now()).AddDate(0, -1, 0)
	seedTrafficSorting(t, db, month)
	router := gin.New()
	router.GET("/traffic", (&service{deps: &platform.Dependencies{DB: db}}).chatTrafficUsers)
	for _, test := range []struct {
		name, field, direction string
		order                  []int
	}{
		{"default", "", "", []int{3, 1, 5, 2, 4}},
		{"month descending", "monthBytes", "desc", []int{3, 1, 5, 2, 4}},
		{"month ascending", "monthBytes", "asc", []int{4, 2, 1, 5, 3}},
		{"total defaults descending", "totalBytes", "", []int{1, 5, 2, 3, 4}},
		{"total descending", "totalBytes", "desc", []int{1, 5, 2, 3, 4}},
		{"total ascending", "totalBytes", "asc", []int{4, 3, 2, 1, 5}},
		{"current descending", "monthUsedBytes", "desc", []int{2, 1, 5, 3, 4}},
		{"current ascending", "monthUsedBytes", "asc", []int{4, 3, 1, 5, 2}},
	} {
		t.Run(test.name, func(t *testing.T) {
			query := url.Values{"month": {month.Format("2006-01")}, "search": {"sort-user-"}, "pageSize": {"2"}}
			if test.field != "" {
				query.Set("sortBy", test.field)
			}
			if test.direction != "" {
				query.Set("sortOrder", test.direction)
			}
			ids := readTrafficPages(t, router, query)
			want := make([]string, len(test.order))
			for index, number := range test.order {
				want[index] = trafficSortingID(number)
			}
			if !slices.Equal(ids, want) {
				t.Fatalf("user order %v, want %v", ids, want)
			}
		})
	}
}

func readTrafficPages(t *testing.T, router *gin.Engine, query url.Values) []string {
	t.Helper()
	var ids []string
	for page := 1; page <= 3; page++ {
		query.Set("page", fmt.Sprint(page))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/traffic?"+query.Encode(), nil))
		if response.Code != http.StatusOK {
			t.Fatalf("status %d, body %s", response.Code, response.Body)
		}
		var result struct {
			Items                 []chattraffic.UserTraffic
			Total, Page, PageSize int
			Summary               chattraffic.UserSummary
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Total != 5 || result.Page != page || result.PageSize != 2 || len(result.Items) != min(2, 7-2*page) {
			t.Fatalf("incorrect page: %+v", result)
		}
		wantSummary := chattraffic.UserSummary{MonthBytes: 100800, TotalBytes: 103550,
			MonthActiveUsers: 5, TotalActiveUsers: 5}
		if result.Summary != wantSummary {
			t.Fatalf("summary changed with search, sorting or pagination: %+v", result.Summary)
		}
		for _, user := range result.Items {
			ids = append(ids, user.ID)
		}
	}
	return ids
}

func trafficSortingID(number int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", number)
}

func TestChatTrafficSummary(t *testing.T) {
	db := trafficSortingFixture(t)
	month := chattraffic.MonthStart(time.Now()).AddDate(0, -1, 0)
	empty, err := chattraffic.ReadUserSummary(db, month)
	if err != nil || empty != (chattraffic.UserSummary{}) {
		t.Fatalf("empty database summary: %+v, error %v", empty, err)
	}
	seedTrafficSorting(t, db, month)
	for _, test := range []struct {
		name   string
		month  time.Time
		bytes  int64
		active int64
	}{
		{"selected month", month, 100800, 5},
		{"current month", month.AddDate(0, 1, 0), 650, 4},
		{"no monthly usage", month.AddDate(0, 2, 0), 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := chattraffic.ReadUserSummary(db, test.month)
			want := chattraffic.UserSummary{MonthBytes: test.bytes, TotalBytes: 103550,
				MonthActiveUsers: test.active, TotalActiveUsers: 5}
			if err != nil || got != want {
				t.Fatalf("summary %+v, want %+v, error %v", got, want, err)
			}
		})
	}
}

func seedTrafficSorting(t *testing.T, db *gorm.DB, month time.Time) {
	t.Helper()
	usage := [][3]int64{{900, 200, 100}, {200, 100, 400}, {100, 300, 50}, {}, {900, 200, 100}}
	for index, months := range usage {
		id := trafficSortingID(index + 1)
		email := fmt.Sprintf("sort-user-%d@fixture.test", index+1)
		if err := db.Exec("INSERT INTO users(id,email) VALUES (?,?)", id, email).Error; err != nil {
			t.Fatal(err)
		}
		for offset, bytes := range months {
			if bytes == 0 {
				continue
			}
			err := db.Exec("INSERT INTO chat_relay_user_months(user_id,month_start,bytes) VALUES (?,?,?)",
				id, month.AddDate(0, offset-1, 0), bytes).Error
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	// The search filter must exclude even a user with more traffic than every matching user.
	id := trafficSortingID(6)
	if err := db.Exec("INSERT INTO users(id,email) VALUES (?,?)", id, "excluded@fixture.test").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO chat_relay_user_months(user_id,month_start,bytes) VALUES (?,?,?)",
		id, month, 100000).Error; err != nil {
		t.Fatal(err)
	}
	id = trafficSortingID(7)
	if err := db.Exec("INSERT INTO users(id,email) VALUES (?,?)", id, "zero@fixture.test").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO chat_relay_user_months(user_id,month_start,bytes) VALUES (?,?,0)",
		id, month).Error; err != nil {
		t.Fatal(err)
	}
}

func trafficSortingFixture(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("ADMIN_GO_TRAFFIC_DB_TEST") != "1" {
		t.Skip("local PostgreSQL fixture is opt-in")
	}
	db, err := gorm.Open(postgres.Open(
		"host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=admin_go sslmode=disable"))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := pool.Close(); err != nil {
			t.Error(err)
		}
	})
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() {
		if err := tx.Rollback().Error; err != nil {
			t.Error(err)
		}
	})
	schema := "traffic_sort_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	migration, err := os.ReadFile("../migrations/004_chat_user_traffic.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE SCHEMA "` + schema + `"`, `SET LOCAL search_path TO "` + schema + `"`,
		"CREATE TABLE users(id uuid PRIMARY KEY,email text NOT NULL)", string(migration),
	} {
		if err := tx.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	return tx
}
