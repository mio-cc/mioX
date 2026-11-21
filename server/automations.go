package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Autumn-27/artex/db"
)

// 自动化(定时任务)REST + 调度投递(S-3/S-4/S-5)。时间计算见 automation_timing.go,
// 存取见 db/automations.go。
//
// 投递语义(target_kind=task):
//   - 到期 → 等价于「用户往该任务主会话发一条消息并触发一轮」(startTaskChatTurn),
//     user 行 metadata = {"source":"automation","automation_id",...},不绑定为人类审阅背景;
//   - 主 Agent 正在处理上一轮(chatBusy)或该自动化的上一轮还没结束 → 记一条 queued run,
//     空闲后由调度器投递;已有 queued run 时再次到期只合并(更新 scheduled_at),不新增;
//   - safety=readonly → 投递前打开任务 plan_mode,本轮按严格硬边界拒绝非只读工具,
//     本轮结束后若计划模式是本自动化打开的则恢复为关闭;
//   - target_kind=agent → 复用 StartTriggeredRun(新建 agent 对话);new_task 未实现(400)。

// automationMu serializes dispatch decisions (scheduler tick vs. manual /run), so
// "is there a queued run / is it active" checks and the following writes are atomic.
var automationMu sync.Mutex

// automationActive holds automation ids whose delivered turn is still running.
var automationActive sync.Map // int64 -> int64(run id)

// automationDispatchDecision is the pure merge/queue rule (unit-tested):
//   - "merge":   a queued run already exists → fold this occurrence into it;
//   - "queue":   the automation's previous turn or the task's main agent is busy;
//   - "deliver": send now.
func automationDispatchDecision(hasQueued, automationActive, chatBusy bool) string {
	switch {
	case hasQueued:
		return "merge"
	case automationActive || chatBusy:
		return "queue"
	default:
		return "deliver"
	}
}

// ---------- DTO ----------

type AutomationDTO struct {
	ID         string          `json:"id"`
	Title      string          `json:"title"`
	Prompt     string          `json:"prompt"`
	TargetKind string          `json:"target_kind"`
	TaskID     *string         `json:"task_id"`
	AgentKey   string          `json:"agent_key"`
	TimingKind string          `json:"timing_kind"`
	Timing     json.RawMessage `json:"timing"`
	Enabled    bool            `json:"enabled"`
	Safety     string          `json:"safety"`
	NextRunAt  *string         `json:"next_run_at"`
	LastRunAt  *string         `json:"last_run_at"`
	LastStatus string          `json:"last_status"`
	Running    bool            `json:"running"`
	CreatedAt  string          `json:"created_at"`
	UpdatedAt  string          `json:"updated_at"` // RFC3339Nano;PATCH 的 expected_updated_at 原样回传
}

type AutomationRunDTO struct {
	ID            string  `json:"id"`
	AutomationID  string  `json:"automation_id"`
	ScheduledAt   string  `json:"scheduled_at"`
	StartedAt     *string `json:"started_at"`
	FinishedAt    *string `json:"finished_at"`
	Status        string  `json:"status"`
	Summary       string  `json:"summary"`
	FindingsDelta int     `json:"findings_delta"`
	TaskID        *string `json:"task_id"`
	Error         string  `json:"error"`
}

func optTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

func optID(v *int64) *string {
	if v == nil {
		return nil
	}
	s := strconv.FormatInt(*v, 10)
	return &s
}

func automationDTO(a *db.Automation) AutomationDTO {
	_, running := automationActive.Load(a.ID)
	return AutomationDTO{
		ID: i64s(a.ID), Title: a.Title, Prompt: a.Prompt, TargetKind: a.TargetKind, TaskID: optID(a.TaskID),
		AgentKey: a.AgentKey, TimingKind: a.TimingKind, Timing: a.Timing, Enabled: a.Enabled, Safety: a.Safety,
		NextRunAt: optTime(a.NextRunAt), LastRunAt: optTime(a.LastRunAt), LastStatus: a.LastStatus, Running: running,
		CreatedAt: a.CreatedAt.Format(time.RFC3339), UpdatedAt: a.UpdatedAt.Format(time.RFC3339Nano),
	}
}

func automationRunDTO(r *db.AutomationRun) AutomationRunDTO {
	return AutomationRunDTO{
		ID: i64s(r.ID), AutomationID: i64s(r.AutomationID), ScheduledAt: r.ScheduledAt.Format(time.RFC3339),
		StartedAt: optTime(r.StartedAt), FinishedAt: optTime(r.FinishedAt), Status: r.Status, Summary: r.Summary,
		FindingsDelta: r.FindingsDelta, TaskID: optID(r.TaskID), Error: r.Error,
	}
}

