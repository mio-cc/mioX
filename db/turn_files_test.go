package db

import (
	"encoding/json"
	"testing"
)

// toolUse 构造一条 tool_use 记录（detail = 模型给的参数 JSON）。
func toolUse(id int64, tool, callID, detail string) Activity {
	return Activity{ID: id, Kind: "tool_use", Tool: tool, ToolUseID: callID, Detail: detail}
}

// toolResult 构造一条 tool_result 记录（is_error 由参数决定）。
func toolResult(id int64, tool, callID string, isError bool) Activity {
	return Activity{ID: id, Kind: "tool_result", Tool: tool, ToolUseID: callID, IsError: isError}
}

func turnEnd(id int64) Activity { return Activity{ID: id, Kind: "result"} }

// 验收 1（决定性单测）：Write×2 同一文件 + Edit×1 另一文件 + Bash×1，必须恰好算出
// 2 个文件、ops 正确、Bash 不算。数据来源规则见 DSH
// ui-deliverables/src/client/turn-deliverables.ts:1-7（只认成功的第一方改写调用）。
func TestDeriveTurnFilesCountsOnlySuccessfulMutations(t *testing.T) {
	rows := []Activity{
		toolUse(10, "Write", "c1", `{"file_path":"a.txt","content":"hello"}`),
		toolResult(11, "Write", "c1", false),
		toolUse(12, "Write", "c2", `{"file_path":"a.txt","content":"hello2"}`),
		toolResult(13, "Write", "c2", false),
		toolUse(14, "Edit", "c3", `{"file_path":"b.txt","old_string":"hello","new_string":"mioX"}`),
		toolResult(15, "Edit", "c3", false),
		// Bash 里也能改文件（重定向 / rm / sed -i），但它不是第一方改写工具：
		// 只认参数就是一次完整写入/替换的调用，所以这里必须完全不算。
		toolUse(16, "Bash", "c4", `{"command":"echo hi > c.txt"}`),
		toolResult(17, "Bash", "c4", false),
		turnEnd(18),
	}
	groups := DeriveTurnFiles(rows)
	if len(groups) != 1 {
		t.Fatalf("want exactly 1 turn, got %d (%+v)", len(groups), groups)
	}
	got := groups[0]
	if got.End != 18 {
		t.Fatalf("turn end = %d, want 18", got.End)
	}
	if len(got.Files) != 2 {
		t.Fatalf("want exactly 2 changed files, got %d (%+v)", len(got.Files), got.Files)
	}
	first, second := got.Files[0], got.Files[1]
	if first.Path != "a.txt" || first.Count != 2 || len(first.Ops) != 1 || first.Ops[0] != "write" {
		t.Fatalf("a.txt = %+v, want {write x2}", first)
	}
	if len(first.Calls) != 2 || first.Calls[0].Seq != 10 || first.Calls[1].Seq != 12 || first.Calls[0].Op != "write" {
		t.Fatalf("a.txt calls = %+v, want the two Write tool_use ids 10/12", first.Calls)
	}
	if second.Path != "b.txt" || second.Count != 1 || len(second.Ops) != 1 || second.Ops[0] != "edit" {
		t.Fatalf("b.txt = %+v, want {edit x1}", second)
	}
	for _, file := range got.Files {
		if file.Path == "c.txt" {
			t.Fatal("a Bash redirect must not be reported as a changed file")
		}
	}
}

