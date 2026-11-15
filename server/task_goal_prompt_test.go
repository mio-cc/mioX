package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/agent"
	pgdb "github.com/Autumn-27/artex/db"
)

// fakeGoalStore stands in for the PG store: the goal→prompt wiring is pure once
// the row is read, so it can be tested without a database.
type fakeGoalStore struct {
	goal *pgdb.TaskGoal
	err  error
}

func (f fakeGoalStore) GetTaskGoal(int64) (*pgdb.TaskGoal, error) { return f.goal, f.err }

// TestTaskGoalPromptWiring 锁住「/goal 目标真的走到 agent 的系统提示」这条接线:
// 服务端在 mainagent 对话(server.go ChatUsing)与 planner 每轮(engine.go Plan)前都调
// taskGoalPrompt,把结果当作既有的 {{.Goal}} 变量传下去。这里验证:
//   - phase=active 的目标出现在注入文本里(进而出现在 mainAgentSystem/plannerSystem 里);
//   - paused/blocked/complete 不注入(activation-source.ts:30-32 只把 active 当"在推进");
//   - 读库失败 / 没有目标 / taskID 非法 → 原样返回静态目标,提示词不会让这一轮失败。
func TestTaskGoalPromptWiring(t *testing.T) {
	const base = "静态任务目标：验证 /goal 目标模式"
	const objective = "拿下 example.com 后台"

	activeGoal := &pgdb.TaskGoal{TaskID: 7, Objective: objective, Phase: pgdb.GoalPhaseActive}
	injected := taskGoalPromptFrom(fakeGoalStore{goal: activeGoal}, 7, base)
	if !strings.Contains(injected, objective) {
		t.Fatalf("active goal missing from the injected goal text: %q", injected)
	}
	if !strings.Contains(injected, base) {
		t.Fatalf("the static task goal was dropped: %q", injected)
	}
	// 下游系统提示(它们才是模型真正看到的东西)必须带上目标。
	if sys := agent.GoalPrompt(base, activeGoal.Objective, activeGoal.Phase); !strings.Contains(sys, objective) {
		t.Fatalf("agent.GoalPrompt dropped the objective: %q", sys)
	}

	for _, phase := range []string{pgdb.GoalPhasePaused, pgdb.GoalPhaseBlocked, pgdb.GoalPhaseComplete} {
		got := taskGoalPromptFrom(fakeGoalStore{goal: &pgdb.TaskGoal{TaskID: 7, Objective: objective, Phase: phase}}, 7, base)
		if got != base {
			t.Fatalf("phase=%s must not be injected, got %q", phase, got)
		}
	}

	if got := taskGoalPromptFrom(fakeGoalStore{}, 7, base); got != base {
		t.Fatalf("no goal must leave the base text untouched, got %q", got)
	}
	if got := taskGoalPromptFrom(fakeGoalStore{err: errors.New("db down")}, 7, base); got != base {
		t.Fatalf("a read failure must degrade to the base text, got %q", got)
	}
	if got := taskGoalPromptFrom(fakeGoalStore{goal: activeGoal}, 0, base); got != base {
		t.Fatalf("taskID 0 must not query, got %q", got)
	}
	if got := taskGoalPrompt(nil, 7, base); got != base {
		t.Fatalf("nil store must degrade to the base text, got %q", got)
	}
}
