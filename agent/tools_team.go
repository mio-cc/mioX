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
// planner writes rows (decomposition), workers claim and close them. The board is
// per task, so every tool resolves the task from the ToolSet rather than asking
// the model to pass it.

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

// teamBoardWrite lets the planner publish a decomposed plan to the shared board.
func (t *ToolSet) teamBoardWrite() actool.CoreTool {
	return t.writeExpTool("team_board_write",
		"把拆解后的子任务写进团队任务板（UI「团队」标签可见，worker 可认领）。一次可写多条；depends_on 传本批次或已有任务的 id 表示前置依赖。",
		obj(map[string]any{
			"items": map[string]any{
				"type":        "array",
				"description": "要写入的子任务数组，按顺序创建（同批次内可用 depends_on 引用前面的 id）。",
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
		}, "items"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			var args struct {
				Items []struct {
					Subject   string  `json:"subject"`
					Detail    string  `json:"detail"`
					DependsOn []int64 `json:"depends_on"`
				} `json:"items"`
			}
			if err := json.Unmarshal(in, &args); err != nil {
				return actool.Errorf(fmt.Sprintf("参数解析失败: %v", err)), nil
			}
			if len(args.Items) == 0 {
				return actool.Errorf("items 不能为空"), nil
			}
			if len(args.Items) > db.MaxTeamTaskBatch {
				return actool.Errorf(fmt.Sprintf("一次最多写入 %d 条", db.MaxTeamTaskBatch)), nil
			}
			created := make([]*db.TeamTask, 0, len(args.Items))
			for _, item := range args.Items {
				row, err := store.CreateTeamTask(t.taskID, item.Subject, item.Detail, item.DependsOn)
				if err != nil {
					return actool.Errorf(fmt.Sprintf("写入第 %d 条失败: %v", len(created)+1, err)), nil
				}
				created = append(created, row)
			}
			return jsonResult(map[string]any{"created": created, "count": len(created)})
		})
}

// teamBoardList shows the board so any role can see what is left.
func (t *ToolSet) teamBoardList() actool.CoreTool {
	return t.readExpTool("team_board_list",
		"列出本任务的团队任务板（状态、负责人、是否就绪）。认领前先用它找 ready=true 的条目。",
		obj(map[string]any{}),
		func(context.Context, json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			items, err := store.ListTeamTasks(t.taskID)
			if err != nil {
				return actool.Errorf(fmt.Sprintf("读取团队任务板失败: %v", err)), nil
			}
			return jsonResult(map[string]any{
				"tasks":    items,
				"progress": db.TeamTaskProgress(items),
			})
		})
}

// teamBoardClaim takes a ready row for this worker.
func (t *ToolSet) teamBoardClaim() actool.CoreTool {
	return t.writeExpTool("team_board_claim",
		"认领团队任务板上一项 ready=true 的任务。被依赖阻塞的条目会被拒绝；认领后负责人记为本 agent 角色。",
		obj(map[string]any{
			"id": idp("团队任务 id（来自 team_board_list）"),
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

// teamBoardComplete closes a row once the work is done.
func (t *ToolSet) teamBoardComplete() actool.CoreTool {
	return t.writeExpTool("team_board_complete",
		"把团队任务板上的一条标记为已完成（完成后依赖它的任务才会变为 ready）。",
		obj(map[string]any{
			"id":     idp("团队任务 id"),
			"result": str("可选：完成说明/结论，便于后续任务参考"),
		}, "id"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.teamStore()
			if store == nil || t.taskID == 0 {
				return actool.Errorf("团队任务板不可用（缺少任务上下文）"), nil
			}
			var args struct {
				ID     json.RawMessage `json:"id"`
				Result string          `json:"result"`
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
			return jsonResult(row)
		})
}
