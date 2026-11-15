package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	actool "github.com/Autumn-27/norma/tool"

	"github.com/Autumn-27/artex/db"
)

// Memory tools: the agent-facing side of the cross-task memory store.
//
// Why separate from the exploration graph: a lesson learned in task A must be
// recallable in task B, and an operator must be able to rewrite a bad entry without
// touching a live transcript. The graph is per-task and append-only; memory is global
// and mutable.

// memoryStore resolves the database handle, tolerating a ToolSet without an exploration.
func (t *ToolSet) memoryStore() *db.DB {
	if t.db != nil {
		return t.db
	}
	if t.ts != nil {
		return t.ts.DB()
	}
	return nil
}

// memoryWrite stores one durable note.
func (t *ToolSet) memoryWrite() actool.CoreTool {
	return writeTool("memory_write",
		"把值得跨任务复用的结论写进长期记忆：有效手法、无效路径、目标特征、经验教训。写之前先 memory_search 查重，避免重复条目。",
		obj(map[string]any{
			"title": map[string]any{"type": "string", "description": "一句话标题，便于检索"},
			"content": map[string]any{
				"type":        "string",
				"description": "正文：写清做了什么、结果如何、为什么值得复用",
			},
			"kind": map[string]any{
				"type":        "string",
				"enum":        []string{db.MemoryNote, db.MemoryLesson, db.MemoryTechnique, db.MemoryTarget},
				"description": "note=普通记录，lesson=教训，technique=有效手法，target=目标特征",
			},
			"tags": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"description": "可选标签，便于按类检索",
			},
			"scope": map[string]any{
				"type":        "string",
				"enum":        []string{"global", "task"},
				"description": "global=跨任务可见（默认）；task=只属于当前任务",
			},
		}, "title", "content"),
		func(ctx context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.memoryStore()
			if store == nil {
				return actool.Errorf("memory_write 需要数据库连接，当前不可用"), nil
			}
			var req struct {
				Title   string   `json:"title"`
				Content string   `json:"content"`
				Kind    string   `json:"kind"`
				Tags    []string `json:"tags"`
				Scope   string   `json:"scope"`
			}
			if err := json.Unmarshal(in, &req); err != nil {
				return actool.Errorf("参数解析失败: " + err.Error()), nil
			}
			if strings.TrimSpace(req.Content) == "" {
				return actool.Errorf("content 不能为空"), nil
			}
			m := db.Memory{
				Scope: req.Scope, Kind: req.Kind, Title: req.Title,
				Content: req.Content, Tags: req.Tags,
			}
			if m.Scope == "" {
				m.Scope = "global"
			}
			if m.Scope == "task" {
				m.TaskID = fmt.Sprintf("%d", t.taskID)
			}
			saved, err := store.CreateMemory(m)
			if err != nil {
				return actool.Errorf("写入记忆失败: " + err.Error()), nil
			}
			return jsonResult(map[string]any{"id": saved.ID, "kind": saved.Kind, "scope": saved.Scope})
		})
}

// memorySearch recalls entries by text / kind / tag.
func (t *ToolSet) memorySearch() actool.CoreTool {
	return writeTool("memory_search",
		"检索长期记忆（跨任务）。开工前先搜一次，避免重复踩坑；检索命中会累加引用计数，便于以后清理冷条目。",
		obj(map[string]any{
			"query": map[string]any{"type": "string", "description": "关键词，匹配标题与正文"},
			"kind": map[string]any{
				"type": "string",
				"enum": []string{db.MemoryNote, db.MemoryLesson, db.MemoryTechnique, db.MemoryTarget},
			},
			"tag":   map[string]any{"type": "string", "description": "按标签过滤"},
			"limit": map[string]any{"type": "number", "description": "返回条数，默认 20"},
		}, "query"),
		func(ctx context.Context, in json.RawMessage) (actool.Result, error) {
			store := t.memoryStore()
			if store == nil {
				return actool.Errorf("memory_search 需要数据库连接，当前不可用"), nil
			}
			var req struct {
				Query string `json:"query"`
				Kind  string `json:"kind"`
				Tag   string `json:"tag"`
				Limit int    `json:"limit"`
			}
			if err := json.Unmarshal(in, &req); err != nil {
				return actool.Errorf("参数解析失败: " + err.Error()), nil
			}
			items, err := store.ListMemories(db.MemoryQuery{
				Text: req.Query, Kind: req.Kind, Tag: req.Tag, Limit: req.Limit,
			})
			if err != nil {
				return actool.Errorf("检索记忆失败: " + err.Error()), nil
			}
			ids := make([]int64, 0, len(items))
			for _, item := range items {
				ids = append(ids, item.ID)
			}
			_ = store.TouchMemories(ids)
			if len(items) == 0 {
				return actool.Text("（没有匹配的记忆）"), nil
			}
			var b strings.Builder
			for _, item := range items {
				fmt.Fprintf(&b, "#%d [%s] %s\n%s\n", item.ID, item.Kind, item.Title, item.Content)
				if len(item.Tags) > 0 {
					fmt.Fprintf(&b, "tags: %s\n", strings.Join(item.Tags, ", "))
				}
				b.WriteString("\n")
			}
			return actool.Text(b.String()), nil
		})
}
