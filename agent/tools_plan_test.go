package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/intercept"
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

// newPlanToolSet builds a plan-mode ToolSet with the persistence channel and the
// review channel wired to the given outcome (DSH plan-mode/src/index.ts:316-333).
func newPlanToolSet(t *testing.T, turn *planTurn, outcome intercept.PlanReviewOutcome, reviewErr error) (*ToolSet, *[]db.Activity, *int, *[]string) {
	t.Helper()
	rows := &[]db.Activity{}
	exits := new(int)
	titles := &[]string{}
	tsx := NewToolSet(nil, "human")
	tsx.SetPlanMode(true)
	tsx.SetPlanTurn(turn)
	tsx.SetPlanEmit(func(a db.Activity) { *rows = append(*rows, a) })
	tsx.SetPlanReview(func(_ context.Context, title, plan string) (intercept.PlanReviewOutcome, error) {
		*titles = append(*titles, title)
		if reviewErr != nil {
			return intercept.PlanReviewOutcome{}, reviewErr
		}
		return outcome, nil
	})
	tsx.SetPlanExit(func() { *exits++ })
	return tsx, rows, exits, titles
}

// exitPlanMode mirrors DSH plan-mode/src/index.ts:301-376: plan mode only, non-empty
// plan starting with a `#` heading, one persisted plan per submission, then an
// INTERACTIVE review (index.ts:316-333) whose three outcomes drive three branches.
func TestExitPlanModeValidatesAndPersists(t *testing.T) {
	turn := &planTurn{}
	tsx, rows, exits, titles := newPlanToolSet(t, turn, intercept.PlanReviewOutcome{Approved: true}, nil)
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

	// 1) No heading → rejected, nothing persisted, no review raised.
	res, err := tool.Call(context.Background(), json.RawMessage(`{"plan":"没有标题"}`), &actool.ToolContext{ToolUseID: "call_bad"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Fatal("a plan without a # heading must be rejected")
	}
	if len(*rows) != 0 {
		t.Fatalf("rejected plan must not be persisted, got %d rows", len(*rows))
	}
	if len(*titles) != 0 {
		t.Fatalf("rejected plan must not be reviewed, got %d reviews", len(*titles))
	}

	// 2) Empty plan → rejected.
	res, err = tool.Call(context.Background(), json.RawMessage(`{"plan":"   "}`), &actool.ToolContext{ToolUseID: "call_empty"})
	if err != nil || !res.IsError {
		t.Fatalf("empty plan must be rejected (err=%v isErr=%v)", err, res.IsError)
	}

	// 3) Valid plan + APPROVE → one kind=plan row carrying the call id, exactly one
	//    review with the plan's title, plan mode exited, and a result that says the
	//    plan is approved and execution starts next step (DSH index.ts:294-298/358-362).
	res, err = tool.Call(context.Background(), json.RawMessage(`{"plan":"# 测试计划\n\n1. 侦察\n2. 提交"}`), &actool.ToolContext{ToolUseID: "call_ok"})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("valid plan rejected: %s", res.Flatten())
	}
	if len(*rows) != 1 {
		t.Fatalf("want exactly 1 persisted plan row, got %d", len(*rows))
	}
	row := (*rows)[0]
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
	if len(*titles) != 1 || (*titles)[0] != "测试计划" {
		t.Fatalf("review titles = %v, want [测试计划]", *titles)
	}
	if *exits != 1 {
		t.Fatalf("approval must exit plan mode once, got %d", *exits)
	}
	if state, _ := turn.status(); state != planApproved {
		t.Fatalf("turn state = %v, want planApproved", state)
	}
	if !strings.Contains(res.Flatten(), "已获用户批准") || !strings.Contains(res.Flatten(), "计划模式已退出") {
		t.Fatalf("result must announce the approval: %q", res.Flatten())
	}
	// Approved → the gate must NOT block: the model carries out the plan next step.
	gate := &planGateHooks{turn: turn}
	if block, msg, _ := gate.PreToolUse(context.Background(), "Bash", []byte(`{}`)); block {
		t.Fatalf("an approved plan must not block tools, msg=%q", msg)
	}
	if gate.ConcludeTurn() {
		t.Fatal("an approved plan must not conclude the turn")
	}
}

