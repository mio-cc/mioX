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
//   - plan-mode/src/index.ts:310-333 审阅是**当场提问**（不是"落库后结束本轮"）：
//     `userQuestions.ask({ questions:[{ header:'Plan review',
//      question:'Approve this plan and leave plan mode?', detail: args.plan, options:[
//      APPROVE_LABEL / KEEP_PLANNING_LABEL ] }] })` —— detail 就是完整 markdown 计划。
//   - plan-mode/src/index.ts:339-341 用户取消/关闭提问（ASK_CANCELLED）→
//     `exec.concludeTurn()` + `return { approved:false }`：本轮结束，不再发模型请求。
//   - plan-mode/src/index.ts:352-357 不是选 Approve → **抛错**把反馈带回模型：
//     "The user chose to keep planning; revise the plan and present it again."
//     （带反馈时 "The user chose to keep planning; their feedback: <feedback>"）。
//   - plan-mode/src/index.ts:358-362 选 Approve → 计划模式退出（active=false），
//     下一步开始执行计划。
//   - plan-mode/README.md:32 「It does not restrict the agent: every tool stays
//     callable」/ README.md:81 「restrains through text rather than filtering
//     capabilities」：计划模式是**软约束**——一段系统提示 + 一个工具，工具一个都不摘。
//
// 本文件对应关系：
//   exitPlanMode()  → 上面那个工具（名字/入参/校验/标题规则/审阅闭环逐条对齐 DSH）；
//   planTurn        → 本轮的计划状态（open / approved / concluded）；
//   planGateHooks   → 把 concludeTurn 落到本仓库的 loop 上（ConcludeTurn + 提交后拦工具）；
//   计划落库        → 一条 kind="plan" 的 activity（对应 DSH 的 submitted-plan 聊天节点，
//                     plan-definition.ts:15-33：每次提交生成一个聊天节点，不是任务字段）；
//   审阅落库        → 一条 intercept_pending（tool_name=exit_plan_mode）+ 一条
//                     kind="plan_review" 的 activity（见 intercept/plan_review.go）。

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"sync"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/intercept"
	"github.com/Autumn-27/norma/harness"
	"github.com/Autumn-27/norma/llm"
	acperm "github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
)

// exitPlanModeName 是 DSH 的模型可调用工具名（index.ts:64），保持 snake_case 原样。
const exitPlanModeName = intercept.ExitPlanModeTool

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

// planTurnState 是本轮计划模式的三种走向（DSH index.ts:352-362 的两条分支 + 取消）。
type planTurnState int

const (
	// planOpen：还没提交计划，或用户要求继续规划——exit_plan_mode 可再次调用。
	planOpen planTurnState = iota
	// planApproved：用户批准，计划模式已退出，本轮后续可以正常执行工具。
	planApproved
	// planConcluded：用户关闭了审阅（ASK_CANCELLED）——本轮结束，不再执行工具、
	// 不再请求模型（DSH index.ts:340 exec.concludeTurn()）。
	planConcluded
)

// planTurn 是本轮（一次 Chat = 一个回合）的计划模式状态，由 exit_plan_mode 与
// planGateHooks 共享。MainAgent 每轮新建一个 Session，所以它天然是按轮隔离的。
type planTurn struct {
	mu    sync.Mutex
	state planTurnState
	title string
}

// set 记录本轮的计划状态。
func (p *planTurn) set(state planTurnState, title string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.state = state
	p.title = title
}

