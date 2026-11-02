package providermarket

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

const (
	defaultPageSize = 40
	maxPageSize     = 100
	maxPageNumber   = 10000
)

type pagination struct{ size, offset int }

func listPagination(c *gin.Context) (pagination, error) {
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	if page > maxPageNumber {
		return pagination{}, invalid()
	}
	size := defaultPageSize
	// Public clients use a fixed page size; customization belongs to the admin list.
	if value := c.Query("pageSize"); value != "" && c.FullPath() == "/admin/api/provider-market" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > maxPageSize {
			return pagination{}, invalid()
		}
		size = parsed
	}
	return pagination{size: size, offset: (page - 1) * size}, nil
}