// KEEP PLANNING (DSH index.ts:352-357): the tool returns an ERROR carrying the user's
// feedback so the model revises and presents the plan again. The turn stays open.
func TestExitPlanModeKeepPlanningReturnsFeedback(t *testing.T) {
	turn := &planTurn{}
	tsx, rows, exits, _ := newPlanToolSet(t, turn,
		intercept.PlanReviewOutcome{Feedback: "第 2 步太危险，换成只读侦察"}, nil)
	res, err := tsx.exitPlanMode().Call(context.Background(),
		json.RawMessage(`{"plan":"# 测试计划\n\n1. 侦察\n2. 直接打"}`),
		&actool.ToolContext{ToolUseID: "call_keep"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Fatal("keep-planning must return an error so the feedback reaches the model (DSH index.ts:352-357)")
	}
	text := res.Flatten()
	if !strings.Contains(text, "用户选择继续规划") || !strings.Contains(text, "第 2 步太危险，换成只读侦察") {
		t.Fatalf("keep-planning error must carry the feedback: %q", text)
	}
	if len(*rows) != 1 {
		t.Fatalf("the submitted plan is still persisted as a plan row, got %d", len(*rows))
	}
	if *exits != 0 {
		t.Fatal("keep-planning must NOT exit plan mode")
	}
	if state, _ := turn.status(); state != planOpen {
		t.Fatalf("turn state = %v, want planOpen (revise and resubmit)", state)
	}
	gate := &planGateHooks{turn: turn}
	if block, _, _ := gate.PreToolUse(context.Background(), "Bash", []byte(`{}`)); block {
		t.Fatal("keep-planning must not block tools: the model has to revise the plan")
	}
}

// DISMISS (DSH index.ts:339-341 ASK_CANCELLED → exec.concludeTurn()): the turn ends —
// every later tool is blocked and the loop must not ask the model again.
func TestExitPlanModeDismissedConcludesTurn(t *testing.T) {
	turn := &planTurn{}
	tsx, rows, exits, _ := newPlanToolSet(t, turn, intercept.PlanReviewOutcome{Dismissed: true}, nil)
	res, err := tsx.exitPlanMode().Call(context.Background(),
		json.RawMessage(`{"plan":"# 测试计划\n\n1. 侦察"}`),
		&actool.ToolContext{ToolUseID: "call_dismiss"})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("a dismissed review is not a failure (DSH index.ts:334-341): %s", res.Flatten())
	}
	if len(*rows) != 1 {
		t.Fatalf("the plan is still persisted so the user can read it, got %d rows", len(*rows))
	}
	if *exits != 0 {
		t.Fatal("dismiss must NOT exit plan mode (DSH index.ts:298: plan mode remains active)")
	}
	if ok, title := turn.submittedPlan(); !ok || title != "测试计划" {
		t.Fatalf("turn latch = %v/%q, want true/测试计划", ok, title)
	}
	gate := &planGateHooks{turn: turn}
	if block, msg, _ := gate.PreToolUse(context.Background(), "Bash", []byte(`{}`)); !block {
		t.Fatalf("after a dismissed review every tool must be blocked, msg=%q", msg)
	}
	if !gate.ConcludeTurn() {
		t.Fatal("a dismissed review must conclude the turn (no further model request)")
	}
}

// Fail closed: no review channel means the tool must NOT claim the plan was submitted
// (DSH plan-mode/README.md:63, index.ts:310-313).
func TestExitPlanModeFailsClosedWithoutChannel(t *testing.T) {
	// No persistence channel.
	noEmit := NewToolSet(nil, "human")
	noEmit.SetPlanMode(true)
	noEmit.SetPlanTurn(&planTurn{})
	res, err := noEmit.exitPlanMode().Call(context.Background(), json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_nil"})
	if err != nil || !res.IsError {
		t.Fatalf("missing plan channel must fail closed (err=%v isErr=%v)", err, res.IsError)
	}
	if !strings.Contains(res.Flatten(), "没有可用的计划审阅通道") {
		t.Fatalf("unexpected message: %q", res.Flatten())
	}

	// Persistence channel present but no review channel → also fail closed, and no
	// plan row is written (otherwise the user would see a plan nobody can approve).
	rows := &[]db.Activity{}
	noReview := NewToolSet(nil, "human")
	noReview.SetPlanMode(true)
	noReview.SetPlanTurn(&planTurn{})
	noReview.SetPlanEmit(func(a db.Activity) { *rows = append(*rows, a) })
	res, err = noReview.exitPlanMode().Call(context.Background(), json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_noreview"})
	if err != nil || !res.IsError {
		t.Fatalf("missing review channel must fail closed (err=%v isErr=%v)", err, res.IsError)
	}
	if len(*rows) != 0 {
		t.Fatalf("no plan row may be written without a review channel, got %d", len(*rows))
	}
}

// A review that cannot be raised is reported to the model instead of pretending the
// plan reached the user.
func TestExitPlanModeReviewErrorIsReported(t *testing.T) {
	tsx, _, exits, _ := newPlanToolSet(t, &planTurn{}, intercept.PlanReviewOutcome{}, errors.New("审批存储不可用"))
	res, err := tsx.exitPlanMode().Call(context.Background(),
		json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_err"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError || !strings.Contains(res.Flatten(), "审阅通道出错") {
		t.Fatalf("review failure must be reported: %q", res.Flatten())
	}
	if *exits != 0 {
		t.Fatal("a failed review must not exit plan mode")
	}
}

// Outside plan mode (and after the turn's plan was approved/concluded) the tool
// refuses: DSH index.ts:304-306 reads the committed state.
func TestExitPlanModeRefusesOutsidePlanMode(t *testing.T) {
	off := NewToolSet(nil, "human")
	off.SetPlanTurn(&planTurn{})
	res, err := off.exitPlanMode().Call(context.Background(), json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_off"})
	if err != nil || !res.IsError {
		t.Fatalf("exit_plan_mode outside plan mode must fail (err=%v isErr=%v)", err, res.IsError)
	}
	if !strings.Contains(res.Flatten(), "只在计划模式下可用") {
		t.Fatalf("unexpected message: %q", res.Flatten())
	}

	// Approved already → a second submission is refused (plan mode is gone).
	approved := &planTurn{}
	approved.set(planApproved, "已批准的计划")
	again, _, exits, _ := newPlanToolSet(t, approved, intercept.PlanReviewOutcome{Approved: true}, nil)
	res, err = again.exitPlanMode().Call(context.Background(), json.RawMessage(`{"plan":"# 标题"}`), &actool.ToolContext{ToolUseID: "call_again"})
	if err != nil || !res.IsError {
		t.Fatalf("a second submission after approval must fail (err=%v isErr=%v)", err, res.IsError)
	}
	if *exits != 0 {
		t.Fatal("a refused call must not exit plan mode")
	}
}
