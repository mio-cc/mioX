package server

import (
	"context"
	"encoding/json"
	"fmt"
	"iter"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Autumn-27/artex/agent"
	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/norma/llm"
)

// turnFilesStep 是剧本里的一步：要么发一个 tool_use，要么发一段最终文本。
type turnFilesStep struct {
	tool  string
	call  string
	input string
	text  string
}

// turnFilesProvider 用一个真实的主 Agent 回合演一段固定剧本：Write a.txt →
// Write b.txt → Edit b.txt → 收尾回答。它替代真实模型（本机没有配置 LLM），但
// agent 循环、工具执行、落盘、活动落库、HTTP 端点全部是真的。
type turnFilesProvider struct {
	mu     sync.Mutex
	round  int
	script []turnFilesStep
}

func (p *turnFilesProvider) next() turnFilesStep {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.round >= len(p.script) {
		return turnFilesStep{text: "剧本已结束。"}
	}
	step := p.script[p.round]
	p.round++
	return step
}

func (p *turnFilesProvider) Complete(_ context.Context, _ llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	step := p.next()
	if step.tool == "" {
		return llm.Message{Role: llm.RoleAssistant, Content: []llm.ContentBlock{llm.TextBlock(step.text)}},
			"end_turn", llm.Usage{OutputTokens: 8}, nil
	}
	return llm.Message{Role: llm.RoleAssistant, Content: []llm.ContentBlock{{
		Type: llm.BlockToolUse, ID: step.call, Name: step.tool, Input: json.RawMessage(step.input),
	}}}, "tool_use", llm.Usage{OutputTokens: 8}, nil
}

// Stream 也按同一剧本走，这样流式/非流式两种配置都能驱动这一轮。
func (p *turnFilesProvider) Stream(ctx context.Context, req llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	return func(yield func(llm.StreamEvent, error) bool) {
		message, stop, usage, err := p.Complete(ctx, req)
		if err != nil {
			yield(llm.StreamEvent{}, err)
			return
		}
		yield(llm.StreamEvent{Type: llm.SEMessageStart}, nil)
		for _, block := range message.Content {
			switch block.Type {
			case llm.BlockText:
				yield(llm.StreamEvent{Type: llm.SETextDelta, Text: block.Text}, nil)
			case llm.BlockToolUse:
				yield(llm.StreamEvent{Type: llm.SEToolUseStart, ToolID: block.ID, ToolName: block.Name}, nil)
				yield(llm.StreamEvent{Type: llm.SEToolInputJSON, Text: string(block.Input)}, nil)
			}
		}
		yield(llm.StreamEvent{Type: llm.SEMessageDelta, StopReason: stop, Usage: usage}, nil)
	}
}

// turnFilesServer 起一个真 Server（真 Manager / 真 engine / 真活动表），只把
// LLM provider 换成本地剧本。返回的 runDir 是主 Agent 的工具 CWD
// （<data>/tasks/<taskID>，见 agent/mainagent.go:301-339），相对 file_path 落在那里。
func turnFilesServer(t *testing.T, script []turnFilesStep) (*Server, *Task, string) {
	t.Helper()
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := New(ctx, m, "", m.dir, t.TempDir())
	s.cfgMu.Lock()
	s.llmOn, s.llmProv = true, &turnFilesProvider{script: script}
	s.llmCfg = agent.Config{Stream: false, Model: "turn-files-e2e"}
	s.cfgMu.Unlock()
	t.Cleanup(func() {
		cancel()
		m.Close()
	})
	task, err := m.CreateTaskWithOptions("turn changed files e2e", "创建 a.txt，再修改 b.txt", db.TaskCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) })
	return s, task, filepath.Join(m.dir, "tasks", task.ID)
}

// runChatTurn 走真实 chat handler 起一轮主 Agent 对话，并等到该轮收尾（result 行）。
func runChatTurn(t *testing.T, s *Server, task *Task, message string) int64 {
	t.Helper()
	return runChatTurnSince(t, s, task, message, 0)
}

// runChatTurnSince 同上，但只认比 since 更新的 result 行（多轮对话用）。
func runChatTurnSince(t *testing.T, s *Server, task *Task, message string, since int64) int64 {
	t.Helper()
	body := fmt.Sprintf(`{"message":%q}`, message)
	r := httptest.NewRequest("POST", "/api/chat?task="+task.ID, strings.NewReader(body))
	w := httptest.NewRecorder()
	s.chat(w, r)
	if w.Code != 202 {
		t.Fatalf("chat: %d %s", w.Code, w.Body.String())
	}
	return waitTurnEnd(t, task, since, 90*time.Second)
}

