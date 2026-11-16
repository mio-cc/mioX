package db

import (
	"encoding/json"
	"strings"
)

// 本文件是「本轮改动文件卡」的数据来源。规则抄自 DSH
// `ui-deliverables/src/client/turn-deliverables.ts:1-7`：
//
//	produced paths come from successful first-party mutation calls and their
//	recorded file targets … never from presentation data or the closing prose.
//
// 也就是说：改动文件只能由**记录下来的工具调用**推出，绝不能解析模型回复文本。
// 这里据此只认 Write / Edit / MultiEdit 三个第一方改写工具的 file_path 参数，
// 并要求该调用有**成功的 tool_result**（失败调用不算改动）。

// TurnFileCall 是一次已结算的改写调用。Seq 是记录该调用的 tool_use 活动 id，
// 客户端据此按需读取参数 JSON（detail）渲染该文件的 diff。
type TurnFileCall struct {
	Seq int64  `json:"seq"`
	Op  string `json:"op"`
}

// TurnFile 是一个回合内被改写的一个文件。
type TurnFile struct {
	Path  string         `json:"path"`
	Ops   []string       `json:"ops"`   // 去重、按首次出现排序：write / edit
	Count int            `json:"count"` // 该文件的改写调用次数
	Calls []TurnFileCall `json:"calls"`
}

// TurnFileGroup 是一个回合的改动文件集合。End 是收尾该回合的 result 活动 id；
// 0 表示这一回合还在进行（尚无 result 行）。
type TurnFileGroup struct {
	End   int64      `json:"end"`
	Files []TurnFile `json:"files"`
}

// mutationOp 是唯一被认可的第一方文件改写工具表。Bash / Read / Grep 等一律不在表内：
// 只有「参数本身就是一次完整写入/替换」的调用才算改动，shell 里的重定向或 rm 不会
// 被误报成改了文件。
var mutationOp = map[string]string{
	"Write":     "write",
	"Edit":      "edit",
	"MultiEdit": "edit",
}

