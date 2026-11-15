package agent

// 计划模式（plan mode）——按 DSH @deepseek-ai/dsh-plan-mode 的真实模型实现。
//
// DSH 源码事实（已从 D:\dsh\resources\app.asar 抽到 项目分析\dsh-src\，
// 文件名 dsh__node_modules__@deepseek-ai__dsh-plan-mode__src__index.ts；
// 客户端部分在 项目分析\dsh-src\ 的 ui-plan 包）：
//   - plan-mode/src/index.ts:64  `export const EXIT_PLAN_MODE = 'exit_plan_mode'`
//     —— 计划是模型通过这个工具提交的结构化产物，不是"模型不能干活"。
//   - plan-mode/src/index.ts:81-84 EXIT_DESCRIPTION：只在计划模式可用；把计划交给用户
//     审阅；批准后从下一步开始执行，用户也可能让你继续规划（反馈回到 tool result）。
//   - plan-mode/src/index.ts:283-285 参数 `{ plan: { type:'string', required:true } }`，
//     描述是 "The complete plan, as markdown, starting with a # heading that names it."
//   - plan-mode/src/index.ts:307-309 校验 `!/^#\s+\S/.test(args.plan.trim())` →
//     抛错要求重写（plan 非空且首行就是一级标题）。
//   - plan-mode/src/index.ts:304-306 不在计划模式里调用 → 抛错
//     "exit_plan_mode is only available in plan mode"。
//   - plan-mode/src/index.ts:375 工具注册带 `when: selectedActive || entered`：
//     只在计划模式披露，其余时候模型根本看不到它。
//   - plan-mode/src/index.ts:340 `exec.concludeTurn()`：计划审阅（这里是"提交"）之后
//     本轮直接结束，不再发下一次模型请求。
//   - plan-mode/README.md:32 「It does not restrict the agent: every tool stays
//     callable」/ README.md:81 「restrains through text rather than filtering
//     capabilities」：计划模式是**软约束**——一段系统提示 + 一个工具，工具一个都不摘。
//
// 本文件对应关系：
//   exitPlanMode()  → 上面那个工具（名字/入参/校验/标题规则逐条对齐 DSH）；
//   planTurn        → 本轮是否已提交计划（DSH concludeTurn 之后本轮不再有模型请求）；
//   planGateHooks   → 把 concludeTurn 落到本仓库的 loop 上：提交后本轮不再执行任何工具。
//   计划落库        → 一条 kind="plan" 的 activity（对应 DSH 的 submitted-plan 聊天节点，
//                     plan-definition.ts:15-33：每次提交生成一个聊天节点，不是任务字段）。

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"sync"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/norma/harness"
	"github.com/Autumn-27/norma/llm"
	acperm "github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
)

// exitPlanModeName 是 DSH 的模型可调用工具名（index.ts:64），保持 snake_case 原样。
const exitPlanModeName = "exit_plan_mode"

// exitPlanModeHeading 取计划的首个一级标题当卡片标题：DSH ui-plan/plan.ts:47
// `/^#\s+(\S[^\r\n]*)/.exec(markdown.trim())`。校验用同一形状（DSH index.ts:307
// 的 `/^#\s+\S/`）：plan 非空、且 trim 后首行就是 `# 标题`。
var exitPlanModeHeading = regexp.MustCompile(`^#\s+(\S[^\r\n]*)`)

