package agent

import (
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
)

// TestGoalPromptInjectsActiveGoalOnly 锁住「/goal 目标复用既有 {{.Goal}} 注入路径」这条约束:
//
//   - mainagent.go:116 `当前任务目标：{{.Goal}}`、planner.go:310 同款 —— 目标本来就是
//     通过这一个模板变量进系统提示的,`/goal` 只换了来源,没有新造变量;
//   - activation-source.ts:30-32 `activeRef` 只把 phase==='active' 当作「在推进」,
//     所以 paused/blocked/complete 的目标不得注入,否则模型会继续推进一个已被暂停的目标;
//   - 没有目标时系统提示必须一字不变(不能因为功能上线给每个任务都加一段空话)。
func TestGoalPromptInjectsActiveGoalOnly(t *testing.T) {
	const base = "拿下 example.com 后台"
	const objective = "拿到 admin 后台的 flag"

	active := GoalPrompt(base, objective, db.GoalPhaseActive)
	if !strings.Contains(active, base) {
		t.Fatalf("active goal prompt lost the static task goal: %q", active)
	}
	if !strings.Contains(active, objective) {
		t.Fatalf("active goal prompt does not carry the objective: %q", active)
	}
	// 注入点在真实系统提示里必须可见 —— 否则"注入"只发生在字符串上,模型看不到。
	for name, sys := range map[string]string{
		"mainagent": mainAgentSystem(active, "", t.TempDir()),
		"planner":   plannerSystem(active, "", t.TempDir()),
	} {
		if !strings.Contains(sys, objective) {
			t.Fatalf("%s system prompt does not carry the active goal objective", name)
		}
	}

	// 非 active 阶段:提示词与没有目标时完全一致。
	without := GoalPrompt(base, "", db.GoalPhaseActive)
	for _, phase := range []string{db.GoalPhasePaused, db.GoalPhaseBlocked, db.GoalPhaseComplete, ""} {
		if got := GoalPrompt(base, objective, phase); got != without {
			t.Fatalf("phase=%q must not inject the goal, got %q want %q", phase, got, without)
		}
	}
	if without != base {
		t.Fatalf("no goal must leave the base text untouched, got %q", without)
	}
	if sys := mainAgentSystem(without, "", t.TempDir()); strings.Contains(sys, objective) {
		t.Fatalf("paused goal leaked into the main agent system prompt")
	}
}
