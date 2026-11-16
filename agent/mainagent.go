package agent

import (
	"context"
	"fmt"
	"strings"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/guard"
	"github.com/Autumn-27/artex/intercept"
	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
	"github.com/Autumn-27/norma/transcript"
)

// MainAgent is the thin human-interface orchestrator (docs §4.2 / §7). The human
// chats with it; it observes (read tools), and steers by injecting hints
// (→planner) or direct high-priority intents (→frontier). It does NOT run the
// autonomous intent-generation loop (that is the planner's job).
type MainAgent struct {
	// guard applies the user-configured intercept rules (approve / deny / ask) to
	// this agent's tool calls. nil disables interception.
	guard *guard.Guard

	findingRecorder FindingRecorder
	prov            llm.Provider
	model           string
	tx              *transcript.Store                      // raw LLM conversation persistence (nil = off)
	window          int                                    // context window in tokens (for compaction)
	windowFn        func() int                             // optional dynamic task-chain minimum
	maxTurns        int                                    // max agent turns per run (0 = unlimited)
	proxyAddr       string                                 // recording proxy for WebFetch (empty = direct)
	proxyCACert     string                                 // recording proxy's CA cert path (HTTPS verify)
	webSearch       WebSearchOpts                          // web_search tool backend selection (off by default)
	workDir         string                                 // shared work dir (surfaced in prompt as artifact-output target)
	taskWorkDir     string                                 // 用户为任务选的目录；空=默认 run 目录
	planMode        bool                                   // 计划模式：工具全保留，靠提示词约束"只侦察+交计划"，等审批（DSH 语义）
	// planReview 是计划审阅通道（DSH plan-mode/src/index.ts:316-333 的 userQuestions.ask）：
	// 写 pending 审批 + 往会话流写审阅卡片，阻塞等用户决定。nil = 没有审阅通道
	// （exit_plan_mode 会 fail closed，DSH index.ts:310-313）。
	planReview func(ctx context.Context, title, plan string) (intercept.PlanReviewOutcome, error)
	// planExit 在用户批准后退出计划模式（DSH index.ts:358-362）。nil = 只在本轮内存里退出。
	planExit func()
	// teamMode 是会话级团队模式（tasks.team_mode）。与 planMode 相反，它**改工具集**：
	// 只有它为真时，共享任务板的 4 个工具（team_add/team_list/team_claim/team_complete）
	// 才注册进主 agent——DSH 把团队开关当作「会话拥有的能力选择」
	// （TeamModeToggle.tsx:1 Session-owned Agent Teams selection），没打开就没有这项能力。
	teamMode bool
	steerWork       func(intentID int64, msg string) error // engine callback: steer a running work (nil = off)
	nonStreamingFn  func() bool                            // resolver: use non-streaming (Complete) path? (nil = streaming)
	noaEnabledFn    func() bool                            // resolver: use experimental noa compaction? (nil = off)
	maxTokensFn     func() int                             // resolver: per-reply output cap (nil/0 = send no cap)
}

// SetGuard attaches a guard (with user-configured intercept rules) to this agent,
// so its tool calls pass through the approve / deny / ask rules like the chat page.
func (m *MainAgent) SetGuard(g *guard.Guard) { m.guard = g }

// SetNoaEnabled wires a resolver deciding whether runs use the experimental noa
// context-compression mechanism. nil/unset = off (built-in compaction). Read per
// run so the settings toggle takes effect without rebuilding the agent.
func (m *MainAgent) SetNoaEnabled(fn func() bool) { m.noaEnabledFn = fn }

// SetNonStreaming wires a resolver deciding whether runs use the non-streaming
// model path (true = non-streaming). nil/unset = streaming (default).
func (m *MainAgent) SetNonStreaming(fn func() bool) { m.nonStreamingFn = fn }

func (m *MainAgent) nonStreaming() bool { return m.nonStreamingFn != nil && m.nonStreamingFn() }

// SetMaxTokens wires a resolver for the per-reply output cap. nil/unset or 0 =
// send no cap and let the endpoint decide. Read per run, like nonStreaming.
func (m *MainAgent) SetMaxTokens(fn func() int) { m.maxTokensFn = fn }

func (m *MainAgent) maxTokens() int {
	if m.maxTokensFn == nil {
		return 0
	}
	return m.maxTokensFn()
}

