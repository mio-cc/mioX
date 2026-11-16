package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Autumn-27/artex/db"
)

// 浏览器端到端：真 Server（真 mux + 真静态导出 + 真活动表 + 真工具落盘）跑两轮
// agent 回合，然后由外部 headless Chrome 打开真页面断言 DOM。
//
// 进程间用文件握手（本测试写 handshake.json → CDP 脚本写 dom.json），因为浏览器
// 断言必须在真浏览器里做（R3：禁止用渲染结果之外的猜测当证据，也禁止只看接口）。
//
// 需要 TURNFILES_BROWSER_OUT（握手目录）与 TURNFILES_WEBUI_DIR（web/out 绝对路径）。
func TestTurnFilesBrowserE2E(t *testing.T) {
	out := os.Getenv("TURNFILES_BROWSER_OUT")
	webui := os.Getenv("TURNFILES_WEBUI_DIR")
	if out == "" || webui == "" {
		t.Skip("browser e2e needs TURNFILES_BROWSER_OUT + TURNFILES_WEBUI_DIR")
	}
	handshakePath := filepath.Join(out, "handshake.json")
	domPath := filepath.Join(out, "dom.json")
	_ = os.Remove(handshakePath)
	_ = os.Remove(domPath)

	// 真静态导出 + 真 API，同一个 handler（authDisabled 由 New 决定，测试库免登录）。
	t.Setenv("ARTEX_WEBUI_DIR", webui)
	changed := []turnFilesStep{
		{tool: "Write", call: "call-a", input: `{"file_path":"a.txt","content":"hello mioX\n"}`},
		{tool: "Write", call: "call-b", input: `{"file_path":"b.txt","content":"hello mioX\n"}`},
		{tool: "Edit", call: "call-b-edit", input: `{"file_path":"b.txt","old_string":"hello mioX","new_string":"hello turn-files"}`},
		{text: "已创建 a.txt，并修改 b.txt。"},
	}
	s, task, runDir := turnFilesServer(t, changed)
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	end := runChatTurn(t, s, task, "请先创建 a.txt，再修改 b.txt。")

	// 只读任务：同一个 Server，换一份只读剧本，跑一轮「没改文件」的对话。
	readOnly := []turnFilesStep{
		{tool: "Read", call: "ro-read", input: `{"file_path":"a.txt"}`},
		{tool: "Bash", call: "ro-bash", input: `{"command":"echo hi"}`},
		{text: "工作目录里有 a.txt。"},
	}
	s.cfgMu.Lock()
	s.llmProv = &turnFilesProvider{script: readOnly}
	s.cfgMu.Unlock()
	m := s.m
	readTask, err := m.CreateTaskWithOptions("turn changed files read-only", "只读：不要修改任何文件", db.TaskCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = m.DeleteTask(readTask.ID, DeleteTaskOptions{}) })
	readEnd := runChatTurn(t, s, readTask, "只读：告诉我工作目录里有什么，不要修改任何文件。")

	// 交接给 CDP 脚本。
	handshake := map[string]any{
		"url":              srv.URL,
		"task_id":          task.ID,
		"end":              end,
		"readonly_task_id": readTask.ID,
		"readonly_end":     readEnd,
		"run_dir":          runDir,
		"changed_paths":    []string{"a.txt", "b.txt"},
	}
	blob, err := json.MarshalIndent(handshake, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(handshakePath, blob, 0o644); err != nil {
		t.Fatal(err)
	}

	// 等 CDP 脚本写完 DOM 断言结果。
	deadline := time.Now().Add(180 * time.Second)
	for {
		if _, err := os.Stat(domPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("browser did not report within 180s (missing %s)", domPath)
		}
		time.Sleep(200 * time.Millisecond)
	}
	var dom struct {
		Card struct {
			Present  bool     `json:"present"`
			Rows     int      `json:"rows"`
			Title    string   `json:"title"`
			Paths    []string `json:"paths"`
			Ops      []string `json:"ops"`
			DiffOpen bool     `json:"diff_open"`
			DiffRows int      `json:"diff_rows"`
		} `json:"card"`
		ReadOnly struct {
			Present     bool   `json:"present"`
			Transcript  bool   `json:"transcript"`
			TurnEndSeen bool   `json:"turn_end_seen"`
			QueryResult string `json:"query_result"`
		} `json:"readonly"`
		Errors []string `json:"errors"`
	}
	domBlob, err := os.ReadFile(domPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(domBlob, &dom); err != nil {
		t.Fatalf("dom.json: %v (%s)", err, string(domBlob))
	}

	// 验收 2：卡片出现、行数 = 2、路径与磁盘一致。
	if !dom.Card.Present {
		t.Fatalf("changed-files card missing in the DOM (errors=%v)", dom.Errors)
	}
	if dom.Card.Rows != 2 {
		t.Fatalf("card rows = %d, want 2 (paths=%v)", dom.Card.Rows, dom.Card.Paths)
	}
	if len(dom.Card.Paths) != 2 {
		t.Fatalf("card paths = %v, want 2", dom.Card.Paths)
	}
	for _, path := range dom.Card.Paths {
		if _, err := os.Stat(filepath.Join(runDir, path)); err != nil {
			t.Fatalf("DOM path %q does not exist on disk: %v", path, err)
		}
	}
	if dom.Card.Title == "" || dom.Card.DiffRows == 0 {
		t.Fatalf("card title=%q diffRows=%d — the row must expand into a real diff", dom.Card.Title, dom.Card.DiffRows)
	}

	// 验收 3（决定性）：没改文件的回合不渲染卡片。
	if !dom.ReadOnly.Transcript || !dom.ReadOnly.TurnEndSeen {
		t.Fatalf("the read-only turn did not render a transcript — the null check would be meaningless: %+v", dom.ReadOnly)
	}
	if dom.ReadOnly.Present {
		t.Fatalf("read-only turn rendered a changed-files card: %+v", dom.ReadOnly)
	}
	if dom.ReadOnly.QueryResult != "null" {
		t.Fatalf("querySelector('[data-testid=\"turn-changed-files\"]') = %q, want null", dom.ReadOnly.QueryResult)
	}
	if len(dom.Errors) != 0 {
		t.Fatalf("browser console/runtime errors: %v", dom.Errors)
	}

	// 服务端数字与 DOM 对齐（不是「看起来对」）：这个回合就是 2 个文件。
	var files []turnFileDTO
	if err := json.Unmarshal([]byte(turnFilesJSON(t, s, task, "seg=0")), &files); err != nil {
		t.Fatal(err)
	}
	if len(files) != dom.Card.Rows {
		t.Fatalf("server files=%d but DOM rows=%d", len(files), dom.Card.Rows)
	}
	var ro []turnFileDTO
	if err := json.Unmarshal([]byte(turnFilesJSON(t, s, readTask, "seg=0")), &ro); err != nil {
		t.Fatal(err)
	}
	if len(ro) != 0 {
		t.Fatalf("read-only task endpoint = %+v, want []", ro)
	}
}