// planTitle 返回计划的标题；没有一级标题时返回空串（DSH 的 submittedPlan 在这种情况下
// 返回 undefined —— 那份文本不算一份可展示的计划）。
func planTitle(markdown string) string {
	m := exitPlanModeHeading.FindStringSubmatch(strings.TrimSpace(markdown))
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// planTurn 是本轮（一次 Chat = 一个回合）的计划模式状态，由 exit_plan_mode 与
// planGateHooks 共享。MainAgent 每轮新建一个 Session，所以它天然是按轮隔离的。
type planTurn struct {
	mu        sync.Mutex
	submitted bool
	title     string
}

// markSubmitted 记录本轮已提交计划（DSH index.ts:361 之后本轮不再推进）。
func (p *planTurn) markSubmitted(title string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.submitted = true
	p.title = title
}

// submittedPlan 报告本轮是否已提交计划，以及标题。
func (p *planTurn) submittedPlan() (bool, string) {
	if p == nil {
		return false, ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.submitted, p.title
}

// planGateHooks 是 harness.HookRunner 的包装：计划一旦提交，本轮后续任何工具调用都被
// 拦下，模型只能收尾回话——把 DSH 的 `exec.concludeTurn()`（index.ts:340，提交/审阅后
// 本轮直接结束、不再发模型请求）落到本仓库的 loop 上（loop 没有 concludeTurn，只有
// PreToolUse 能确定性地掐断后续动作，见 harness/tools.go:77-83）。
// 其余钩子原样委托给任务原有的 guard（可能为 nil）。
type planGateHooks struct {
	inner harness.HookRunner
	turn  *planTurn
}

func (h *planGateHooks) PreToolUse(ctx context.Context, name string, input []byte) (bool, string, []byte) {
	if submitted, _ := h.turn.submittedPlan(); submitted {
		return true, "计划已提交，本轮结束：等待用户审阅/批准后再执行（批准后会退出计划模式）。不要继续调用工具，用一句话告诉用户计划已提交。", nil
	}
	if h.inner == nil {
		return false, "", nil
	}
	return h.inner.PreToolUse(ctx, name, input)
}

func (h *planGateHooks) PostToolUse(ctx context.Context, name string, input, result []byte, isErr bool) {
	if h.inner != nil {
		h.inner.PostToolUse(ctx, name, input, result, isErr)
	}
}

func (h *planGateHooks) Stop(ctx context.Context, messages []llm.Message) (bool, []string, string) {
	if h.inner == nil {
		return false, nil, ""
	}
	return h.inner.Stop(ctx, messages)
}

// exitPlanMode 是计划模式的退出/提交工具（DSH index.ts:280-376 的对齐实现）：
// 入参 `{ "plan": "<markdown>" }`，校验非空 + 首行 `# 标题`，把计划落成一条
// kind="plan" 的 activity（= DSH 的 submitted-plan 聊天节点），然后本轮结束等审批。
func (t *ToolSet) exitPlanMode() actool.CoreTool {
	return actool.Build(actool.Spec{
		Name: exitPlanModeName,
		Description: "只在计划模式下可用。把已经写好的完整计划提交给用户审阅；提交成功后本轮结束，" +
			"等待用户批准（批准后会退出计划模式，你再开始执行）。用户也可能让你继续修改计划。" +
			"调用前先用只读手段把情况侦察清楚。",
		Prompt: "plan 必须是完整的 Markdown，且首行是一级标题（例如 `# 测试计划`）；" +
			"写清目标、步骤（每步做什么/用哪个工具/预期结果）、风险与回滚、需要人工确认的点。",
		Schema: obj(map[string]any{
			"plan": str("完整的计划正文（Markdown），首行必须是一级标题 `# 标题`。"),
		}, "plan"),
		// 对权限而言是只读（计划模式里必须允许调用，DSH index.ts:112 同理）；
		// 但它会写一条 activity 并结束本轮，所以不并发安全（DSH index.ts:113）。
		ReadOnly:   func(json.RawMessage) bool { return true },
		Concurrent: func(json.RawMessage) bool { return false },
		Permissions: func(context.Context, json.RawMessage, acperm.Context) acperm.Decision {
			return acperm.Allowed()
		},
		Run: func(ctx context.Context, in json.RawMessage, tc *actool.ToolContext) (actool.Result, error) {
			// DSH index.ts:304-306：不在计划模式调用 → 报错。
			if !t.planMode {
				return actool.Errorf(exitPlanModeName + " 只在计划模式下可用（当前不是计划模式，直接执行即可）。"), nil
			}
			var args struct {
				Plan string `json:"plan"`
			}
			if err := json.Unmarshal(in, &args); err != nil {
				return actool.Errorf(exitPlanModeName + " 的参数不是合法 JSON：" + err.Error() +
					`。请用 {"plan": "<markdown，首行 # 标题>"} 重试。`), nil
			}
			// DSH index.ts:307-309：plan 非空 + trim 后首行是 `# 标题`，否则让模型重写。
			plan := strings.TrimSpace(args.Plan)
			if plan == "" || !exitPlanModeHeading.MatchString(plan) {
				return actool.Errorf("计划未通过校验：plan 不能为空，且首行必须是一级标题（例如 `# 测试计划`）。" +
					"请补上标题、整理成完整 Markdown 后重新调用 " + exitPlanModeName + "。"), nil
			}
			title := planTitle(plan)
			callID := ""
			if tc != nil {
				callID = tc.ToolUseID
			}
			// 没有落库通道就不能假装提交成功：DSH 在没有审阅通道时也是 fail closed
			// （README.md:63「If no interactive review is available, exit_plan_mode
			// cannot run」、index.ts:310-313 抛错）。否则用户永远看不到这份计划。
			if t.planEmit == nil {
				return actool.Errorf(exitPlanModeName + " 当前没有可用的计划通道（会话未接线），计划没有保存。请直接用文字把计划回复给用户。"), nil
			}
			// 落库：一条 kind="plan" 的 activity，detail=完整 Markdown，summary=标题，
			// metadata 带 tool_use_id（DSH 用 callId 标识一份计划：plan.ts:14-16、plan-definition.ts:20）。
			meta, err := json.Marshal(map[string]any{"title": title, "tool_use_id": callID})
			if err != nil {
				meta = json.RawMessage(`{}`)
			}
			t.planEmit(db.Activity{
				Kind: "plan", Tool: exitPlanModeName, ToolUseID: callID,
				Summary: title, Detail: plan, Metadata: meta,
			})
			t.planTurn.markSubmitted(title)
			return actool.Text("计划已提交，等待审批。本轮到此结束：不要再调用任何工具，用一句话告诉用户计划已提交、请先审阅；" +
				"用户批准（退出计划模式）后你再开始执行。"), nil
		},
	})
}
