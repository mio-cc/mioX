package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// 消息反馈接口（DSH @deepseek-ai/dsh-client-ui-message-feedback）：
//   - PUT  写/覆盖（controller.ts:161-170 rate）：先赞后踩仍是 1 条；
//   - GET  列表（controller.ts:241-257 load）：前端拿它 seed 实心图标；
//   - DELETE ?seq=N 撤回（controller.ts:180-187 retract）；
//   - rating 只能 up/down、text ≤ 2000 字符，非法一律 400。
func TestMessageFeedbackAPI(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	defer m.Close()
	task, err := m.CreateTask("message feedback api", "goal", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	taskID, _ := strconv.ParseInt(task.ID, 10, 64)
	defer func() { _ = m.pg.DeleteTask(taskID) }()

	s := New(context.Background(), m, t.TempDir(), t.TempDir(), t.TempDir())
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	call := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var reader *bytes.Reader
		if body == nil {
			reader = bytes.NewReader(nil)
		} else {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		}
		req := httptest.NewRequest(method, path, reader)
		req.Header.Set("Authorization", "Bearer "+token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	type feedbackEnvelope struct {
		Feedback struct {
			Rating     string  `json:"rating"`
			Category   *string `json:"category"`
			Text       string  `json:"text"`
			SessionKey string  `json:"session_key"`
			MessageSeq int64   `json:"message_seq"`
		} `json:"feedback"`
		Items []struct {
			Rating     string  `json:"rating"`
			Category   *string `json:"category"`
			Text       string  `json:"text"`
			MessageSeq int64   `json:"message_seq"`
		} `json:"items"`
	}
	decode := func(rec *httptest.ResponseRecorder) feedbackEnvelope {
		t.Helper()
		var out feedbackEnvelope
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
		}
		return out
	}

	base := "/api/tasks/" + task.ID + "/message-feedback"

	// 一个全新的任务：列表为空（还没有任何评分）。
	empty := call(http.MethodGet, base, nil)
	if empty.Code != http.StatusOK || len(decode(empty).Items) != 0 {
		t.Fatalf("fresh list status=%d body=%s", empty.Code, empty.Body.String())
	}

	// PUT：写一条带分类与文字的「赞」。
	put := call(http.MethodPut, base, map[string]any{
		"session_key": "main:0", "message_seq": 7, "rating": "up",
		"category": "task-result", "text": "答案很准",
	})
	putBody := decode(put)
	if put.Code != http.StatusOK || putBody.Feedback.Rating != "up" ||
		putBody.Feedback.Category == nil || *putBody.Feedback.Category != "task-result" ||
		putBody.Feedback.Text != "答案很准" || putBody.Feedback.SessionKey != "main:0" || putBody.Feedback.MessageSeq != 7 {
		t.Fatalf("put status=%d body=%s", put.Code, put.Body.String())
	}

	// PUT 覆盖：先赞后踩仍是 1 条，rating 变 down。
	put = call(http.MethodPut, base, map[string]any{
		"session_key": "main:0", "message_seq": 7, "rating": "down",
		"category": "product-interaction", "text": "其实答错了",
	})
	if put.Code != http.StatusOK {
		t.Fatalf("overwrite put status=%d body=%s", put.Code, put.Body.String())
	}
	got := call(http.MethodGet, base, nil)
	gotBody := decode(got)
	if got.Code != http.StatusOK || len(gotBody.Items) != 1 {
		t.Fatalf("after overwrite list=%d status=%d body=%s", len(gotBody.Items), got.Code, got.Body.String())
	}
	if gotBody.Items[0].Rating != "down" || gotBody.Items[0].Category == nil ||
		*gotBody.Items[0].Category != "product-interaction" || gotBody.Items[0].Text != "其实答错了" {
		t.Fatalf("overwritten item = %+v, want down/product-interaction/其实答错了", gotBody.Items[0])
	}

	// DELETE ?seq=N 撤回 → 列表回到空。
	del := call(http.MethodDelete, base+"?seq=7", nil)
	if del.Code != http.StatusOK || !strings.Contains(del.Body.String(), `"deleted":true`) {
		t.Fatalf("delete status=%d body=%s", del.Code, del.Body.String())
	}
	if items := decode(call(http.MethodGet, base, nil)).Items; len(items) != 0 {
		t.Fatalf("after retract list=%d, want 0", len(items))
	}
	// 重复撤回是幂等的（deleted:false 而不是报错）。
	del = call(http.MethodDelete, base+"?seq=7", nil)
	if del.Code != http.StatusOK || !strings.Contains(del.Body.String(), `"deleted":false`) {
		t.Fatalf("repeated delete status=%d body=%s", del.Code, del.Body.String())
	}

	// 校验：非法输入一律 400。
	bad := []struct {
		name string
		body map[string]any
	}{
		{name: "rating", body: map[string]any{"session_key": "main:0", "message_seq": 1, "rating": "meh"}},
		{name: "rating empty", body: map[string]any{"session_key": "main:0", "message_seq": 1}},
		{name: "session key", body: map[string]any{"session_key": "", "message_seq": 1, "rating": "up"}},
		{name: "seq", body: map[string]any{"session_key": "main:0", "message_seq": 0, "rating": "up"}},
		{name: "text", body: map[string]any{"session_key": "main:0", "message_seq": 1, "rating": "up", "text": strings.Repeat("字", 2001)}},
		{name: "category", body: map[string]any{"session_key": "main:0", "message_seq": 1, "rating": "up", "category": "nope"}},
	}
	for _, tc := range bad {
		if rec := call(http.MethodPut, base, tc.body); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status=%d body=%s, want 400", tc.name, rec.Code, rec.Body.String())
		}
	}
	// DELETE 缺 seq 也是 400。
	if rec := call(http.MethodDelete, base, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("delete without seq status=%d body=%s, want 400", rec.Code, rec.Body.String())
	}
	// 未知任务 404。
	if rec := call(http.MethodGet, "/api/tasks/missing/message-feedback", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing task status=%d body=%s, want 404", rec.Code, rec.Body.String())
	}
	// 被拒绝的写入一行都不许留下。
	if items := decode(call(http.MethodGet, base, nil)).Items; len(items) != 0 {
		t.Fatalf("rejected writes left %d rows", len(items))
	}
}
