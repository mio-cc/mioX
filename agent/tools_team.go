package agent

import (
	"context"
	"encoding/json"
	"fmt"

	actool "github.com/Autumn-27/norma/tool"

	"github.com/Autumn-27/artex/db"
)

// Team board tools: the agent-facing side of the shared task list the UI renders.
//
// The board is per task, so every tool resolves the task from the ToolSet rather than
// asking the model to pass it. Every handler reuses the existing store methods
// (db.CreateTeamTask / ListTeamTasks / ClaimTeamTask / CompleteTeamTask) — the board
// has exactly one write path, shared with the HTTP API the UI uses.
//
// Capability gate (not a runtime error): the four tools are only *registered* on a
// session whose tasks.team_mode is on — see ToolSet.TeamTools. DSH treats the switch
// as a session-owned capability selection ("Session-owned Agent Teams selection in the
// model and reasoning menu", TeamModeToggle.tsx:1) and renders the board only while
// that selection is enabled (`if (!team?.enabled) return null`, TeamBoard.tsx:86). An
// ungranted session therefore never sees the tools at all, which is the same shape as
// plan mode's exit_plan_mode being disclosed only while plan mode is active.

// SetDB attaches the database handle used by the team-board tools.
func (t *ToolSet) SetDB(handle *db.DB) { t.db = handle }

func (t *ToolSet) teamStore() *db.DB {
	if t.db != nil {
		return t.db
	}
	if t.ts != nil {
		return t.ts.DB()
	}
	return nil
}

// TeamTools returns the shared-board tools for a session that holds the team
// capability, or nil when team_mode is off (see ToolSet.SetTeamMode). nil (rather than
// erroring tools) is the point: DSH grants capabilities, it does not advertise a tool
// that always fails.
func (t *ToolSet) TeamTools() []actool.CoreTool {
	if !t.teamMode {
		return nil
	}
	return []actool.CoreTool{t.teamAdd(), t.teamList(), t.teamClaim(), t.teamComplete()}
}

// teamStep is one row's input, accepted both as the top-level single-step shape
// (subject/detail/depends_on) and as an element of the batch shape (items).
type teamStep struct {
	Subject   string  `json:"subject"`
	Detail    string  `json:"detail"`
	DependsOn []int64 `json:"depends_on"`
}

// teamAdd appends one row (or a whole decomposition, via items) to the shared board.
func (t *ToolSet) teamAdd() actool.CoreTool {
	return t.writeExpTool("team_add",
		"把一个可执行步骤写进团队任务板（UI「团队」标签可见，其他 agent 可认领）。拆两步就调两次，或用 items 一次写多条；depends_on 传已有/本批前一条的 id 表示前置依赖。",
		obj(map[string]any{
			"subject": str("这一步要做什么（简短、可执行）"),
			"detail":  str("可选：执行要点、验收标准"),
			"depends_on": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "integer"},
				"description": "可选：前置任务 id 列表（它们完成后本行才 ready）",
			},
			"items": map[string]any{
				"type":        "array",
				"description": "可选：一次拆多步时传数组，按顺序创建（同批次内可用 depends_on 引用前面刚建的 id）。",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"subject":    str("子任务标题（简短、可执行）"),
						"detail":     str("可选：执行要点、验收标准"),
						"depends_on": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": "可选：前置任务 id 列表"},
					},
					"required": []string{"subject"},
				},
			},
		}),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			var args struct {
				teamStep
				Items []teamStep `json:"items"`
			}
			if err := json.Unmarshal(in, &args); err != nil {
				return actool.Errorf(fmt.Sprintf("参数解析失败: %v", err)), nil
			}
			// Two accepted shapes: one step (subject) or a batch (items). Both are the
			// same store call per row, so there is no second write path.
			steps := args.Items
			if len(steps) == 0 && args.Subject != "" {
				steps = append(steps, args.teamStep)
			}
			if len(steps) == 0 {
				return actool.Errorf("subject 不能为空（拆多步时传 items）"), nil
			}
			if len(steps) > db.MaxTeamTaskBatch {
				return actool.Errorf(fmt.Sprintf("一次最多写入 %d 条", db.MaxTeamTaskBatch)), nil
			}
			created := make([]*db.TeamTask, 0, len(steps))
			for _, item := range steps {
				row, err := store.CreateTeamTask(t.taskID, item.Subject, item.Detail, item.DependsOn)
				if err != nil {
					return actool.Errorf(fmt.Sprintf("写入第 %d 条失败: %v", len(created)+1, err)), nil
				}
				created = append(created, row)
			}
			return jsonResult(map[string]any{"created": created, "count": len(created)})
		})
}