// TurnFileRows 读取推导一个主会话分段（main_seg）逐回合改动文件所需的行：回合边界
// （result）与文件改写调用（tool_use / tool_result）。thinking、usage、读类工具行
// 根本不进结果集，所以载荷只与改写量成正比，不随会话长度膨胀。
//
// seg=0 同时覆盖早期没有 main_seg 的遗留行（与 ActivitySessionFilter.cond 一致）。
func (s *ExplorationStore) TurnFileRows(seg int) ([]Activity, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(kind,''), COALESCE(tool,''), COALESCE(tool_use_id,''), is_error, COALESCE(detail,'')
FROM activity
WHERE exploration_id=$1 AND worker='mainagent' AND COALESCE(main_seg,0)=$2
  AND (kind='result' OR (kind IN ('tool_use','tool_result') AND tool IN ('Write','Edit','MultiEdit')))
ORDER BY id`, s.expID, seg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.Kind, &a.Tool, &a.ToolUseID, &a.IsError, &a.Detail); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// DeriveTurnFiles 把 TurnFileRows 的行序列按回合切分并聚合成改动文件。
//
// 回合边界是 kind='result' 行（主 Agent 每轮结束时写入），一个回合从上一个 result
// 之后开始。只有「tool_use 有参数、且配对的 tool_result 不是错误」的改写调用才计入，
// 因此：失败/被拒的写入不算、参数不完整（没有 content / old_string 为空）的调用不算、
// 非改写工具不算。路径保持工具收到的原始写法（相对路径不在这里展开——那是 agent 的
// 工作目录语义），同一路径在回合内只出现一次，ops 去重。
func DeriveTurnFiles(rows []Activity) []TurnFileGroup {
	type pendingCall struct {
		op   string
		path string
		seq  int64
	}
	pending := map[string]pendingCall{}
	groups := []TurnFileGroup{}
	open := TurnFileGroup{Files: []TurnFile{}}
	index := map[string]int{}
	reset := func() {
		open = TurnFileGroup{Files: []TurnFile{}}
		index = map[string]int{}
	}
	for _, row := range rows {
		switch row.Kind {
		case "result":
			open.End = row.ID
			groups = append(groups, open)
			reset()
		case "tool_use":
			if op, path, ok := mutationTarget(row.Tool, row.Detail); ok {
				pending[row.ToolUseID] = pendingCall{op: op, path: path, seq: row.ID}
			}
		case "tool_result":
			call, ok := pending[row.ToolUseID]
			if !ok {
				continue
			}
			delete(pending, row.ToolUseID) // 一次调用只结算一次
			if row.IsError {
				continue // 失败的结果不产生改动（DSH turn-deliverables.ts:211）
			}
			at, seen := index[call.path]
			if !seen {
				at = len(open.Files)
				index[call.path] = at
				open.Files = append(open.Files, TurnFile{Path: call.path, Ops: []string{call.op}, Calls: []TurnFileCall{}})
			}
			file := &open.Files[at]
			file.Count++
			file.Calls = append(file.Calls, TurnFileCall{Seq: call.seq, Op: call.op})
			if !hasOp(file.Ops, call.op) {
				file.Ops = append(file.Ops, call.op)
			}
		}
	}
	if len(open.Files) > 0 {
		groups = append(groups, open) // 还在进行中的回合，End=0
	}
	return groups
}

// hasOp 报告 ops 里是否已有该操作（保持首次出现顺序）。
func hasOp(ops []string, op string) bool {
	for _, existing := range ops {
		if existing == op {
			return true
		}
	}
	return false
}

// mutationTarget 从一次调用的记录参数里取出「操作名 + 目标路径」，参数不是一次
// 完整改写时返回 ok=false。判据逐条对应 DSH turn-deliverables.ts:60-112：
// write 必须有 content，edit 必须有非空且真正变化的 old_string/new_string，
// 多段编辑必须每一段都带非空 old_string。
func mutationTarget(tool, detail string) (op, path string, ok bool) {
	op, supported := mutationOp[tool]
	if !supported {
		return "", "", false
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(detail), &args); err != nil {
		return "", "", false
	}
	path, ok = pathValue(args["file_path"])
	if !ok {
		return "", "", false
	}
	switch tool {
	case "Write":
		if _, ok := stringValue(args["content"]); !ok {
			return "", "", false
		}
	case "Edit":
		if !validEditArgs(args) {
			return "", "", false
		}
	case "MultiEdit":
		if !validMultiEditArgs(args) {
			return "", "", false
		}
	}
	return op, path, true
}

// validEditArgs 校验 Edit 的参数（DSH turn-deliverables.ts:81-87）。
func validEditArgs(args map[string]any) bool {
	oldText, ok := stringValue(args["old_string"])
	if !ok || oldText == "" {
		return false
	}
	newText, ok := stringValue(args["new_string"])
	if !ok || oldText == newText {
		return false
	}
	if raw, present := args["replace_all"]; present {
		if _, ok := raw.(bool); !ok {
			return false
		}
	}
	return true
}

// validMultiEditArgs 校验 MultiEdit：至少一段编辑，且每段都有非空 old_string 与
// new_string（多段编辑要么全生效要么全不生效，缺一段就不是一次完整改写）。
func validMultiEditArgs(args map[string]any) bool {
	raw, present := args["edits"]
	if !present {
		return false
	}
	edits, ok := raw.([]any)
	if !ok || len(edits) == 0 {
		return false
	}
	for _, entry := range edits {
		edit, ok := entry.(map[string]any)
		if !ok {
			return false
		}
		oldText, ok := stringValue(edit["old_string"])
		if !ok || oldText == "" {
			return false
		}
		if _, ok := stringValue(edit["new_string"]); !ok {
			return false
		}
	}
	return true
}

// pathValue 只接受非空白字符串，并保留工具收到的原始写法。
func pathValue(value any) (string, bool) {
	text, ok := stringValue(value)
	if !ok || strings.TrimSpace(text) == "" {
		return "", false
	}
	return text, true
}

// stringValue 取出字符串字段（空串也算有值——Write 可以写空文件）。
func stringValue(value any) (string, bool) {
	text, ok := value.(string)
	return text, ok
}