// waitTurnEnd 轮询该任务主会话直到出现比 since 更新的 result 行，返回它的活动 id。
func waitTurnEnd(t *testing.T, task *Task, since int64, timeout time.Duration) int64 {
	t.Helper()
	seg := 0
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		rows, _, err := task.Store.ActivityPage(db.ActivitySessionFilter{Main: true, MainSeg: &seg}, 0, 500)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row.Kind == "result" && row.ID > since {
				return row.ID
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	dumpActivities(t, task)
	t.Fatalf("turn did not settle within %s", timeout)
	return 0
}

// dumpActivities 打印主会话的步骤，测试失败时用来判断 agent 到底做了什么。
func dumpActivities(t *testing.T, task *Task) {
	t.Helper()
	seg := 0
	rows, _, err := task.Store.ActivityPage(db.ActivitySessionFilter{Main: true, MainSeg: &seg}, 0, 500)
	if err != nil {
		t.Logf("dump: %v", err)
		return
	}
	for _, row := range rows {
		t.Logf("activity id=%d kind=%s tool=%s err=%v summary=%q", row.ID, row.Kind, row.Tool, row.IsError, row.Summary)
	}
}

// turnFilesJSON 调真实 turnFiles handler，返回原始 JSON 正文。
func turnFilesJSON(t *testing.T, s *Server, task *Task, query string) string {
	t.Helper()
	r := httptest.NewRequest("GET", "/api/tasks/"+task.ID+"/turn-files?"+query, nil)
	r.SetPathValue("id", task.ID)
	w := httptest.NewRecorder()
	s.turnFiles(w, r)
	if w.Code != 200 {
		t.Fatalf("turn-files?%s: %d %s", query, w.Code, w.Body.String())
	}
	return w.Body.String()
}

type turnFileDTO struct {
	Path  string   `json:"path"`
	Ops   []string `json:"ops"`
	Count int      `json:"count"`
	Calls []struct {
		Seq int64  `json:"seq"`
		Op  string `json:"op"`
	} `json:"calls"`
}

// 端到端（后端半边）：让 agent 真的「创建 a.txt，再修改 b.txt」——工具真的落盘，
// 活动真的入库，再走真实 HTTP 端点断言恰好 2 个文件、ops/count 正确、路径与磁盘一致。
func TestTurnFilesEndToEndAgentTurn(t *testing.T) {
	script := []turnFilesStep{
		{tool: "Write", call: "call-a", input: `{"file_path":"a.txt","content":"hello mioX\n"}`},
		{tool: "Write", call: "call-b", input: `{"file_path":"b.txt","content":"hello mioX\n"}`},
		{tool: "Edit", call: "call-b-edit", input: `{"file_path":"b.txt","old_string":"hello mioX","new_string":"hello turn-files"}`},
		{text: "已创建 a.txt，并修改 b.txt。"},
	}
	s, task, workDir := turnFilesServer(t, script)
	end := runChatTurn(t, s, task, "请先创建 a.txt，再修改 b.txt。")

	// 决定性：磁盘上真的有两个文件（不是界面说改了）。
	for name, want := range map[string]string{"a.txt": "hello mioX\n", "b.txt": "hello turn-files\n"} {
		blob, err := os.ReadFile(filepath.Join(workDir, name))
		if err != nil {
			t.Fatalf("agent did not write %s on disk: %v", name, err)
		}
		if string(blob) != want {
			t.Fatalf("%s on disk = %q, want %q", name, string(blob), want)
		}
	}

	// 指定回合：恰好 2 个文件。
	var files []turnFileDTO
	if err := json.Unmarshal([]byte(turnFilesJSON(t, s, task, fmt.Sprintf("seg=0&end=%d", end))), &files); err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("want exactly 2 changed files, got %d: %+v", len(files), files)
	}
	byPath := map[string]turnFileDTO{}
	for _, file := range files {
		byPath[file.Path] = file
	}
	a, okA := byPath["a.txt"]
	b, okB := byPath["b.txt"]
	if !okA || !okB {
		t.Fatalf("want a.txt and b.txt, got %+v", files)
	}
	if len(a.Ops) != 1 || a.Ops[0] != "write" || a.Count != 1 {
		t.Fatalf("a.txt = %+v, want write x1", a)
	}
	if len(b.Ops) != 2 || b.Ops[0] != "write" || b.Ops[1] != "edit" || b.Count != 2 {
		t.Fatalf("b.txt = %+v, want write+edit x2", b)
	}
	// 路径与磁盘一致：记录的每个路径都能在任务工作目录里找到。
	for _, file := range files {
		if _, err := os.Stat(filepath.Join(workDir, file.Path)); err != nil {
			t.Fatalf("recorded path %q does not exist on disk: %v", file.Path, err)
		}
		if len(file.Calls) == 0 {
			t.Fatalf("%s has no calls — the row could not render a diff", file.Path)
		}
	}

	// all=1：该分段恰好一个回合，且就是这个 result 收尾的回合。
	var all struct {
		Seg   int `json:"seg"`
		Turns []struct {
			End   int64         `json:"end"`
			Files []turnFileDTO `json:"files"`
		} `json:"turns"`
	}
	if err := json.Unmarshal([]byte(turnFilesJSON(t, s, task, "seg=0&all=1")), &all); err != nil {
		t.Fatal(err)
	}
	if all.Seg != 0 || len(all.Turns) != 1 || all.Turns[0].End != end || len(all.Turns[0].Files) != 2 {
		t.Fatalf("all=1 = %+v, want one turn ending at %d with 2 files", all, end)
	}
}