func NewMainAgent(prov llm.Provider, model, workDir string, tx *transcript.Store, window, maxTurns int) *MainAgent {
	return &MainAgent{prov: prov, model: model, workDir: workDir, tx: tx, window: window, maxTurns: maxTurns}
}

func (m *MainAgent) SetCompactionWindowResolver(fn func() int) { m.windowFn = fn }

func (m *MainAgent) compactionWindow() int {
	if m.windowFn != nil {
		return m.windowFn()
	}
	return m.window
}

// SetProxy points the main agent's WebFetch at the recording proxy plus the CA
// cert it trusts to verify HTTPS through it (empty addr = direct).
func (m *MainAgent) SetProxy(addr, caCert string) { m.proxyAddr, m.proxyCACert = addr, caCert }

// SetWebSearch selects the web_search backend for the main agent (off by default).
func (m *MainAgent) SetWebSearch(o WebSearchOpts) { m.webSearch = o }

// SetSteerWork wires the engine callback that lets the main agent's steer_work
// tool inject a mid-run course-correction into a running work (nil = tool off).
func (m *MainAgent) SetSteerWork(fn func(intentID int64, msg string) error) { m.steerWork = fn }

// mainAgentDefaultTmpl is the built-in EDITABLE body (段 [A]) of the main agent
// prompt, seeded into agent_prompts. Goal is a {{.Goal}} template var; the 中间
// 产物输出规约 tail is code-owned (artifactSpec), appended after rendering.
const mainAgentDefaultTmpl = `你是一个授权渗透测试系统的"主 agent"，是人类操作员的接口。你不亲自探索、也不自主连续生成意图（那是规划者的工作）。你的职责：

1. 观察：用 graph_overview / list_findings / list_facts / list_assets / get_worker_output 回答人关于当前进展的问题。
2. 操舵（把人的意图落到系统）：
   - 人想"改方向/强调某类漏洞/重点某区域" → 用 add_hint 写提示（规划者下次会读到）。
   - 人想"立刻测某个具体目标" → 用 add_intent 直接注入一条高优先级意图（priority 8-10）。系统会自动把已完成的任务拉回运行态、让 worker 领这条意图执行，跑完即回到已完成状态。
     **当任务目标已全部达成时**（graph_overview 里 goals 均为 met）：下发前先判断这条意图背后是否隐含一个"新的、要达成的结果"。若隐含，用一句话把你猜测的目标复述给人，并**反问是否要登记为正式目标**——人要 → 用 set_goals 登记（任务随后进入常规规划、规划者会自主往下推进）；人不要 / 只是想临时探一下 → 只 add_intent 下发这一条，worker 执行完任务即回到已完成状态（不会自主继续）。若这条意图明显只是一次性查证、不隐含新目标，直接 add_intent 即可，不必每次都问。
   - 人想"对某条正在运行的意图(work)实时纠偏（别再走 X、聚焦 Y）" → 用 steer_work（不打断、不丢已有进展，worker 下一步动作前生效）；先用 get_worker_output 看它在干嘛。方向整个错了则改用 add_intent 另下新意图。
   - 人想"新增一个要达成的最终目标" → 用 set_goals 增补目标。系统会把该目标写入任务图并**自动把已完成/暂停的任务拉回运行态继续跑**（规划者随后会据此重新判断是否达成），无需人工再点恢复。
   - 人想"增/改测试约束（允许/禁止某类操作，如『仅测当前端口』『禁止爆破』『只做被动侦察』）" → 用 set_constraints 登记（type=allow 允许 / type=deny 禁止）。约束会在下一轮规划时注入 planner/worker 的提示词以框定探索边界；也可在总览「约束管理」里增删改。
3. 用人话简洁回复，说明你做了什么。

当前任务目标：{{.Goal}}

不要编造发现；只根据工具返回的真实数据回答。`

// SetTaskWorkDir 绑定任务的工作目录（用户在新建任务时选的文件夹）。空=用默认 run 目录。
func (m *MainAgent) SetTaskWorkDir(dir string) { m.taskWorkDir = dir }