// 失败/被拒的改写调用不算改动；参数不完整（缺 content、old==new）的调用也不算。
func TestDeriveTurnFilesIgnoresFailedAndMalformedCalls(t *testing.T) {
	rows := []Activity{
		// 写入被拦截层拒绝 → tool_result is_error
		toolUse(10, "Write", "c1", `{"file_path":"denied.txt","content":"x"}`),
		toolResult(11, "Write", "c1", true),
		// Write 缺 content：不是一次完整写入
		toolUse(12, "Write", "c2", `{"file_path":"nocontent.txt"}`),
		toolResult(13, "Write", "c2", false),
		// Edit 的 old_string == new_string：实际不改文件
		toolUse(14, "Edit", "c3", `{"file_path":"same.txt","old_string":"a","new_string":"a"}`),
		toolResult(15, "Edit", "c3", false),
		// Edit 的 old_string 为空
		toolUse(16, "Edit", "c4", `{"file_path":"empty.txt","old_string":"","new_string":"a"}`),
		toolResult(17, "Edit", "c4", false),
		// MultiEdit 缺 edits
		toolUse(18, "MultiEdit", "c5", `{"file_path":"noedits.txt"}`),
		toolResult(19, "MultiEdit", "c5", false),
		// Read 不是改写
		toolUse(20, "Read", "c6", `{"file_path":"read.txt"}`),
		toolResult(21, "Read", "c6", false),
		turnEnd(22),
	}
	groups := DeriveTurnFiles(rows)
	if len(groups) != 1 || len(groups[0].Files) != 0 {
		t.Fatalf("want 1 turn with 0 files, got %+v", groups)
	}
}

// 回合之间必须互不串味：第 1 回合写 a.txt，第 2 回合只读 → 第 2 回合是空数组；
// 进行中的回合（还没有 result 行）单独成一组且 End=0。
func TestDeriveTurnFilesSplitsTurns(t *testing.T) {
	rows := []Activity{
		toolUse(10, "Write", "c1", `{"file_path":"a.txt","content":"one"}`),
		toolResult(11, "Write", "c1", false),
		turnEnd(12),
		toolUse(13, "Read", "c2", `{"file_path":"a.txt"}`),
		toolResult(14, "Read", "c2", false),
		turnEnd(15),
		toolUse(16, "Edit", "c3", `{"file_path":"b.txt","old_string":"one","new_string":"two"}`),
		toolResult(17, "Edit", "c3", false),
	}
	groups := DeriveTurnFiles(rows)
	if len(groups) != 3 {
		t.Fatalf("want 3 groups (2 closed + 1 in flight), got %d: %+v", len(groups), groups)
	}
	if groups[0].End != 12 || len(groups[0].Files) != 1 || groups[0].Files[0].Path != "a.txt" {
		t.Fatalf("turn 1 = %+v", groups[0])
	}
	if groups[1].End != 15 || len(groups[1].Files) != 0 {
		t.Fatalf("turn 2 (read only) must have no files: %+v", groups[1])
	}
	if groups[2].End != 0 || len(groups[2].Files) != 1 || groups[2].Files[0].Path != "b.txt" {
		t.Fatalf("in-flight turn = %+v", groups[2])
	}
}

