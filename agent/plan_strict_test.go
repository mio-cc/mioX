package agent

import (
	"context"
	"encoding/json"
	"testing"

	actool "github.com/Autumn-27/norma/tool"
)

func planTestTool(name string, ro bool) actool.CoreTool {
	return actool.Build(actool.Spec{Name: name, Schema: obj(map[string]any{}),
		ReadOnly: func(json.RawMessage) bool { return ro }})
}

// P-1:严格模式拒绝非只读工具、放行只读工具;非严格模式只告警不拦截;
// ForcePlanStrict(只读自动化)无视设置一律拦截;计划已批准后不再拦。
func TestPlanGateStrictBoundary(t *testing.T) {
	tools := map[string]actool.CoreTool{
		"list_findings": planTestTool("list_findings", true),
		"Bash":          planTestTool("Bash", false),
	}
	strict := false
	warned := []string{}
	h := &planGateHooks{turn: &planTurn{}, tools: tools,
		strict: func() bool { return strict },
		warn:   func(n string) { warned = append(warned, n) }}
	ctx := context.Background()

	if deny, _, _ := h.PreToolUse(ctx, "Bash", []byte(`{}`)); deny {
		t.Fatal("non-strict must not block")
	}
	if len(warned) != 1 || warned[0] != "Bash" {
		t.Fatalf("non-strict must warn once, got %v", warned)
	}
	strict = true
	if deny, msg, _ := h.PreToolUse(ctx, "Bash", []byte(`{}`)); !deny || msg != planModeBlockedMsg {
		t.Fatalf("strict must block Bash, got deny=%v msg=%q", deny, msg)
	}
	if deny, _, _ := h.PreToolUse(ctx, "list_findings", []byte(`{}`)); deny {
		t.Fatal("read-only tool must pass in strict mode")
	}
	if deny, _, _ := h.PreToolUse(ctx, "unknown_mcp_tool", []byte(`{}`)); !deny {
		t.Fatal("unknown tool must fail closed in strict mode")
	}
	if deny, _, _ := h.PreToolUse(ctx, exitPlanModeName, []byte(`{}`)); deny {
		t.Fatal("exit_plan_mode must always pass")
	}
	strict = false
	if deny, _, _ := h.PreToolUse(WithForcePlanStrict(ctx), "Bash", []byte(`{}`)); !deny {
		t.Fatal("forced strict (readonly automation) must block regardless of setting")
	}
	strict = true
	h.turn.set(planApproved, "x")
	if deny, _, _ := h.PreToolUse(ctx, "Bash", []byte(`{}`)); deny {
		t.Fatal("after approval tools must pass")
	}
}