// ---------- validation ----------

// flexID accepts a JSON string or number id ("133" or 133); null/"" = unset.
type flexID struct {
	Set bool
	Val int64
}

func (f *flexID) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if s == "" || s == "null" {
		*f = flexID{Set: true}
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return fmt.Errorf("id 必须是整数")
	}
	*f = flexID{Set: true, Val: v}
	return nil
}

type automationReq struct {
	Title             *string          `json:"title"`
	Prompt            *string          `json:"prompt"`
	TargetKind        *string          `json:"target_kind"`
	TaskID            *flexID          `json:"task_id"`
	AgentKey          *string          `json:"agent_key"`
	TimingKind        *string          `json:"timing_kind"`
	Timing            *json.RawMessage `json:"timing"`
	Enabled           *bool            `json:"enabled"`
	Safety            *string          `json:"safety"`
	ExpectedUpdatedAt *string          `json:"expected_updated_at"`
}

type httpErr struct {
	code int
	msg  string
}

func (e *httpErr) Error() string { return e.msg }

func badReq(format string, a ...any) error { return &httpErr{400, fmt.Sprintf(format, a...)} }

func writeAutomationErr(w http.ResponseWriter, err error) {
	var he *httpErr
	switch {
	case errors.As(err, &he):
		writeErr(w, he.code, he.msg)
	case errors.Is(err, db.ErrAutomationNotFound):
		writeErr(w, 404, "自动化不存在")
	case errors.Is(err, db.ErrAutomationStale):
		writeErr(w, 409, "自动化已在别处修改，请刷新后重试")
	default:
		writeErr(w, 500, err.Error())
	}
}

func defaultAutomationTitle(prompt string) string {
	line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(prompt), "\n", 2)[0])
	if utf8.RuneCountInString(line) > 40 {
		line = string([]rune(line)[:40]) + "…"
	}
	return line
}

// applyAutomationReq merges req into a (create: a is zero-valued with defaults),
// validates the result and recomputes next_run_at when timing/enabled changed.
func (s *Server) applyAutomationReq(a *db.Automation, req automationReq, creating bool, now time.Time) error {
	timingChanged := creating
	if req.Prompt != nil {
		a.Prompt = strings.TrimSpace(*req.Prompt)
	}
	if req.Title != nil {
		a.Title = strings.TrimSpace(*req.Title)
	}
	if req.TargetKind != nil {
		a.TargetKind = strings.TrimSpace(*req.TargetKind)
	}
	if req.TaskID != nil {
		if req.TaskID.Val > 0 {
			v := req.TaskID.Val
			a.TaskID = &v
		} else {
			a.TaskID = nil
		}
	}
	if req.AgentKey != nil {
		a.AgentKey = strings.TrimSpace(*req.AgentKey)
	}
	if req.TimingKind != nil {
		a.TimingKind = strings.TrimSpace(*req.TimingKind)
		timingChanged = true
	}
	if req.Timing != nil {
		a.Timing = *req.Timing
		timingChanged = true
	}
	wasEnabled := a.Enabled
	if req.Enabled != nil {
		a.Enabled = *req.Enabled
	}
	if req.Safety != nil {
		a.Safety = strings.TrimSpace(*req.Safety)
	}

	if a.Prompt == "" {
		return badReq("prompt 不能为空")
	}
	if utf8.RuneCountInString(a.Prompt) > 8000 {
		return badReq("prompt 超过 8000 字符")
	}
	if a.Title == "" {
		a.Title = defaultAutomationTitle(a.Prompt)
	}
	if utf8.RuneCountInString(a.Title) > 120 {
		return badReq("title 超过 120 字符")
	}
	switch a.Safety {
	case "":
		a.Safety = "readonly"
	case "readonly", "inherit":
	default:
		return badReq("safety 必须是 readonly 或 inherit")
	}
	switch a.TargetKind {
	case "", "task":
		a.TargetKind = "task"
		if a.TaskID == nil {
			return badReq("target_kind=task 需要 task_id")
		}
		if _, ok := s.m.Task(strconv.FormatInt(*a.TaskID, 10)); !ok {
			return badReq("任务 %d 不存在", *a.TaskID)
		}
		a.AgentKey = ""
	case "agent":
		if a.AgentKey == "" {
			return badReq("target_kind=agent 需要 agent_key")
		}
		ag, err := s.m.pg.GetAgentByKey(a.AgentKey)
		if err != nil {
			return err
		}
		if ag == nil {
			return badReq("agent %q 不存在", a.AgentKey)
		}
		if ag.Builtin {
			return badReq("target_kind=agent 仅支持自定义 agent(与触发器一致)")
		}
	case "new_task":
		return badReq("target_kind=new_task 暂未实现")
	default:
		return badReq("target_kind 必须是 task/agent/new_task")
	}
	if timingChanged {
		_, canon, err := parseAutomationTiming(a.TimingKind, a.Timing, now)
		if err != nil {
			return badReq("%s", err.Error())
		}
		a.Timing = canon
	}
	if !a.Enabled {
		a.NextRunAt = nil
		return nil
	}
	if timingChanged || !wasEnabled || a.NextRunAt == nil {
		t, _, err := parseAutomationTiming(a.TimingKind, a.Timing, now)
		if err != nil {
			if a.TimingKind == "once" && !timingChanged {
				// 重新启用一个已过期的一次性任务:没有下一次可跑。
				return badReq("一次性任务的时间已过，请修改时间后再启用")
			}
			return badReq("%s", err.Error())
		}
		next, err := nextAutomationRun(a.TimingKind, t, now, time.Time{})
		if err != nil {
			return badReq("%s", err.Error())
		}
		a.NextRunAt = next
	}
	return nil
}

func automationPathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, badReq("bad automation id")
	}
	return id, nil
}

// ---------- handlers ----------

// GET /api/automations[?task_id=]
func (s *Server) listAutomations(w http.ResponseWriter, r *http.Request) {
	var taskID int64
	if v := strings.TrimSpace(r.URL.Query().Get("task_id")); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeErr(w, 400, "bad task_id")
			return
		}
		taskID = id
	}
	list, err := s.m.pg.ListAutomations(taskID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := make([]AutomationDTO, 0, len(list))
	for _, a := range list {
		out = append(out, automationDTO(a))
	}
	writeJSON(w, 200, map[string]any{"automations": out})
}

// POST /api/automations
func (s *Server) createAutomation(w http.ResponseWriter, r *http.Request) {
	var req automationReq
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON: "+err.Error())
		return
	}
	a := &db.Automation{Enabled: true}
	if err := s.applyAutomationReq(a, req, true, time.Now()); err != nil {
		writeAutomationErr(w, err)
		return
	}
	saved, err := s.m.pg.CreateAutomation(a)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	log.Printf("[automation] #%d 已创建：%s（%s，next=%v）", saved.ID, saved.Title, saved.TimingKind, saved.NextRunAt)
	writeJSON(w, 200, map[string]any{"automation": automationDTO(saved)})
}

// PATCH /api/automations/{id}
func (s *Server) patchAutomation(w http.ResponseWriter, r *http.Request) {
	id, err := automationPathID(r)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	var req automationReq
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON: "+err.Error())
		return
	}
	var expected *time.Time
	if req.ExpectedUpdatedAt != nil && strings.TrimSpace(*req.ExpectedUpdatedAt) != "" {
		t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*req.ExpectedUpdatedAt))
		if err != nil {
			writeErr(w, 400, "expected_updated_at 必须是 RFC3339 时间(用 GET 返回的 updated_at 原值)")
			return
		}
		expected = &t
	}
	automationMu.Lock()
	defer automationMu.Unlock()
	a, err := s.m.pg.GetAutomation(id)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	if err := s.applyAutomationReq(a, req, false, time.Now()); err != nil {
		writeAutomationErr(w, err)
		return
	}
	saved, err := s.m.pg.UpdateAutomation(a, expected)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"automation": automationDTO(saved)})
}

