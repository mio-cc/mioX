package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// 任务级「目标」(goal)。对齐 DSH @deepseek-ai/dsh-goal:
//   - goal-command-input.ts:9  GOAL_COMMAND = 'goal' —— 目标只由 `/goal <objective>` 命令创建;
//   - GoalBar.tsx:7-9          一个会话只有【一个】目标,loading(undefined)/无目标(null)/已完成 都不渲染;
//   - GoalBar.tsx:30-41        可见阶段 active / paused / blocked(complete 不渲染);
//   - activation-source.ts:30-32 只有 phase=active 的目标才算「在推进」。
//
// 每个任务最多一行(task_id UNIQUE),revision 是 CAS 令牌:UI 拿着过期快照来改
// 必须被拒绝,而不是覆盖掉更新的目标(对齐 DSH 的 revision 比较)。
//
// 注意别和 planner 的目标节点搞混:exploration_nodes kind='goal' 是拆解出来的
// 子目标(可多条、由 prove_goal 逐条标记),这里是操作员下的那一条总目标。
const (
	GoalPhaseActive   = "active"
	GoalPhasePaused   = "paused"
	GoalPhaseBlocked  = "blocked"
	GoalPhaseComplete = "complete"

	// MaxGoalObjectiveRunes 是目标正文上限(与任务目标同量级;超长目标对提示词
	// 和 GoalBar 的截断展示都没有意义)。
	MaxGoalObjectiveRunes = 4000
)

var (
	ErrGoalInvalid       = errors.New("invalid goal")
	ErrGoalNotFound      = errors.New("goal not found")
	ErrGoalRevisionStale = errors.New("goal revision is stale")
)

// TaskGoal is the task's single operator-set objective plus its phase machine.
type TaskGoal struct {
	ID        int64     `json:"id"`
	TaskID    int64     `json:"task_id"`
	Objective string    `json:"objective"`
	Phase     string    `json:"phase"` // active | paused | blocked | complete
	Revision  int64     `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

const taskGoalCols = `id, task_id, objective, phase, revision, created_at, updated_at`

func scanTaskGoal(row interface{ Scan(...any) error }) (*TaskGoal, error) {
	var g TaskGoal
	if err := row.Scan(&g.ID, &g.TaskID, &g.Objective, &g.Phase, &g.Revision, &g.CreatedAt, &g.UpdatedAt); err != nil {
		return nil, err
	}
	return &g, nil
}

// NormalizeGoalObjective trims the objective and rejects an empty/oversized one.
func NormalizeGoalObjective(objective string) (string, error) {
	objective = strings.TrimSpace(objective)
	if objective == "" {
		return "", fmt.Errorf("%w: 目标内容不能为空", ErrGoalInvalid)
	}
	if utf8.RuneCountInString(objective) > MaxGoalObjectiveRunes {
		return "", fmt.Errorf("%w: 目标内容超过 %d 字符", ErrGoalInvalid, MaxGoalObjectiveRunes)
	}
	return objective, nil
}

// NormalizeGoalPhase validates a phase name ("" is rejected — callers that mean
// "leave it alone" must not pass a phase at all).
func NormalizeGoalPhase(phase string) (string, error) {
	switch phase = strings.TrimSpace(strings.ToLower(phase)); phase {
	case GoalPhaseActive, GoalPhasePaused, GoalPhaseBlocked, GoalPhaseComplete:
		return phase, nil
	}
	return "", fmt.Errorf("%w: phase 必须是 active/paused/blocked/complete", ErrGoalInvalid)
}

// GetTaskGoal returns the task's goal, or (nil, nil) when it has none.
func (d *DB) GetTaskGoal(taskID int64) (*TaskGoal, error) {
	if taskID <= 0 {
		return nil, nil
	}
	goal, err := scanTaskGoal(d.QueryRow(`SELECT `+taskGoalCols+` FROM task_goals WHERE task_id=$1`, taskID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return goal, nil
}

// ReplaceTaskGoal creates the task's goal or replaces an existing one. A replace
// is a NEW goal identity (DSH GoalBar.tsx:51-58 resets its local edit state when
// the goal id changes, i.e. a replaced goal is not the same goal edited): the old
// row is dropped and the new one starts at revision 1 / phase active.
func (d *DB) ReplaceTaskGoal(taskID int64, objective string) (*TaskGoal, error) {
	objective, err := NormalizeGoalObjective(objective)
	if err != nil {
		return nil, err
	}
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM task_goals WHERE task_id=$1`, taskID); err != nil {
		return nil, err
	}
	goal, err := scanTaskGoal(tx.QueryRow(`
INSERT INTO task_goals(task_id, objective, phase, revision)
VALUES ($1, $2, $3, 1) RETURNING `+taskGoalCols, taskID, objective, GoalPhaseActive))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return goal, nil
}

// UpdateTaskGoalObjective rewrites the objective and bumps the revision.
// expectedRevision > 0 enforces compare-and-set; 0 means "no precondition".
func (d *DB) UpdateTaskGoalObjective(taskID int64, objective string, expectedRevision int64) (*TaskGoal, error) {
	objective, err := NormalizeGoalObjective(objective)
	if err != nil {
		return nil, err
	}
	return d.mutateTaskGoal(`
UPDATE task_goals SET objective=$2, revision=revision+1, updated_at=now()
WHERE task_id=$1 AND ($3 = 0 OR revision=$3) RETURNING `+taskGoalCols, taskID, objective, expectedRevision)
}

// SetTaskGoalPhase moves the goal to another phase and bumps the revision.
func (d *DB) SetTaskGoalPhase(taskID int64, phase string, expectedRevision int64) (*TaskGoal, error) {
	phase, err := NormalizeGoalPhase(phase)
	if err != nil {
		return nil, err
	}
	return d.mutateTaskGoal(`
UPDATE task_goals SET phase=$2, revision=revision+1, updated_at=now()
WHERE task_id=$1 AND ($3 = 0 OR revision=$3) RETURNING `+taskGoalCols, taskID, phase, expectedRevision)
}

// mutateTaskGoal runs one CAS update and maps "no row returned" to the right
// error: a missing goal is NotFound, an existing goal with a different revision
// is RevisionStale. Without the distinction the UI cannot tell "cleared elsewhere"
// from "someone else already changed it".
func (d *DB) mutateTaskGoal(query string, args ...any) (*TaskGoal, error) {
	goal, err := scanTaskGoal(d.QueryRow(query, args...))
	if err == nil {
		return goal, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	existing, getErr := d.GetTaskGoal(args[0].(int64))
	if getErr != nil {
		return nil, getErr
	}
	if existing == nil {
		return nil, ErrGoalNotFound
	}
	return nil, fmt.Errorf("%w: 期望 revision=%v,当前 revision=%d", ErrGoalRevisionStale, args[len(args)-1], existing.Revision)
}

// ClearTaskGoal removes the task's goal. Reports whether a row was deleted so a
// repeated clear is idempotent instead of an error.
func (d *DB) ClearTaskGoal(taskID int64) (bool, error) {
	res, err := d.Exec(`DELETE FROM task_goals WHERE task_id=$1`, taskID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