// 决定性：没改文件的回合不产生数据（端点返回 []，不是 404，也不串上一轮的文件）。
func TestTurnFilesEmptyForReadOnlyTurn(t *testing.T) {
	script := []turnFilesStep{
		{tool: "Write", call: "call-a", input: `{"file_path":"a.txt","content":"hello\n"}`},
		{text: "已创建 a.txt。"},
		// 第二轮：只读，不改任何文件
		{tool: "Read", call: "call-read", input: `{"file_path":"a.txt"}`},
		{tool: "Bash", call: "call-bash", input: `{"command":"ls -la"}`},
		{text: "工作目录里有 a.txt。"},
	}
	s, task, workDir := turnFilesServer(t, script)
	firstEnd := runChatTurn(t, s, task, "创建 a.txt。")
	secondEnd := runChatTurnSince(t, s, task, "只读：告诉我工作目录里有什么，不要修改任何文件。", firstEnd)
	if secondEnd <= firstEnd {
		t.Fatalf("second turn end %d must be after the first %d", secondEnd, firstEnd)
	}
	// 第一轮有 1 个文件，第二轮空。
	var first []turnFileDTO
	if err := json.Unmarshal([]byte(turnFilesJSON(t, s, task, fmt.Sprintf("seg=0&end=%d", firstEnd))), &first); err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0].Path != "a.txt" {
		t.Fatalf("first turn = %+v, want a.txt", first)
	}
	second := strings.TrimSpace(turnFilesJSON(t, s, task, fmt.Sprintf("seg=0&end=%d", secondEnd)))
	if second != "[]" {
		t.Fatalf("read-only turn must be an empty array, got %q", second)
	}
	// 最新回合（缺省 end）= 只读那一轮 → 仍然是 []，不能串上一轮的文件。
	latest := strings.TrimSpace(turnFilesJSON(t, s, task, "seg=0"))
	if latest != "[]" {
		t.Fatalf("latest turn must be empty after a read-only turn, got %q", latest)
	}
	// Bash 不算改动：磁盘上只应有 a.txt。
	entries, err := os.ReadDir(workDir)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if len(names) != 1 || names[0] != "a.txt" {
		t.Fatalf("work dir = %v, want only a.txt (Bash must not count as a change)", names)
	}
}

// 不存在的任务 → 404；坏的 seg → 400（空数组只用于「没改文件」，不用于错误）。
func TestTurnFilesRejectsBadInput(t *testing.T) {
	s, task, _ := turnFilesServer(t, []turnFilesStep{{text: "noop"}})
	r := httptest.NewRequest("GET", "/api/tasks/missing/turn-files", nil)
	r.SetPathValue("id", "missing")
	w := httptest.NewRecorder()
	s.turnFiles(w, r)
	if w.Code != 404 {
		t.Fatalf("missing task: %d, want 404", w.Code)
	}
	r = httptest.NewRequest("GET", "/api/tasks/"+task.ID+"/turn-files?seg=abc", nil)
	r.SetPathValue("id", task.ID)
	w = httptest.NewRecorder()
	s.turnFiles(w, r)
	if w.Code != 400 {
		t.Fatalf("bad seg: %d, want 400", w.Code)
	}
	// 没有任何活动的任务 → 空数组。
	if got := strings.TrimSpace(turnFilesJSON(t, s, task, "seg=0")); got != "[]" {
		t.Fatalf("empty task = %q, want []", got)
	}
}