// teamList shows the board so any role can see what is left.
func (t *ToolSet) teamList() actool.CoreTool {
	return t.readExpTool("team_list",
		"列出本任务的团队任务板（状态、负责人、依赖、是否就绪）。认领前先用它找 ready=true 的条目。",
		obj(map[string]any{
			"status": map[string]any{
				"type":        "string",
				"enum":        []string{db.TeamTaskStatusPending, db.TeamTaskStatusInProgress, db.TeamTaskStatusCompleted},
				"description": "可选：只看某个状态",
			},
		}),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			var args struct {
				Status string `json:"status"`
			}
			if len(in) > 0 {
				if err := json.Unmarshal(in, &args); err != nil {
					return actool.Errorf(fmt.Sprintf("参数解析失败: %v", err)), nil
				}
			}
			items, err := store.ListTeamTasks(t.taskID)
			if err != nil {
				return actool.Errorf(fmt.Sprintf("读取团队任务板失败: %v", err)), nil
			}
			// progress always describes the WHOLE board (it is the header summary the UI
			// renders); the status filter only narrows the row list.
			progress := db.TeamTaskProgress(items)
			shown := items
			if args.Status != "" {
				shown = make([]*db.TeamTask, 0, len(items))
				for _, item := range items {
					if item.Status == args.Status {
						shown = append(shown, item)
					}
				}
			}
			return jsonResult(map[string]any{
				"tasks":    shown,
				"count":    len(shown),
				"progress": progress,
			})
		})
}

// teamClaim takes a ready row for this agent.
func (t *ToolSet) teamClaim() actool.CoreTool {
	return t.writeExpTool("team_claim",
		"认领团队任务板上一项 ready=true 的任务（pending → in_progress，负责人记为本 agent）。被依赖阻塞的条目会被拒绝。",
		obj(map[string]any{
			"id": idp("团队任务 id（来自 team_list）"),
		}, "id"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			var args struct {
				ID json.RawMessage `json:"id"`
			}
			if err := json.Unmarshal(in, &args); err != nil {
				return actool.Errorf(fmt.Sprintf("参数解析失败: %v", err)), nil
			}
			id := pid(args.ID)
			if id == 0 {
				return actool.Errorf("id 必填"), nil
			}
			owner := t.worker
			if owner == "" {
				owner = "agent"
			}
			row, err := store.ClaimTeamTask(id, owner)
			if err != nil {
				return actool.Errorf(fmt.Sprintf("认领失败: %v", err)), nil
			}
			return jsonResult(row)
		})
}

// teamComplete closes a row once the work is done.
func (t *ToolSet) teamComplete() actool.CoreTool {
	return t.writeExpTool("team_complete",
		"把团队任务板上的一条标记为已完成（完成后依赖它的任务才会变为 ready）。detail 可选：本次完成说明，会随结果回显。",
		obj(map[string]any{
			"id":     idp("团队任务 id"),
			"detail": str("可选：完成说明/结论"),
		}, "id"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			var args struct {
				ID     json.RawMessage `json:"id"`
				Detail string          `json:"detail"`
			}
			if err := json.Unmarshal(in, &args); err != nil {
				return actool.Errorf(fmt.Sprintf("参数解析失败: %v", err)), nil
			}
			id := pid(args.ID)
			if id == 0 {
				return actool.Errorf("id 必填"), nil
			}
			row, err := store.CompleteTeamTask(id)
			if err != nil {
				return actool.Errorf(fmt.Sprintf("完成失败: %v", err)), nil
			}
			// detail is echoed, not persisted: the reused store method only flips
			// status/completed_at (db.CompleteTeamTask), and adding a column write here
			// would be a second write path to the board.
			out := map[string]any{"task": row}
			if detail := args.Detail; detail != "" {
				out["detail"] = detail
			}
			return jsonResult(out)
		})
}