// DELETE /api/automations/{id}
func (s *Server) deleteAutomation(w http.ResponseWriter, r *http.Request) {
	id, err := automationPathID(r)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	automationMu.Lock()
	removed, err := s.m.pg.DeleteAutomation(id)
	automationMu.Unlock()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if !removed {
		writeErr(w, 404, "自动化不存在")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// POST /api/automations/{id}/run — run now (does not change the schedule).
func (s *Server) runAutomationNow(w http.ResponseWriter, r *http.Request) {
	id, err := automationPathID(r)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	a, err := s.m.pg.GetAutomation(id)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	if a.TargetKind == "new_task" {
		writeErr(w, 400, "target_kind=new_task 暂未实现")
		return
	}
	run, outcome, err := s.dispatchAutomation(a, time.Now(), true)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	resp := map[string]any{"outcome": outcome}
	if run != nil {
		resp["run"] = automationRunDTO(run)
	}
	writeJSON(w, 200, resp)
}

// GET /api/automations/{id}/runs?limit=20&before=<run id>
func (s *Server) listAutomationRuns(w http.ResponseWriter, r *http.Request) {
	id, err := automationPathID(r)
	if err != nil {
		writeAutomationErr(w, err)
		return
	}
	if _, err := s.m.pg.GetAutomation(id); err != nil {
		writeAutomationErr(w, err)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	runs, err := s.m.pg.ListAutomationRuns(id, before, limit+1)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	hasMore := len(runs) > limit
	if hasMore {
		runs = runs[:limit]
	}
	out := make([]AutomationRunDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, automationRunDTO(run))
	}
	resp := map[string]any{"runs": out, "has_more": hasMore, "next_before": nil}
	if hasMore && len(runs) > 0 {
		resp["next_before"] = i64s(runs[len(runs)-1].ID)
	}
	writeJSON(w, 200, resp)
}

// POST /api/automations/preview {timing_kind, timing} → next 3 run times.
func (s *Server) previewAutomation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TimingKind string          `json:"timing_kind"`
		Timing     json.RawMessage `json:"timing"`
		Count      int             `json:"count"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON: "+err.Error())
		return
	}
	now := time.Now()
	t, _, err := parseAutomationTiming(strings.TrimSpace(req.TimingKind), req.Timing, now)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	n := req.Count
	if n <= 0 || n > 10 {
		n = 3
	}
	times, err := previewAutomationRuns(strings.TrimSpace(req.TimingKind), t, now, n)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	out := make([]string, 0, len(times))
	for _, x := range times {
		out = append(out, x.Format(time.RFC3339))
	}
	tz := t.TZ
	if tz == "" {
		tz = time.Local.String()
	}
	writeJSON(w, 200, map[string]any{"runs": out, "tz": tz})
}

// ---------- scheduling / delivery ----------

// fireAutomations is the scheduler hook (every tick): deliver queued runs whose
// task became idle, then fire due automations. Missed occurrences collapse.
func (s *Server) fireAutomations(now time.Time) {
	if s.m == nil || s.m.pg == nil {
		return
	}
	s.drainQueuedAutomationRuns()
	due, err := s.m.pg.DueAutomations(now)
	if err != nil {
		return
	}
	for _, a := range due {
		scheduled := now
		if a.NextRunAt != nil {
			scheduled = *a.NextRunAt
		}
		t, _, perr := parseAutomationTiming(a.TimingKind, a.Timing, time.Time{})
		var next *time.Time
		disable := false
		if perr == nil {
			next, disable, perr = dueAutomationAdvance(a.TimingKind, t, scheduled, now)
		}
		if perr != nil {
			// 规则无法计算(损坏的 timing / 无解的 cron):停用,避免每 tick 重复触发。
			log.Printf("[automation] #%d 时间规则无效，已停用：%v", a.ID, perr)
			_ = s.m.pg.AdvanceAutomation(a.ID, nil, true)
			_ = s.m.pg.MarkAutomationResult(a.ID, now, "error")
			continue
		}
		// 先推进 next_run_at 再投递:即使投递出错也不会每 5 秒重复触发。
		if err := s.m.pg.AdvanceAutomation(a.ID, next, disable); err != nil {
			log.Printf("[automation] #%d 推进 next_run_at 失败：%v", a.ID, err)
			continue
		}
		if _, _, err := s.dispatchAutomation(a, scheduled, false); err != nil {
			log.Printf("[automation] #%d 投递失败：%v", a.ID, err)
		}
	}
}

// dispatchAutomation fires one occurrence. Returns the run row and an outcome:
// delivered | queued | merged | skipped | agent.
func (s *Server) dispatchAutomation(a *db.Automation, scheduled time.Time, manual bool) (*db.AutomationRun, string, error) {
	automationMu.Lock()
	defer automationMu.Unlock()
	pg := s.m.pg
	now := time.Now()
	if a.TargetKind == "agent" {
		title := "自动化 · " + a.Title
		msg := a.Prompt + "\n\n【本条消息由自动化「" + a.Title + "」定时投递" + now.Format(" 2006-01-02 15:04:05 MST") + "】"
		var tid int64
		if a.TaskID != nil {
			tid = *a.TaskID
		}
		s.StartTriggeredRun(a.AgentKey, title, msg, tid, false, "", "")
		run, err := pg.CreateAutomationRun(&db.AutomationRun{AutomationID: a.ID, ScheduledAt: scheduled, StartedAt: &now,
			Status: "done", Summary: "已投递到 agent「" + a.AgentKey + "」的触发队列（新建 agent 对话）"})
		if err == nil {
			fin := time.Now()
			run.FinishedAt = &fin
			_ = pg.UpdateAutomationRun(run)
		}
		_ = pg.MarkAutomationResult(a.ID, now, "ok")
		return run, "agent", err
	}
	if a.TaskID == nil {
		return s.skipAutomation(a, scheduled, "目标任务不可用（已删除或未设置），自动化已暂停")
	}
	t, ok := s.m.Task(strconv.FormatInt(*a.TaskID, 10))
	if !ok || s.engine.IsDeleting(t.ID) {
		return s.skipAutomation(a, scheduled, fmt.Sprintf("目标任务 #%d 不可用（已删除或归档），自动化已暂停", *a.TaskID))
	}
	queued, err := pg.QueuedAutomationRun(a.ID)
	if err != nil {
		return nil, "", err
	}
	_, active := automationActive.Load(a.ID)
	s.chatMu.Lock()
	busy := s.chatBusy[t.ID]
	s.chatMu.Unlock()
	switch automationDispatchDecision(queued != nil, active, busy) {
	case "merge":
		queued.ScheduledAt = scheduled
		queued.Summary = "任务主会话忙，等待空闲后投递（多次到期已合并为一次）"
		if err := pg.UpdateAutomationRun(queued); err != nil {
			return nil, "", err
		}
		return queued, "merged", nil
	case "queue":
		run, err := pg.CreateAutomationRun(&db.AutomationRun{AutomationID: a.ID, ScheduledAt: scheduled, Status: "queued",
			Summary: "任务主会话忙，等待空闲后投递", TaskID: a.TaskID})
		if err != nil {
			return nil, "", err
		}
		_ = pg.MarkAutomationResult(a.ID, now, "queued")
		return run, "queued", nil
	}
	run, err := pg.CreateAutomationRun(&db.AutomationRun{AutomationID: a.ID, ScheduledAt: scheduled, Status: "queued", TaskID: a.TaskID})
	if err != nil {
		return nil, "", err
	}
	if err := s.deliverAutomationRunLocked(a, t, run, manual); err != nil {
		return run, "queued", nil // 竞态下主会话刚变忙:保持 queued,下个 tick 再投
	}
	return run, "delivered", nil
}

func (s *Server) skipAutomation(a *db.Automation, scheduled time.Time, reason string) (*db.AutomationRun, string, error) {
	now := time.Now()
	run, err := s.m.pg.CreateAutomationRun(&db.AutomationRun{AutomationID: a.ID, ScheduledAt: scheduled, StartedAt: &now,
		Status: "skipped", Summary: reason, Error: reason, TaskID: a.TaskID})
	if err == nil {
		run.FinishedAt = &now
		_ = s.m.pg.UpdateAutomationRun(run)
	}
	_ = s.m.pg.AdvanceAutomation(a.ID, nil, true)
	_ = s.m.pg.MarkAutomationResult(a.ID, now, "error")
	return run, "skipped", err
}

// drainQueuedAutomationRuns delivers queued runs whose task main agent is idle.
func (s *Server) drainQueuedAutomationRuns() {
	runs, err := s.m.pg.ListQueuedAutomationRuns()
	if err != nil || len(runs) == 0 {
		return
	}
	automationMu.Lock()
	defer automationMu.Unlock()
	for _, run := range runs {
		if _, active := automationActive.Load(run.AutomationID); active {
			continue
		}
		a, err := s.m.pg.GetAutomation(run.AutomationID)
		if err != nil {
			continue
		}
		fail := func(msg string) {
			now := time.Now()
			run.Status, run.Error, run.Summary, run.FinishedAt = "skipped", msg, msg, &now
			_ = s.m.pg.UpdateAutomationRun(run)
		}
		if a.TaskID == nil {
			fail("目标任务不可用")
			continue
		}
		t, ok := s.m.Task(strconv.FormatInt(*a.TaskID, 10))
		if !ok || s.engine.IsDeleting(t.ID) {
			fail("目标任务不可用")
			continue
		}
		s.chatMu.Lock()
		busy := s.chatBusy[t.ID]
		s.chatMu.Unlock()
		if busy {
			continue
		}
		_ = s.deliverAutomationRunLocked(a, t, run, false)
	}
}

// deliverAutomationRunLocked sends the automation prompt into the task's main
// session as one turn. Caller holds automationMu.
func (s *Server) deliverAutomationRunLocked(a *db.Automation, t *Task, run *db.AutomationRun, manual bool) error {
	pg := s.m.pg
	taskID, _ := strconv.ParseInt(t.ID, 10, 64)
	readonly := a.Safety == "readonly"
	planTurnedOn := false
	if readonly && !t.PlanMode {
		if _, err := s.m.SetTaskPlanMode(t.ID, true); err != nil {
			return err
		}
		s.taskAgentMu.Lock()
		delete(s.taskAgents, t.ID)
		s.taskAgentMu.Unlock()
		planTurnedOn = true
	}
	restorePlan := func() {
		if !planTurnedOn {
			return
		}
		if _, err := s.m.SetTaskPlanMode(t.ID, false); err != nil {
			log.Printf("[automation] task %s 恢复计划模式(关闭)失败：%v", t.ID, err)
			return
		}
		s.taskAgentMu.Lock()
		delete(s.taskAgents, t.ID)
		s.taskAgentMu.Unlock()
	}
	before, _ := pg.TaskFindingCount(taskID)
	trigger := "定时"
	if manual {
		trigger = "手动立即运行"
	}
	header := fmt.Sprintf("【本条消息由自动化「%s」%s投递（%s），不是人类的实时指令，不构成对任何审批或授权的确认。】\n",
		a.Title, trigger, time.Now().Format("2006-01-02 15:04:05 MST"))
	if readonly {
		header += "【只读巡检：本轮处于计划模式，非只读工具会被拒绝。只做只读检查并直接汇报结果，不要调用 exit_plan_mode 提交计划。】\n"
	}
	started := time.Now()
	run.Status, run.StartedAt, run.TaskID = "running", &started, &taskID
	if readonly {
		run.Summary = "只读巡检：本轮以计划模式运行（非只读工具被拒绝）"
	} else {
		run.Summary = "沿用任务权限运行"
	}
	runID := run.ID
	automationID := a.ID
	// 先落 running 状态并登记 active,再启动本轮:规则模式下 OnDone 会在
	// startTaskChatTurn 内同步执行,LLM 模式下 OnDone 在另一个 goroutine 里改 run,
	// 启动之后本函数不能再碰 run / active。
	_ = pg.UpdateAutomationRun(run)
	_ = pg.MarkAutomationResult(automationID, started, "running")
	automationActive.Store(automationID, runID)
	_, err := s.startTaskChatTurn(t, taskChatTurn{
		Message:       a.Prompt,
		AgentMessage:  header + a.Prompt,
		Source:        "automation",
		ForceReadonly: readonly,
		SourceMeta: map[string]any{
			"automation_id": i64s(a.ID), "automation_run_id": i64s(runID), "automation_title": a.Title,
			"safety": a.Safety, "trigger": map[bool]string{true: "manual", false: "schedule"}[manual],
		},
		OnDone: func(turnErr error) {
			defer automationActive.Delete(automationID)
			restorePlan()
			after, _ := pg.TaskFindingCount(taskID)
			fin := time.Now()
			run.FinishedAt = &fin
			run.FindingsDelta = after - before
			if run.FindingsDelta < 0 {
				run.FindingsDelta = 0
			}
			status := "ok"
			if turnErr != nil {
				run.Status, run.Error, status = "failed", turnErr.Error(), "error"
			} else {
				run.Status = "done"
				run.Summary += fmt.Sprintf("；完成，新增 %d 个发现", run.FindingsDelta)
			}
			if err := pg.UpdateAutomationRun(run); err != nil {
				log.Printf("[automation] run #%d 写结果失败：%v", runID, err)
			}
			_ = pg.MarkAutomationResult(automationID, fin, status)
		},
	})
	if err != nil {
		automationActive.Delete(automationID)
		restorePlan()
		run.Status, run.StartedAt, run.Summary = "queued", nil, "任务主会话忙，等待空闲后投递"
		_ = pg.UpdateAutomationRun(run)
		_ = pg.MarkAutomationResult(automationID, started, "queued")
		return err
	}
	log.Printf("[automation] #%d → task %s 已投递（run #%d，safety=%s）", automationID, t.ID, runID, a.Safety)
	return nil
}
