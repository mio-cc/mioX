package llm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// Regression (2026-11-22, user report): gateways of the GLM zcode family REJECT the
// assistant `reasoning_content` key outright — HTTP 422 pydantic
// `extra_forbidden`. The sanitize layer intentionally fills a placeholder for the
// opposite world (DeepSeek-style servers that REQUIRE the reasoning echo on
// tool-call turns), which made every post-compaction turn on such gateways fail
// deterministically:
//
//	openai: status 422: {... "loc":["body","messages",3,"assistant","reasoning_content"],
//	                       "input":"(reasoning elided by context compaction)" ...}
//
// The provider now self-heals: on the first such 422 it strips the field from
// every assistant message and retries — and remembers for the instance, so later
// builds omit it up front.
func TestOpenAIReasoning422SelfHeals(t *testing.T) {
	var calls atomic.Int32
	var firstRaw, secondRaw string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := readAll(t, r)
		switch calls.Add(1) {
		case 1:
			firstRaw = body
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			w.Write([]byte(`{"detail":[{"type":"extra_forbidden","loc":["body","messages",3,"assistant","reasoning_content"],"msg":"Extra inputs are not permitted","input":"(reasoning elided by context compaction)"}]}`))
		default:
			secondRaw = body
			w.Write([]byte(sse(`data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}`, ``, `data: [DONE]`, ``)))
		}
	}))
	defer srv.Close()
	p, err := NewProvider(Config{Format: FormatOpenAI, BaseURL: srv.URL, APIKey: "k", Model: "m", ThinkingType: "enabled"})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	// A thinking-mode turn whose assistant replayed tool_calls without a thinking
	// block — exactly what a compacted history looks like. sanitize must have
	// filled the placeholder, which the stub rejects once.
	req := CompletionRequest{Messages: []Message{
		UserText("go"),
		{Role: RoleAssistant, Content: []ContentBlock{
			{Type: BlockToolUse, ID: "t1", Name: "probe", Input: []byte(`{}`)},
		}},
		{Role: RoleUser, Content: []ContentBlock{
			{Type: BlockToolResult, ToolUseID: "t1", Content: []ContentBlock{TextBlock("done")}},
		}},
	}}
	msg := collect(t, p, req)
	if msg.Text() != "ok" {
		t.Fatalf("text=%q, want ok", msg.Text())
	}
	if !strings.Contains(firstRaw, `"reasoning_content":"(reasoning elided by context compaction)"`) {
		t.Fatalf("first request must carry the placeholder reasoning_content:\n%s", firstRaw)
	}
	if strings.Contains(secondRaw, "reasoning_content") {
		t.Fatalf("retry must strip reasoning_content entirely:\n%s", secondRaw)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls=%d, want 2", calls.Load())
	}
	// The lesson persists within the provider instance: the very next build omits
	// the field without paying another 422.
	var thirdRaw string
	third := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		thirdRaw = readAll(t, r)
		w.Write([]byte(sse(`data: {"choices":[{"index":0,"delta":{"content":"again"}}]}`, ``, `data: [DONE]`, ``)))
	}))
	defer third.Close()
	p.(*openaiProvider).cfg.BaseURL = third.URL
	msg = collect(t, p, req)
	if msg.Text() != "again" {
		t.Fatalf("third text=%q", msg.Text())
	}
	if strings.Contains(thirdRaw, "reasoning_content") {
		t.Fatalf("learned strip missing on subsequent calls:\n%s", thirdRaw)
	}
}

func readAll(t *testing.T, r *http.Request) string {
	t.Helper()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 1024)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
	}
	var pretty map[string]any
	if json.Unmarshal(buf, &pretty) == nil {
		out, _ := json.Marshal(pretty)
		return string(out)
	}
	return string(buf)
}