// TurnFileRows 只取本分段（main_seg）的主 Agent 改写行 + result 边界。
func TestTurnFileRowsScopesToMainSeg(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	defer d.Close()
	expID, err := d.CreateExploration("turn-files", "changed files card")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Exec(`DELETE FROM explorations WHERE id=$1`, expID) //nolint:errcheck // cascades activity
	es := d.Exploration(expID)

	seg0, seg1 := 0, 1
	appendRow := func(a Activity) int64 {
		id, err := es.AppendActivity(a)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	// seg 0：一次成功的 Write + 一次被拒的 Write + 一条 result
	okID := appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "tool_use", Tool: "Write", ToolUseID: "s0-ok",
		Detail: `{"file_path":"a.txt","content":"hello"}`})
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "tool_result", Tool: "Write", ToolUseID: "s0-ok"})
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "tool_use", Tool: "Write", ToolUseID: "s0-denied",
		Detail: `{"file_path":"denied.txt","content":"x"}`})
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "tool_result", Tool: "Write", ToolUseID: "s0-denied", IsError: true})
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "tool_use", Tool: "Bash", ToolUseID: "s0-bash",
		Detail: `{"command":"echo hi > c.txt"}`})
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "tool_result", Tool: "Bash", ToolUseID: "s0-bash"})
	resultID := appendRow(Activity{Worker: "mainagent", MainSeg: &seg0, Kind: "result", Summary: "done"})
	// 别的分段：同一分段过滤必须把它排除掉
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg1, Kind: "tool_use", Tool: "Write", ToolUseID: "s1",
		Detail: `{"file_path":"other-seg.txt","content":"x"}`})
	appendRow(Activity{Worker: "mainagent", MainSeg: &seg1, Kind: "tool_result", Tool: "Write", ToolUseID: "s1"})
	// 别的 worker（planner）改写行不算主 Agent 回合
	appendRow(Activity{Worker: "planner", Kind: "tool_use", Tool: "Write", ToolUseID: "planner",
		Detail: `{"file_path":"planner.txt","content":"x"}`})
	appendRow(Activity{Worker: "planner", Kind: "tool_result", Tool: "Write", ToolUseID: "planner"})

	rows, err := es.TurnFileRows(0)
	if err != nil {
		t.Fatal(err)
	}
	// 只应有：Write(ok) tool_use + 它的 result + Write(denied) tool_use + 它的 result
	// + result 边界 = 5 行；Bash 行、seg1 行、planner 行都不该出现。
	if len(rows) != 5 {
		t.Fatalf("seg 0 rows = %d, want 5: %+v", len(rows), rows)
	}
	for _, row := range rows {
		if row.Tool == "Bash" || row.Tool == "Read" {
			t.Fatalf("non-mutation tool leaked into the payload: %+v", row)
		}
	}
	foundOK := false
	for _, row := range rows {
		if row.Kind == "tool_use" && row.ID == okID && row.Detail != "" {
			foundOK = true
		}
	}
	if !foundOK {
		t.Fatal("the recorded Write arguments (detail) must be selected for the derivation")
	}

	groups := DeriveTurnFiles(rows)
	if len(groups) != 1 || groups[0].End != resultID {
		t.Fatalf("groups = %+v, want one turn ending at %d", groups, resultID)
	}
	if len(groups[0].Files) != 1 || groups[0].Files[0].Path != "a.txt" {
		t.Fatalf("files = %+v, want only a.txt", groups[0].Files)
	}

	// seg 1 只有它自己的那次 Write。
	rows1, err := es.TurnFileRows(1)
	if err != nil {
		t.Fatal(err)
	}
	groups1 := DeriveTurnFiles(rows1)
	if len(groups1) != 1 || len(groups1[0].Files) != 1 || groups1[0].Files[0].Path != "other-seg.txt" {
		t.Fatalf("seg 1 groups = %+v, want other-seg.txt only", groups1)
	}
}

// 返回给 HTTP 的形状必须是 path/ops/count/calls 四字段（客户端按 end 分组渲染卡片）。
func TestTurnFileJSONShape(t *testing.T) {
	groups := DeriveTurnFiles([]Activity{
		toolUse(10, "Write", "c1", `{"file_path":"a.txt","content":"x"}`),
		toolResult(11, "Write", "c1", false),
		toolUse(12, "Edit", "c2", `{"file_path":"a.txt","old_string":"x","new_string":"y"}`),
		toolResult(13, "Edit", "c2", false),
		turnEnd(14),
	})
	blob, err := json.Marshal(groups)
	if err != nil {
		t.Fatal(err)
	}
	var decoded []struct {
		End   int64 `json:"end"`
		Files []struct {
			Path  string         `json:"path"`
			Ops   []string       `json:"ops"`
			Count int            `json:"count"`
			Calls []TurnFileCall `json:"calls"`
		} `json:"files"`
	}
	if err := json.Unmarshal(blob, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 1 || decoded[0].End != 14 || len(decoded[0].Files) != 1 {
		t.Fatalf("shape = %s", blob)
	}
	file := decoded[0].Files[0]
	if file.Path != "a.txt" || file.Count != 2 || len(file.Ops) != 2 || file.Ops[0] != "write" || file.Ops[1] != "edit" {
		t.Fatalf("file = %+v, want a.txt {write,edit} x2", file)
	}
	if len(file.Calls) != 2 || file.Calls[0].Seq != 10 || file.Calls[1].Seq != 12 {
		t.Fatalf("calls = %+v", file.Calls)
	}
}
