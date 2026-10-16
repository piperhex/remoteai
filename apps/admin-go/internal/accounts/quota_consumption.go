package accounts

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const quotaResponsesURL = "https://chatgpt.com/backend-api/codex/responses"
const quotaModel = "gpt-6-astra"
const quotaTimeout = 120 * time.Second
const quotaMaxBytes = 4 << 20

type quotaConsumptionResult struct {
	Consumed bool `json:"consumed"`
	Skipped  bool `json:"skipped"`
}

func (s *service) registerQuotaConsumption(r *gin.RouterGroup, write gin.HandlerFunc) {
	r.POST("/accounts/:id/quota/consume", write, noStore, endpoint(func(c *gin.Context) (interface{}, error) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var input struct {
			RequestID string `json:"requestId"`
		}
		if c.ShouldBindJSON(&input) != nil || uuid.Validate(input.RequestID) != nil {
			return nil, platform.NewError(400, "额度消耗请求无效，请刷新后重试")
		}
		return s.consumeQuota(c.Request.Context(), platform.User(c).ID, c.Param("id"), input.RequestID)
	}))
}

func (s *service) consumeQuota(ctx context.Context, owner, id, requestID string) (quotaConsumptionResult, error) {
	row, err := s.resolveAccount(owner, id)
	if err != nil {
		return quotaConsumptionResult{}, err
	}
	if strings.TrimSpace(str(obj(row.auth()["tokens"])["access_token"])) == "" {
		return quotaConsumptionResult{Skipped: true}, nil
	}
	release, err := s.claimQuota(ctx, owner, id, requestID)
	if err != nil {
		return quotaConsumptionResult{}, err
	}
	defer release()
	return s.executeQuota(ctx, row, uuid.NewString())
}

func (s *service) executeQuota(ctx context.Context, row *storedAccount, requestID string) (quotaConsumptionResult, error) {
	ctx, cancel := context.WithTimeout(ctx, quotaTimeout)
	defer cancel()
	// A generation may already have consumed quota on a network failure. Never replay it,
	// including on 401: credentials can be refreshed through the existing usage endpoint.
	response, err := s.sendCodex(row, quotaRequest(ctx, requestID))
	if err != nil {
		return quotaConsumptionResult{}, quotaUnconfirmed()
	}
	if !response.ok() || !quotaCompleted(response.Raw) {
		return quotaConsumptionResult{}, quotaUnconfirmed()
	}
	return quotaConsumptionResult{Consumed: true}, nil
}

func quotaUnconfirmed() error {
	return platform.NewError(502, "未确认消耗完成，可能已产生用量，请先刷新用量再重试")
}

func quotaRequest(ctx context.Context, requestID string) requestOptionsHTTP {
	return requestOptionsHTTP{
		Context: ctx, Timeout: quotaTimeout, MaxBytes: quotaMaxBytes,
		URL: quotaResponsesURL, Method: "POST",
		Headers: map[string]string{
			"Accept": "text/event-stream", "session-id": requestID, "thread-id": requestID,
			"x-openai-internal-codex-responses-lite": "true",
		},
		Body: object{
			"model": quotaModel, "instructions": "",
			"input": []object{
				{"type": "additional_tools", "role": "developer", "tools": []object{}},
				{"type": "message", "role": "developer", "content": []object{
					{"type": "input_text", "text": "Answer the user's question briefly."},
				}},
				{"type": "message", "role": "user", "content": []object{
					{"type": "input_text", "text": "今天天气如何？"},
				}},
			},
			"tool_choice": "auto", "parallel_tool_calls": false,
			"reasoning": object{"effort": "low", "context": "all_turns"},
			"store":     false, "stream": true, "include": []string{"reasoning.encrypted_content"},
			"text": object{"verbosity": "low"},
		},
	}
}

func quotaCompleted(raw []byte) bool {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	for _, block := range strings.Split(text, "\n\n") {
		data := []string{}
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "data:") {
				data = append(data, strings.TrimSpace(line[5:]))
			}
		}
		var event struct {
			Type string `json:"type"`
		}
		if json.Unmarshal([]byte(strings.Join(data, "\n")), &event) == nil && event.Type == "response.completed" {
			return true
		}
	}
	return false
}

var claimQuotaRequest = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('SET', KEYS[2], '1', 'EX', 86400)
return 1`)

var releaseQuotaRequest = redis.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`)

func (s *service) claimQuota(ctx context.Context, owner, id, requestID string) (func(), error) {
	key := "sync:quota-consume:" + owner + ":" + id
	keys := []string{key, key + ":request:" + requestID}
	claimed, err := claimQuotaRequest.Run(ctx, s.deps.Redis, keys, requestID,
		(quotaTimeout + 10*time.Second).Milliseconds()).Int()
	if err != nil {
		return nil, platform.NewError(503, "暂时无法开始消耗，请稍后重试")
	}
	if claimed != 1 {
		return nil, platform.NewError(409, "该账号正在执行或此请求已处理，请先刷新用量")
	}
	return func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		// The lease expires even if Redis is unavailable during cleanup.
		if err := releaseQuotaRequest.Run(cleanup, s.deps.Redis, []string{key}, requestID).Err(); err != nil {
			return
		}
	}, nil
}
