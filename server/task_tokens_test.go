package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/Autumn-27/artex/db"
)

// TestGetTaskReportsWholeTaskTokens locks the P0-1 fix: GET /api/tasks/{id} used
// to return tokens all-zero because the single-task DTO never filled the token
// aggregate — only listTasks did, from the bulk TaskListMetricsAll query.
//
// The fixture writes BOTH a kind='usage' row (live cumulative frame) and the
// kind='result' row (terminal frame) with the same numbers, exactly like
// agent.captureRunSession does. The expected total is therefore the number
// itself, not twice it: the aggregate must keep counting only kind='result'
// rows, otherwise every real run would be double-charged.
func TestGetTaskReportsWholeTaskTokens(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	defer m.Close()
	task, err := m.CreateTask("token totals", "goal", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	taskID, _ := strconv.ParseInt(task.ID, 10, 64)
	defer func() { _ = m.pg.DeleteTask(taskID) }()

	input, output, cacheRead, cacheWrite := 11316, 12, 7, 3
	for _, kind := range []string{"usage", "result"} {
		if _, err := task.Store.AppendActivity(db.Activity{
			Worker: "mainagent", Kind: kind,
			InputTokens: &input, OutputTokens: &output,
			CacheReadTokens: &cacheRead, CacheWriteTokens: &cacheWrite,
		}); err != nil {
			t.Fatalf("append %s activity: %v", kind, err)
		}
	}

	s := New(context.Background(), m, t.TempDir(), t.TempDir(), t.TempDir())
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatal(err)
	}

	// 1) detail endpoint — the one that used to report zeros.
	req := httptest.NewRequest(http.MethodGet, "/api/tasks/"+task.ID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get task status=%d body=%s", rec.Code, rec.Body.String())
	}
	var detail TaskDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	want := TokenTotalDTO{InputTokens: input, OutputTokens: output, CacheReadTokens: cacheRead, CacheWriteTokens: cacheWrite}
	if detail.Tokens != want {
		t.Fatalf("detail tokens=%+v, want %+v", detail.Tokens, want)
	}

	// 2) list endpoint must report the same total for the same task.
	req = httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list tasks status=%d body=%s", rec.Code, rec.Body.String())
	}
	var list struct {
		Tasks []TaskDTO `json:"tasks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	var listed *TaskDTO
	for i := range list.Tasks {
		if list.Tasks[i].ID == task.ID {
			listed = &list.Tasks[i]
			break
		}
	}
	if listed == nil {
		t.Fatalf("task %s missing from list response", task.ID)
	}
	if listed.Tokens != detail.Tokens {
		t.Fatalf("list tokens=%+v, detail tokens=%+v — endpoints disagree", listed.Tokens, detail.Tokens)
	}
}
