package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/Autumn-27/artex/agent"
	pgdb "github.com/Autumn-27/artex/db"
)

// 任务级「目标」(goal) 的人工接口 —— 对齐 DSH @deepseek-ai/dsh-goal:
//
//   - goal-command-input.ts:9   GOAL_COMMAND='goal':目标由 `/goal <objective>` 命令创建,
//     不是在输入框里「设置」出来的一个字段;
//   - GoalCommandInputView.tsx:13-18 这条命令在对话流里是一个右对齐气泡(`/goal` 是 chip),
//     所以创建目标时必须同时把这一「人类命令回合」写进会话记录,否则刷新就消失;
//   - GoalBar.tsx:1-10         GoalBar 停在输入框上方,显示 阶段标签 + 截断目标 + 编辑/清除/暂停/恢复;
//     loading/无目标/已完成 都不渲染 → GET 返回 null 时前端整条不渲染;
//   - activation-source.ts:11-41 只有 phase=active 才算「在推进」,所以系统提示只注入 active 目标。
//
// 与 server/goals_api.go 的区别:那边是 planner 的目标节点(可多条、prove_goal 逐条标记),
// 这边是操作员下的那一条总目标(每任务一条、带阶段与 revision CAS)。

// TaskGoalDTO is the wire shape of a task goal (id as string, like every other
// id in this API).
type TaskGoalDTO struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	Objective string `json:"objective"`
	Phase     string `json:"phase"` // active | paused | blocked | complete
	Revision  int64  `json:"revision"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func taskGoalDTO(g *pgdb.TaskGoal) *TaskGoalDTO {
	if g == nil {
		return nil
	}
	return &TaskGoalDTO{
		ID:        i64s(g.ID),
		TaskID:    i64s(g.TaskID),
		Objective: g.Objective,
		Phase:     g.Phase,
		Revision:  g.Revision,
		CreatedAt: rfc3339(g.CreatedAt),
		UpdatedAt: rfc3339(g.UpdatedAt),
	}
}

// taskGoalID parses the task id from the path once, for every goal handler.
func (s *Server) taskGoalID(w http.ResponseWriter, r *http.Request) (int64, *Task, bool) {
	t, ok := s.m.Task(r.PathValue("id"))
	if !ok {
		writeErr(w, 404, "task not found")
		return 0, nil, false
	}
	taskID, err := strconv.ParseInt(t.ID, 10, 64)
	if err != nil || taskID <= 0 {
		writeErr(w, 400, "bad task id")
		return 0, nil, false
	}
	return taskID, t, true
}

// decodeGoalObjective reads {"objective": "..."} and normalizes it.
func decodeGoalObjective(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Objective string `json:"objective"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return "", false
	}
	objective, err := pgdb.NormalizeGoalObjective(body.Objective)
	if err != nil {
		writeErr(w, 400, err.Error())
		return "", false
	}
	return objective, true
}

// writeGoalError maps store errors onto status codes so the UI can tell a stale
// revision (409) from a missing goal (404).
func writeGoalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, pgdb.ErrGoalInvalid):
		writeErr(w, 400, err.Error())
	case errors.Is(err, pgdb.ErrGoalNotFound):
		writeErr(w, 404, err.Error())
	case errors.Is(err, pgdb.ErrGoalRevisionStale):
		writeErr(w, 409, err.Error())
	default:
		writeErr(w, 500, err.Error())
	}
}

// taskGoalGet returns the task's goal: {"goal": {...}} or {"goal": null}.
func (s *Server) taskGoalGet(w http.ResponseWriter, r *http.Request) {
	taskID, _, ok := s.taskGoalID(w, r)
	if !ok {
		return
	}
	goal, err := s.m.PG().GetTaskGoal(taskID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"goal": taskGoalDTO(goal)})
}

// taskGoalSet creates or replaces the goal (the `/goal <objective>` command).
// The command turn is also written into the main-agent transcript so the
// right-aligned `/goal` bubble survives a reload (GoalCommandInputView.tsx).
func (s *Server) taskGoalSet(w http.ResponseWriter, r *http.Request) {
	taskID, t, ok := s.taskGoalID(w, r)
	if !ok {
		return
	}
	if !s.engine.beginTaskOperation(t.ID) {
		writeErr(w, 409, "任务正在删除,无法设置目标")
		return
	}
	defer s.engine.decInflight(t.ID)

	objective, ok := decodeGoalObjective(w, r)
	if !ok {
		return
	}
	goal, err := s.m.PG().ReplaceTaskGoal(taskID, objective)
	if err != nil {
		writeGoalError(w, err)
		return
	}
	s.recordGoalCommand(t, objective)
	writeJSON(w, 200, map[string]any{"goal": taskGoalDTO(goal)})
}

