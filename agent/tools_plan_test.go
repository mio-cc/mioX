package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
	actool "github.com/Autumn-27/norma/tool"
)

// planTitle must read the first level-1 heading, exactly like DSH
// (ui-plan/plan.ts:47 `/^#\s+(\S[^\r\n]*)/` on the trimmed markdown).
func TestPlanTitle(t *testing.T) {
	cases := []struct{ in, want string }{
		{"# 测试计划\n\n正文", "测试计划"},
		{"\n\n# 带前导空行的计划\n正文", "带前导空行的计划"},
		{"## 二级标题不算\n# 一级标题才算", ""}, // trim 后首行不是 # 标题 → 不算
		{"没有标题的计划", ""},
		// `\s` matches a newline in both Go and JS, so DSH's own regex reads "#\n空标题"
		// as heading "#" + body "空标题" — kept identical on purpose.
		{"#\n空标题", "空标题"},
		{"#没有空格", ""},
	}
	for _, c := range cases {
		if got := planTitle(c.in); got != c.want {
			t.Fatalf("planTitle(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// exitPlanMode mirrors DSH plan-mode/src/index.ts:301-362: plan mode only, non-empty
// plan starting with a `#` heading, one persisted plan per submission, and a result
// that tells the model the plan is submitted and the turn is over.
func TestExitPlanModeValidatesAndPersists(t *testing.T) {
	var got []db.Activity
	turn := &planTurn{}
	tsx := NewToolSet(nil, "human")
	tsx.SetPlanMode(true)
	tsx.SetPlanTurn(turn)
	tsx.SetPlanEmit(func(a db.Activity) { got = append(got, a) })
	tool := tsx.exitPlanMode()
	if tool.Name() != "exit_plan_mode" {
		t.Fatalf("tool name = %q, want exit_plan_mode", tool.Name())
	}
	if !tool.IsReadOnly(nil) {
		t.Fatal("exit_plan_mode must be read-only for permissions (DSH index.ts:112)")
	}
	if tool.IsConcurrencySafe(nil) {
		t.Fatal("exit_plan_mode must not be concurrency-safe (DSH index.ts:113)")
	}

	// 1) No heading → rejected, nothing persisted, turn not latched.
	res, err := tool.Call(context.Background(), json.RawMessage(`{"plan":"没有标题"}`), &actool.ToolContext{ToolUseID: "call_bad"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Fatal("a plan without a # heading must be rejected")
	}
	if len(got) != 0 {
		t.Fatalf("rejected plan must not be persisted, got %d rows", len(got))
	}
	if ok, _ := turn.submittedPlan(); ok {
		t.Fatal("rejected plan must not end the turn")
	}

	// 2) Empty plan → rejected.
	res, err = tool.Call(context.Background(), json.RawMessage(`{"plan":"   "}`), &actool.ToolContext{ToolUseID: "call_empty"})
	if err != nil || !res.IsError {
		t.Fatalf("empty plan must be rejected (err=%v isErr=%v)", err, res.IsError)
	}

	// 3) Valid plan → one kind=plan row carrying the call id, and the turn latches.
	res, err = tool.Call(context.Background(), json.RawMessage(`{"plan":"# 测试计划\n\n1. 侦察\n2. 提交"}`), &actool.ToolContext{ToolUseID: "call_ok"})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("valid plan rejected: %s", res.Flatten())
	}
	if len(got) != 1 {
		t.Fatalf("want exactly 1 persisted plan row, got %d", len(got))
	}
	row := got[0]
	if row.Kind != "plan" || row.Tool != "exit_plan_mode" || row.ToolUseID != "call_ok" {
		t.Fatalf("unexpected plan row: %+v", row)
	}
	if row.Summary != "测试计划" {
		t.Fatalf("plan title = %q, want 测试计划", row.Summary)
	}
	if !strings.HasPrefix(row.Detail, "# 测试计划") {
		t.Fatalf("plan detail must keep the markdown: %q", row.Detail)
	}
	var meta map[string]string
	if err := json.Unmarshal(row.Metadata, &meta); err != nil {
		t.Fatalf("metadata: %v", err)
	}
	if meta["title"] != "测试计划" || meta["tool_use_id"] != "call_ok" {
		t.Fatalf("metadata = %v", meta)
	}
	if !strings.Contains(res.Flatten(), "计划已提交") || !strings.Contains(res.Flatten(), "等待审批") {
		t.Fatalf("result must announce the submission: %q", res.Flatten())
	}
	if ok, title := turn.submittedPlan(); !ok || title != "测试计划" {
		t.Fatalf("turn latch = %v/%q, want true/测试计划", ok, title)
	}

	// 4) The gate then blocks every later tool call in this turn (DSH index.ts:340
	//    concludes the turn at the submission).
	gate := &planGateHooks{turn: turn}
	if block, msg, _ := gate.PreToolUse(context.Background(), "Bash", []byte(`{}`)); !block {
		t.Fatalf("after submission every tool must be blocked, msg=%q", msg)
	}

	// 5) Outside plan mode the tool refuses (DSH index.ts:304-306).
	off := NewToolSet(nil, "human")
	off.SetPlanTurn(&planTurn{})
	res, err = off.exitPlanMode().Call(context.Background(), json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_off"})
	if err != nil || !res.IsError {
		t.Fatalf("exit_plan_mode outside plan mode must fail (err=%v isErr=%v)", err, res.IsError)
	}
	if !strings.Contains(res.Flatten(), "只在计划模式下可用") {
		t.Fatalf("unexpected message: %q", res.Flatten())
	}

	// 6) No persistence channel → fail closed instead of claiming success
	//    (DSH README.md:63 / index.ts:310-313: without a review channel the tool cannot run).
	noChannel := NewToolSet(nil, "human")
	noChannel.SetPlanMode(true)
	noChannel.SetPlanTurn(&planTurn{})
	res, err = noChannel.exitPlanMode().Call(context.Background(), json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_nil"})
	if err != nil || !res.IsError {
		t.Fatalf("missing plan channel must fail closed (err=%v isErr=%v)", err, res.IsError)
	}
	if !strings.Contains(res.Flatten(), "没有可用的计划通道") {
		t.Fatalf("unexpected message: %q", res.Flatten())
	}
}