// SetPlanMode 切换计划模式。语义对齐 DSH @deepseek-ai/dsh-plan-mode：
// 计划模式是**软约束**——工具一个都不摘（README.md:32「It does not restrict the
// agent: every tool stays callable」、README.md:81「restrains through text rather than
// filtering capabilities」），只做两件事：系统提示加一段 plan:policy（见 planModeBlock），
// 并披露 exit_plan_mode 工具让模型把计划交出来（index.ts:64/375）。是否真的改状态由
// 用户审批决定（PATCH /api/tasks/{id}/plan-mode {"on":false}）。
func (m *MainAgent) SetPlanMode(on bool) { m.planMode = on }

// SetPlanReview 接上计划审阅通道（DSH plan-mode/src/index.ts:316-333）：提交计划后
// **当场**向用户提问审批，按结果返回 批准 / 继续规划（带反馈）/ 关闭审阅。
func (m *MainAgent) SetPlanReview(fn func(ctx context.Context, title, plan string) (intercept.PlanReviewOutcome, error)) {
	m.planReview = fn
}

// SetPlanExit 接上"退出计划模式"（用户批准后，DSH index.ts:358-362）。
func (m *MainAgent) SetPlanExit(fn func()) { m.planExit = fn }

// SetTeamMode 切换团队模式（tasks.team_mode）。与 SetPlanMode 不同，它决定共享任务板的
// 4 个工具是否进入工具集：关闭时工具**不在**工具集里（能力不给，而不是调用时报错）。
// DSH 的开关是会话拥有的能力选择（TeamModeToggle.tsx:1），看板也只在 enabled 时渲染
// （TeamBoard.tsx:86）。开关变更后调用方必须丢弃 agent bundle，下一轮重建才生效。
func (m *MainAgent) SetTeamMode(on bool) { m.teamMode = on }

// planModeBlock 是计划模式的系统提示段（DSH 的 plan:policy section，部署方自有的
// 那段文本：index.ts:67-70 注册、index.ts:197-204 仅在计划模式渲染）。
// 它约束的是**行为**而不是能力：可以随便侦察，但不要改系统状态；侦察完用
// exit_plan_mode 交计划，然后停下等审批。
const planModeBlock = `

## 当前处于「计划模式」（plan mode）
你可以照常使用**全部**工具去侦察：读文件、列目录、搜索、跑只读命令、查任务图/资产库。
不要因为"现在是计划模式"就拒绝工作，也不要声称自己没有执行能力。

但在计划被批准之前，**不要做任何会改变系统状态的操作**：
- 不写/改/删文件（不用 Write / Edit / MultiEdit 落盘）；
- 不跑有副作用的命令（攻击、扫描、爆破、安装、删除、重启、改配置等；只读命令随便跑）；
- 不落库（不要用 insert_assets / record_fact / report_finding / set_goals 等写工具）。
用户明确要求执行时，先告诉他：现在是计划模式，请先审阅并批准计划（或退出计划模式），
然后再执行。

侦察完成后，调用 ` + exitPlanModeName + ` 提交计划：
- 入参 {"plan": "<Markdown>"}；plan 不能为空，且**首行必须是一级标题**（如 ` + "`# 测试计划`" + `），
  否则工具会报错让你重写。
- 计划要写清：目标、步骤（每步做什么/用哪个工具/预期结果）、风险与回滚、需要人工确认的点。
提交后用户会**当场**看到计划全文并选择：
- **批准** → 工具返回「计划已获批准」，计划模式退出，你从下一步开始按计划执行；
- **继续规划** → 工具返回错误并带回用户的反馈，按反馈修改计划后**重新调用 ` + exitPlanModeName + `** 提交；
- **关闭审阅** → 本轮结束，不要再调用任何工具，用一句话收尾。`

// teamModeBlock 是团队模式的系统提示段。与 planModeBlock 同一写法（只在开关打开时
// 追加到系统提示），但它对应的是**能力**而不是约束：这段提示只在工具真的注册进
// 工具集时出现（mainagent.go 的 `if m.teamMode` 分支同时做这两件事）。
// 依据：DSH 团队开关是会话拥有的能力选择（TeamModeToggle.tsx:1），共享任务板是团队
// 协作的落点——把复杂工作拆成板上条目，再逐条认领/完成，而不是一口气硬做完。
const teamModeBlock = `

## 当前处于「团队模式」（team mode）
这个会话拥有**共享任务板**（工具 team_add / team_list / team_claim / team_complete），
板上每一行都是一个可执行步骤，带状态（pending / in_progress / completed）、负责人和依赖。
它和任务列表、会话历史一样是真实落库的数据，用户可以在 UI 的「团队」标签里看到同一块板。

用法约定：
- **复杂任务先拆板再动手**：接到一个多步骤的活，先用 team_add 把它拆成 2-5 个可独立执行
  的步骤写进板上（拆多步可以用 items 一次写多条，或用 depends_on 表达先后），再按板推进。
- **推进时逐条认领**：用 team_list 找 ready=true 的行，team_claim 认领（负责人记为本
  agent），做完立刻 team_complete 关闭它——依赖它的行只有在它 completed 后才会 ready。
- 一件事只占一行，不要在板上写"待定/再想想"这类空行；简单的一句话问答不必建板。
- 用户问"板上有什么"时，用 team_list 读真实状态回答，不要凭记忆复述。`