// recordGoalCommand writes the human `/goal <objective>` turn into the current
// main-agent segment. Same row shape as a normal human message, so the existing
// transcript/lane/echo plumbing renders it without a new node type.
func (s *Server) recordGoalCommand(t *Task, objective string) {
	if t == nil || t.Store == nil {
		return
	}
	seg, _ := t.Store.CurrentMainSeg()
	segPtr := &seg
	turn := userActivityWithAttachments("mainagent", "/goal "+objective, nil)
	turn.MainSeg = segPtr
	s.engine.emitActivity(t, turn)
}

// taskGoalEdit rewrites the objective and bumps the revision (PATCH). A body
// revision > 0 is a compare-and-set precondition: a stale editor gets 409
// instead of silently overwriting a newer goal (activation-source.ts:26/85).
func (s *Server) taskGoalEdit(w http.ResponseWriter, r *http.Request) {
	taskID, t, ok := s.taskGoalID(w, r)
	if !ok {
		return
	}
	if !s.engine.beginTaskOperation(t.ID) {
		writeErr(w, 409, "任务正在删除,无法修改目标")
		return
	}
	defer s.engine.decInflight(t.ID)

	var body struct {
		Objective string `json:"objective"`
		Revision  int64  `json:"revision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	objective, err := pgdb.NormalizeGoalObjective(body.Objective)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	goal, err := s.m.PG().UpdateTaskGoalObjective(taskID, objective, body.Revision)
	if err != nil {
		writeGoalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"goal": taskGoalDTO(goal)})
}

// taskGoalSetPhase implements pause / resume (POST .../goal/{pause,resume}).
func (s *Server) taskGoalSetPhase(w http.ResponseWriter, r *http.Request, phase string) {
	taskID, t, ok := s.taskGoalID(w, r)
	if !ok {
		return
	}
	if !s.engine.beginTaskOperation(t.ID) {
		writeErr(w, 409, "任务正在删除,无法切换目标阶段")
		return
	}
	defer s.engine.decInflight(t.ID)

	var body struct {
		Revision int64 `json:"revision"`
	}
	// An empty body is legal (pause/resume with no CAS precondition).
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeErr(w, 400, "invalid JSON")
		return
	}
	goal, err := s.m.PG().SetTaskGoalPhase(taskID, phase, body.Revision)
	if err != nil {
		writeGoalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"goal": taskGoalDTO(goal)})
}

func (s *Server) taskGoalPause(w http.ResponseWriter, r *http.Request) {
	s.taskGoalSetPhase(w, r, pgdb.GoalPhasePaused)
}

func (s *Server) taskGoalResume(w http.ResponseWriter, r *http.Request) {
	s.taskGoalSetPhase(w, r, pgdb.GoalPhaseActive)
}

// taskGoalClear removes the goal; the GoalBar disappears because the task
// response's goal_state becomes null (GoalBar.tsx:87 renders nothing for null).
func (s *Server) taskGoalClear(w http.ResponseWriter, r *http.Request) {
	taskID, t, ok := s.taskGoalID(w, r)
	if !ok {
		return
	}
	if !s.engine.beginTaskOperation(t.ID) {
		writeErr(w, 409, "任务正在删除,无法清除目标")
		return
	}
	defer s.engine.decInflight(t.ID)

	removed, err := s.m.PG().ClearTaskGoal(taskID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "cleared": removed, "goal": nil})
}

// goalReader is the slice of the PG store the goal-prompt wiring needs. Narrowing
// it to an interface keeps the wiring testable without a database (the prompt must
// never be the reason a turn fails).
type goalReader interface {
	GetTaskGoal(taskID int64) (*pgdb.TaskGoal, error)
}

// taskGoalPromptFrom is the actual wiring: read the task goal, then hand it to
// agent.GoalPrompt, which owns the "active only" rule.
func taskGoalPromptFrom(store goalReader, taskID int64, base string) string {
	if store == nil || taskID <= 0 {
		return base
	}
	goal, err := store.GetTaskGoal(taskID)
	if err != nil || goal == nil {
		return base
	}
	return agent.GoalPrompt(base, goal.Objective, goal.Phase)
}

// taskGoalPrompt returns the text injected into the existing {{.Goal}} slot.
// Reuses the goal-injection path that already exists (mainAgentSystem /
// plannerSystem render {{.Goal}}): an ACTIVE goal is appended to the task's
// static goal; paused/blocked/complete goals are not, because only an active
// goal means "the session keeps working toward it" (activation-source.ts:30-32).
// A read failure degrades to the static goal — the prompt must never fail a turn.
func taskGoalPrompt(pg *pgdb.DB, taskID int64, base string) string {
	if pg == nil {
		return base
	}
	return taskGoalPromptFrom(pg, taskID, base)
}

// taskGoalPromptText is the Server-side convenience wrapper (chat handler).
func (s *Server) taskGoalPromptText(t *Task) string {
	if t == nil {
		return ""
	}
	taskID, _ := strconv.ParseInt(t.ID, 10, 64)
	return taskGoalPrompt(s.m.PG(), taskID, t.Goal)
}