// status 返回本轮的计划状态与最近一次提交的标题。
func (p *planTurn) status() (planTurnState, string) {
	if p == nil {
		return planOpen, ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.state, p.title
}

// markSubmitted 记录本轮已提交计划（DSH index.ts:340：提交后本轮到此为止）。
func (p *planTurn) markSubmitted(title string) { p.set(planConcluded, title) }

// submittedPlan 报告本轮是否已结束（提交后未批准 / 用户关闭审阅），以及标题。
func (p *planTurn) submittedPlan() (bool, string) {
	state, title := p.status()
	return state == planConcluded, title
}

// planGateHooks 是 harness.HookRunner 的包装：把 DSH 的 concludeTurn 语义落到本仓库
// 的 loop 上（loop 没有 concludeTurn，只有 PreToolUse 能拦工具、ConcludeTurn 能掐掉
// 下一次模型请求，见 harness/query.go 的 TurnConcluder）。
// 其余钩子原样委托给任务原有的 guard（可能为 nil）。
type planGateHooks struct {
	inner harness.HookRunner
	turn  *planTurn
	// tools 是本轮实际挂载的工具（按名字），用来读每个工具的 ReadOnly 元数据（P-1 硬边界）。
	tools map[string]actool.CoreTool
	// strict 读设置 plan_mode_strict：true = 计划批准前拒绝非只读工具；false/nil = 只记录警告。
	strict func() bool
	// warn 在非严格模式下记录一次"计划模式调用了非只读工具"（日志，不进模型）。
	warn func(name string)
}

type forcePlanStrictKey struct{}

// WithForcePlanStrict 标记本轮计划模式按严格硬边界执行（不看 plan_mode_strict 设置），
// 用于 safety=readonly 的自动化轮次：无人值守时绝不放行非只读工具。
func WithForcePlanStrict(ctx context.Context) context.Context {
	return context.WithValue(ctx, forcePlanStrictKey{}, true)
}

func forcedPlanStrict(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(forcePlanStrictKey{}).(bool)
	return v
}

// planModeBlockedMsg 是严格计划模式下拒绝非只读工具时回给模型的话（P-1）。
const planModeBlockedMsg = "计划模式：此操作需在计划批准后执行"

// planAlwaysAllowed 是计划模式下永远放行的非只读工具：只改本会话内存状态、不触碰目标系统。
var planAlwaysAllowed = map[string]bool{
	"TodoWrite":       true,
	"AskUserQuestion": true,
	exitPlanModeName:  true,
	// 由 agentcore 自行挂载（不在本轮 tools 列表里）但元数据为只读的工具。
	"web_search":       true,
	"SearchExtraTools": true,
}

// planToolReadOnly 判定某次工具调用在计划模式下是否算只读：工具未知（如未披露的 MCP）
// 一律按非只读处理（fail closed）。
func (h *planGateHooks) planToolReadOnly(name string, input []byte) bool {
	if planAlwaysAllowed[name] {
		return true
	}
	tool, ok := h.tools[name]
	if !ok || tool == nil {
		return false
	}
	return tool.IsReadOnly(json.RawMessage(input))
}

func (h *planGateHooks) PreToolUse(ctx context.Context, name string, input []byte) (bool, string, []byte) {
	state, _ := h.turn.status()
	if state == planConcluded {
		return true, "本轮计划审阅已结束（用户关闭了审阅或计划已提交未批准）：不要再调用任何工具，用一句话收尾。", nil
	}
	// P-1 计划模式硬边界：计划尚未批准（state=planOpen）时，非只读工具按设置拦截或告警。
	// 只读自动化（safety=readonly）的轮次无论设置如何都按严格模式拦截（ForcePlanStrict）。
	if state == planOpen && !h.planToolReadOnly(name, input) {
		if forcedPlanStrict(ctx) || (h.strict != nil && h.strict()) {
			return true, planModeBlockedMsg, nil
		}
		if h.warn != nil {
			h.warn(name)
		}
	}
	if h.inner == nil {
		return false, "", nil
	}
	return h.inner.PreToolUse(ctx, name, input)
}

// ConcludeTurn 实现 harness.TurnConcluder：用户关闭计划审阅后，本轮**不再请求模型**
// （DSH plan-mode/src/index.ts:340 `exec.concludeTurn()`）。
func (h *planGateHooks) ConcludeTurn() bool {
	state, _ := h.turn.status()
	return state == planConcluded
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

// exitPlanMode 是计划模式的提交/审阅工具（DSH index.ts:280-376 的对齐实现）：
// 入参 `{ "plan": "<markdown>" }`，校验非空 + 首行 `# 标题`，把计划落成一条
// kind="plan" 的 activity（= DSH 的 submitted-plan 聊天节点），然后**当场向用户
// 提问审批**（DSH index.ts:316-333），按结果分三条路走：
//   - 批准 → 退出计划模式，返回"已批准，开始执行"；
//   - 继续规划 → 返回**错误**，把用户反馈带回模型（DSH index.ts:352-357）；
//   - 关闭审阅 → 本轮结束，不再请求模型（DSH index.ts:339-341）。
func (t *ToolSet) exitPlanMode() actool.CoreTool {
	return actool.Build(actool.Spec{
		Name: exitPlanModeName,
		Description: "只在计划模式下可用。把已经写好的完整计划提交给用户审阅（用户会当场看到计划全文并选择" +
			"批准或继续规划）。批准后退出计划模式，你从下一步开始执行；用户要求继续规划时，反馈会作为错误返回给你。" +
			"调用前先用只读手段把情况侦察清楚。",
		Prompt: "plan 必须是完整的 Markdown，且首行是一级标题（例如 `# 测试计划`）；" +
			"写清目标、步骤（每步做什么/用哪个工具/预期结果）、风险与回滚、需要人工确认的点。",
		Schema: obj(map[string]any{
			"plan": str("完整的计划正文（Markdown），首行必须是一级标题 `# 标题`。"),
		}, "plan"),
		// 对权限而言是只读（计划模式里必须允许调用，DSH index.ts:112 同理）；
		// 但它会写一条 activity、发起审批并结束本轮，所以不并发安全（DSH index.ts:113）。
		ReadOnly:   func(json.RawMessage) bool { return true },
		Concurrent: func(json.RawMessage) bool { return false },
		Permissions: func(context.Context, json.RawMessage, acperm.Context) acperm.Decision {
			return acperm.Allowed()
		},
		Run: func(ctx context.Context, in json.RawMessage, tc *actool.ToolContext) (actool.Result, error) {
			// DSH index.ts:304-306：不在计划模式调用 → 报错。已批准/已结束的本轮
			// 同样不算计划模式（DSH 读的是 committed 状态：index.ts:304 loggedActive）。
			state, _ := t.planTurn.status()
			if !t.planMode || state != planOpen {
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
			// 没有落库通道 / 没有审阅通道都不能假装提交成功：DSH 在没有审阅通道时也是
			// fail closed（README.md:63「If no interactive review is available,
			// exit_plan_mode cannot run」、index.ts:310-313 抛错）。否则用户永远看不到
			// 这份计划，也没法批准。
			if t.planEmit == nil || t.planReview == nil {
				return actool.Errorf(exitPlanModeName + " 当前没有可用的计划审阅通道（会话未接线），计划没有保存。请直接用文字把计划回复给用户。"), nil
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
			// DSH index.ts:316-333：**当场向用户提问审批**，detail 是完整计划，
			// 两个选项（批准 / 继续规划）。这里阻塞等用户决定。
			outcome, reviewErr := t.planReview(ctx, title, plan)
			if reviewErr != nil {
				// 计划已落库，但审阅没能发起：不谎报成功，让模型知道用户没看到计划。
				return actool.Errorf("计划已保存，但审阅通道出错（用户没看到审批）：" + reviewErr.Error() +
					"。请直接告诉用户计划已生成、需要在会话里审阅。"), nil
			}
			switch {
			case outcome.Approved:
				// DSH index.ts:358-362：退出计划模式，下一步开始执行。
				if t.planExit != nil {
					t.planExit()
				}
				t.planTurn.set(planApproved, title)
				return actool.Text("计划已获用户批准，计划模式已退出：从下一步开始按计划执行。"), nil
			case outcome.Dismissed:
				// DSH index.ts:339-341：用户关闭审阅 → concludeTurn，本轮结束。
				t.planTurn.markSubmitted(title)
				return actool.Text("用户关闭了计划审阅（没有批准，也没有要求继续规划）。本轮到此结束：不要再调用任何工具，" +
					"用一句话告诉用户计划已生成、可在会话里随时查看。"), nil
			default:
				// DSH index.ts:352-357：不是选 Approve → 抛错把反馈带回模型。
				feedback := strings.TrimSpace(outcome.Feedback)
				if feedback == "" {
					return actool.Errorf("用户选择继续规划；请修改计划后重新提交（再次调用 " + exitPlanModeName +
						" 提交完整的新计划）。"), nil
				}
				return actool.Errorf("用户选择继续规划；反馈：" + feedback +
					"。请按反馈修改计划后重新提交（再次调用 " + exitPlanModeName + " 提交完整的新计划）。"), nil
			}
		},
	})
}