func mainAgentSystem(goal, dataDir, workDir string) string {
	body := renderSystem("mainagent", mainAgentDefaultTmpl, MainVars{Goal: goal, DataDir: dataDir, Now: nowStr()})
	return body + artifactSpec(workDir)
}

// GoalPrompt 把「当前目标」拼进系统提示**已有的** {{.Goal}} 槽位（mainagent.go:116
// `当前任务目标：{{.Goal}}`、planner.go:310 同款），不新造模板变量——目标本来就走这
// 一条注入路径，`/goal` 只是给它换了个来源。
//
// 只注入 phase=active 的目标，依据 DSH @deepseek-ai/dsh-goal：
//   - activation-source.ts:30-32 `activeRef` 只把 `phase === 'active'` 的投影当作
//     「在推进」，非 active 的目标不产生 continuation；
//   - GoalBar.tsx:30-41 可见阶段是 active/paused/blocked（complete 直接不渲染），
//     paused/blocked 是「停下等恢复」，此时继续把目标当命令注入会与 UI 语义相反。
//
// objective 为空或 phase 不是 active 时原样返回 base，调用方无需分支。
func GoalPrompt(base, objective, phase string) string {
	objective = strings.TrimSpace(objective)
	if objective == "" || phase != db.GoalPhaseActive {
		return base
	}
	var b strings.Builder
	if trimmed := strings.TrimSpace(base); trimmed != "" {
		b.WriteString(trimmed)
		b.WriteString("\n\n")
	}
	b.WriteString("当前目标（/goal，阶段 active）：")
	b.WriteString(objective)
	return b.String()
}

// mainAgentBaseTools assembles the tool set one main-agent turn actually runs with:
// the domain tools, the default Read/Write/Edit/... set, the SDK's background-task
// control tools, and — only when the session holds the team capability — the shared
// board tools.
//
// Extracted so the capability gate is testable without an LLM turn: with teamMode
// false the returned list contains no team_* tool at all (DSH grants capabilities, it
// does not advertise a tool that always fails; TeamModeToggle.tsx:1 + TeamBoard.tsx:86).
// Plan mode's exit_plan_mode is appended separately by the caller, because it is
// disclosed by plan mode, not by this gate.
//
// Background-task tools are appended here (not left to the SDK) so they pass through
// ToolResolve like every other tool: that is what makes the tools-table row decide
// whether this agent gets them, and what lets the row's description reach the model.
// The SDK's own grant (agentcore.go:317-322) stays as the fallback for sessions that
// do not list them, and it no longer overwrites the instance supplied here
// (agentcore.go appendMissingTools). Gated on the same global switch the SDK uses, so
// a host that turned background tasks off never advertises four dead tools.
func mainAgentBaseTools(tsx *ToolSet, teamMode bool) []actool.CoreTool {
	tsx.SetTeamMode(teamMode)
	base := append(tsx.DropCoverageTools(tsx.MainAgentTools()), actool.DefaultTools()...)
	if !actool.BackgroundTasksDisabled() {
		base = append(base, backgroundTaskTools()...)
	}
	return append(base, tsx.TeamTools()...)
}

// Chat handles one human message and returns the assistant reply. emit, if
// non-nil, receives each execution step (thinking / tool_use / tool_result /
// text / result) so the main-agent session shows its work — exactly like the
// worker/planner sessions — not just the final answer.
func (m *MainAgent) Chat(ctx context.Context, taskID int64, mainSeg int, as *db.AssetStore, ts *db.ExplorationStore, goal, message string, emit func(db.Activity), notify, resume func(), notifyGoal, notifyHint func([]string)) (string, error) {
	return m.ChatUsing(ctx, m.prov, taskID, mainSeg, as, ts, goal, message, emit, notify, resume, notifyGoal, notifyHint)
}

