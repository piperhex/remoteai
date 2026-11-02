package providermarket

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestListPagination(t *testing.T) {
	for _, test := range []struct {
		name, path, query string
		want              pagination
		invalid           bool
	}{
		{"default", "/admin/api/provider-market", "", pagination{40, 0}, false},
		{"next page", "/admin/api/provider-market", "?page=3&pageSize=10", pagination{10, 20}, false},
		{"maximum", "/admin/api/provider-market", "?page=10000&pageSize=100", pagination{100, 999900}, false},
		{"nonpositive page", "/admin/api/provider-market", "?page=0&pageSize=20", pagination{20, 0}, false},
		{"invalid page", "/admin/api/provider-market", "?page=invalid", pagination{40, 0}, false},
		{"page limit", "/admin/api/provider-market", "?page=10001", pagination{}, true},
		{"size limit", "/admin/api/provider-market", "?pageSize=101", pagination{}, true},
		{"zero size", "/admin/api/provider-market", "?pageSize=0", pagination{}, true},
		{"negative size", "/admin/api/provider-market", "?pageSize=-1", pagination{}, true},
		{"decimal size", "/admin/api/provider-market", "?pageSize=1.5", pagination{}, true},
		{"invalid size", "/admin/api/provider-market", "?pageSize=invalid", pagination{}, true},
		{"public compatibility", "/provider-market", "?page=2&pageSize=10", pagination{40, 40}, false},
		{"own compatibility", "/provider-market/mine", "?page=2&pageSize=10", pagination{40, 40}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.GET(test.path, func(c *gin.Context) {
				got, err := listPagination(c)
				if got != test.want || (err != nil) != test.invalid {
					t.Fatalf("pagination = %+v, error = %v; want %+v, invalid = %v", got, err, test.want, test.invalid)
				}
			})
			router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", test.path+test.query, nil))
		})
	}
}