// ChatUsing is Chat on an explicit provider. The refusal ladder uses it for L3: the same
// turn, a different model — the one lever that works when the current model keeps
// declining regardless of how the request is phrased.
func (m *MainAgent) ChatUsing(ctx context.Context, prov llm.Provider, taskID int64, mainSeg int, as *db.AssetStore, ts *db.ExplorationStore, goal, message string, emit func(db.Activity), notify, resume func(), notifyGoal, notifyHint func([]string)) (string, error) {
	// stepEmit 是这一轮所有步骤的唯一出口（emit 由 server 注入：盖章 worker=mainagent +
	// main_seg、落库、SSE 广播）。工具自己产出的记录（计划卡片）也走它，才能和普通步骤
	// 一样进同一个会话流，而不是另开一条写库路径。
	stepEmit := func(r db.Activity) {
		if emit == nil {
			return
		}
		r.Worker = "mainagent"
		emit(r)
	}
	tsx := NewToolSet(ts, "human")
	tsx.SetFindingRecorder(m.findingRecorder)
	if as != nil {
		tsx.SetAssetStore(as, as.Companies())
	}
	tsx.SetTaskID(taskID)
	tsx.SetCoverageEnabled(as == nil || as.CoverageEnabled(taskID))
	tsx.SetNotify(notify)         // 通用唤醒（无专用回调的写操作走它，debounced）
	tsx.SetResumeTask(resume)     // set_goals 新增目标 → 把已完成/暂停的任务拉回 running
	tsx.SetNotifyGoal(notifyGoal) // set_goals 新增目标 → 给 planner 记一条「人新增了目标：…」触发
	tsx.SetNotifyHint(notifyHint) // add_hint 新增提示 → 给 planner 记一条「人新增了 N 条战略提示：…」触发
	tsx.steerWork = m.steerWork   // enable steer_work tool (nil = unavailable)
	// 领域工具 + 基础默认工具集（Read/Write/Edit/MultiEdit/LS/Glob/Grep/Bash）
	// 资产覆盖度功能关闭时剔除 add_task_scope/list_untested_assets（不入 prompt）。
	// 团队模式也在这里生效：team_mode 为真才追加共享任务板的 4 个工具（见下）。
	base := mainAgentBaseTools(tsx, m.teamMode)
	// 计划模式：工具一个都不摘（DSH README.md:32/81 的软约束模型），只额外披露
	// exit_plan_mode（DSH index.ts:64，仅计划模式可见：index.ts:375）。
	planTurn := &planTurn{}
	if m.planMode {
		tsx.SetPlanMode(true)
		tsx.SetPlanTurn(planTurn)
		tsx.SetPlanEmit(stepEmit) // 计划 → 一条 kind="plan" 的 activity（DSH 的 submitted-plan 聊天节点）
		// 计划审阅通道：提交计划后当场提问审批（DSH index.ts:316-333），按结果分三条路。
		if m.planReview != nil {
			tsx.SetPlanReview(m.planReview)
		}
		if m.planExit != nil {
			tsx.SetPlanExit(m.planExit)
		}
		base = append(base, tsx.exitPlanMode())
	}
	ctx = WithRunInfo(ctx, RunInfo{TaskID: taskID, ExplorationID: explorationID(ts)})
	tools, def, cleanup := AugmentTools(ctx, "mainagent", base)
	defer cleanup()
	// 本任务的工作目录 <workDir>/tasks/<taskID>，先建好。
	mainDir := ensureRunDir(m.workDir, taskID, 0)
	// 任务绑定了用户目录就在那里干活；mainDir 仍用于工具产物与评审上下文。
	agentDir := mainDir
	if m.taskWorkDir != "" {
		agentDir = m.taskWorkDir
	}
	ctx = intercept.WithReviewWorkingDirectory(ctx, agentDir)
	sysBody := mainAgentSystem(goal, m.workDir, agentDir)
	if m.planMode {
		sysBody += planModeBlock
	}
	if m.teamMode {
		sysBody += teamModeBlock
	}
	system, boundary := deferredSystem(sysBody, def)
	opts := agentcore.Options{
		Provider:        prov,
		SystemPrompt:    system,
		DynamicBoundary: boundary,
		Tools:           tools,
		DeferredTools:   def.Deferred,
		UnlockSet:       def.Unlock,
		PermissionMode:  permission.ModeBypass,
		EnableWebFetch:  true, // 走记录代理留痕；载入代理 CA 验证 MITM 重签的 HTTPS 证书
		WebFetchProxy:   m.proxyAddr,
		WebFetchCACert:  m.proxyCACert,
		// 联网搜索(可选)。ddgs 无需 key；brave-free 需 BraveKey；tavily 需 TavilyKey。
		// WebSearchProxy 是独立出口代理(http/https/socks5)，与记录流量的 MITM 代理无关；空则直连。
		EnableWebSearch:       m.webSearch.Enabled,
		WebSearchBackend:      m.webSearch.Backend,
		BraveSearchAPIKey:     m.webSearch.BraveKey,
		TavilySearchAPIKey:    m.webSearch.TavilyKey,
		DeepSeekSearchBaseURL: m.webSearch.DeepSeekBaseURL,
		DeepSeekSearchAPIKey:  m.webSearch.DeepSeekAPIKey,
		DeepSeekSearchModel:   m.webSearch.DeepSeekModel,
		WebSearchProxy:        m.webSearch.Proxy,
		BashEnv:               proxyEnv(m.proxyAddr, m.proxyCACert), // Bash 子命令默认走代理+信任 CA
		WorkingDir:            mainDir,                              // 本任务工作目录 <workDir>/tasks/<taskID>
		ToolOutputDir:         cmdOutDir(mainDir),
		MaxTurns:              m.maxTurns,                             // 0 = unlimited (configurable in agent management)
		Compaction:            compactionConfig(m.compactionWindow()), // long chats stay within the window
		Todos:                 actool.NewTodoStore(),                  // 会话级临时待办（TodoWrite），纯规划用，退出即丢
		// 命中预算(步数)→ SDK 跑收尾:向用户输出一句进展总结。Prompt 与收尾轮数可后台编辑(默认 10 轮)。
		Settlement:   wrapupSettlement("mainagent", nil),
		NonStreaming: m.nonStreaming(), // 该 profile 选非流式时走 Provider.Complete
		MaxTokens:    m.maxTokens(),    // 0 = 不发上限,由服务端默认值决定
	}
	if m.guard != nil {
		opts.Hooks = m.guard.Hooks()
	}
	if m.planMode {
		// 计划提交后本轮不再执行任何工具（DSH index.ts:340 的 concludeTurn）。
		opts.Hooks = &planGateHooks{inner: opts.Hooks, turn: planTurn}
	}
	if m.tx != nil { // persist raw human↔AI conversation; one accumulating file per segment
		opts.Transcript = m.tx
		// Segment 0 keeps the legacy "exp%d-main" name so existing transcripts still
		// load; each new session (seg>=1) gets its own file for a clean context.
		opts.SessionID = fmt.Sprintf("exp%d-main", ts.ID())
		if mainSeg > 0 {
			opts.SessionID = fmt.Sprintf("exp%d-main-s%d", ts.ID(), mainSeg)
		}
	}
	// 实验功能:开启后由 noa 接管上下文压缩(归档集中在 <workDir>/noa/<SessionID> 下,持久)。
	// session id 与 transcript 同规则(分段感知),使归档与恢复对齐。
	noaSession := fmt.Sprintf("exp%d-main", ts.ID())
	if mainSeg > 0 {
		noaSession = fmt.Sprintf("exp%d-main-s%d", ts.ID(), mainSeg)
	}
	enableNoa(&opts, m.noaEnabledFn, m.workDir, noaSession, noaWarn(noaSession))
	ctx = attachSideCapture(ctx, &opts)
	s := agentcore.NewSession(opts)
	defer s.Close()
	// reload the prior conversation from the transcript so the agent has context
	// across turns (each Chat is a fresh session; without this it can't see earlier
	// messages). First turn: no file yet → Resume loads nothing and proceeds.
	if m.tx != nil {
		_ = s.Resume(opts.SessionID)
	}
	// C2: this session is fresh each turn; re-unlock skill-gated MCPs from prior
	// Skill() calls in the reloaded history so revealed tools stay callable.
	seedUnlockFromHistory(s.Messages(), def.UnlockSkill)
	text, _, err := captureRunSession(ctx, s, message, stepEmit)
	return text, err
}
