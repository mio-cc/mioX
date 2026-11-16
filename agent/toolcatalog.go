package agent

import (
	"context"
	"encoding/json"

	actool "github.com/Autumn-27/norma/tool"
)

// 本文件把「内置工具」从纯代码变成可枚举、可被 DB 覆盖的目录：
//   - BuiltinToolSeeds()：把三个执行 agent 的内置工具集展开成 seed 记录（key +
//     描述 + 参数 schema + 默认绑定的 agent），供服务端开机幂等播种进 tools 表。
//   - ToolResolve 钩子：运行时按 DB 里的 tools 行对已装配的工具做「按 agent 过滤 +
//     覆盖描述/schema + 注入参数默认值」。key/handler 仍在代码层，DB 只改「散文与默认值」。
// handler（Call 行为）永远来自代码——DB 改不了它，只能改模型看到的说明与缺省入参。

// ToolSeed 是一个内置工具的可播种快照：key 即 CoreTool.Name()（与 handler 死绑，
// UI 只读），Desc/Schema 取自代码里的工具定义，Agents 是代码默认把它给了哪些 agent。
type ToolSeed struct {
	Key    string         // = CoreTool.Name()，主键，不可改
	Desc   string         // 顶层描述（可在 UI 覆盖）
	Schema map[string]any // 参数 JSON-Schema（结构只读，description/default 可在 UI 改）
	Agents []string       // 默认绑定的 agent key（worker/planner/mainagent）
}

// backgroundTaskTools returns the SDK's background-task management tools: the
// only way to read, list and stop a command started with Bash(run_in_background)
// or Monitor. Bash's own schema advertises exactly these names
// (norma/tool/bash.go:47-53 "read its output later with TaskOutput"), so if they
// are missing from the tool list the model is told to call a tool that does not
// exist and the backgrounded command becomes an orphan (no output, no kill).
//
// Why these four are seeded into the tools table even though they come from the
// SDK (unlike DefaultTools, see builtinToolsByAgent):
//   - Bash's description names TaskOutput, so the model must actually have it;
//     without a catalog row the tools page cannot show the capability at all, and
//     a user cannot see/tune the description the model reads.
//   - A row makes ToolResolve (server/assembly.go:264) authoritative: it drops a
//     tool from an agent the row is not bound to. So the row + the binding have to
//     ship together — that is what seedBackgroundTaskBindings backfills for DBs
//     whose rows predate this change.
//   - The SDK still grants them to every session it owns (agentcore.go:317-322),
//     so removing the row/binding cannot make the capability vanish; the catalog
//     decides which agents get the *host* instance (decorated + metered) rather
//     than the SDK's bare fallback copy.
//
// Granted to mainagent (the human-facing lane: long scans, dev servers, polling)
// and worker (the lane that actually runs the long recon commands). Not planner:
// its turns are short and planning-only; if a planner command is auto-backgrounded
// on timeout it still gets the output-file path back and can Read it.
func backgroundTaskTools() []actool.CoreTool {
	return []actool.CoreTool{
		actool.NewTaskOutput(), // read a task's captured output (optionally blocking)
		actool.NewTaskStop(),   // kill one task / all of them
		actool.NewTaskList(),   // what is running in this session
		actool.NewMonitor(),    // start a streaming process (tail -f, dev server, poll loop)
	}
}

// builtinToolsByAgent 用一个「只读空壳」ToolSet（nil stores）构造每个执行 agent 的
// 领域工具集。工具构造函数只把闭包塞进 Spec、构造期不解引用 store，所以 nil 安全——
// 这些工具在这里只用来读 Name()/Description()/InputSchema()，绝不 Call。
//
// 刻意【不含】SDK 通用工具 actool.DefaultTools()（Read/Write/Edit/MultiEdit/LS/Glob/
// Grep/Bash）：它们每个 agent 都固定拥有、没有「绑定到谁」的取舍，且说明大多在 Prompt()
// 里（本表只覆盖 Description()，会造成半覆盖误导）。不 seed → 无 DB 行 → ToolResolve
// 原样放行、不覆盖，行为与从前一致。只有 artex 自己的领域工具入表可管。
//
// 例外：backgroundTaskTools()（TaskOutput/TaskStop/TaskList/Monitor）虽然也是 SDK 通用
// 工具，却**必须**入表，理由见该函数注释——它们是 Bash(run_in_background) 的唯一出口，
// 而入表之后 ToolResolve 就会按 agents 绑定裁剪它们（assembly.go:264），所以入表与绑定
// 必须同时到位，否则「工具管理页看得见」和「模型真的能用」会打架。
func builtinToolsByAgent() map[string][]actool.CoreTool {
	ts := NewToolSet(nil, "")
	return map[string][]actool.CoreTool{
		// 团队任务板的 4 个工具**必须**出现在 mainagent 的 seed 里，哪怕运行时只有
		// tasks.team_mode=true 才把它们放进工具集：seed 决定 DB tools 表的 agents 绑定，
		// 而 ToolResolve（server/assembly.go:264）会把「有行但没绑当前 agent」的工具直接
		// 丢掉。不 seed → 行里只有 planner/worker → 主 agent 永远拿不到（实测就是这个
		// 症状：team_mode 开了，模型仍回答"我的工具集里没有 team_add"）。
		// backgroundTaskTools 见其函数注释：Bash(run_in_background) 的读/停出口，
		// 入表 + 绑定必须成对，否则 ToolResolve 会把它们从 agent 上摘掉。
		"mainagent": append(append(ts.MainAgentTools(), ts.teamAdd(), ts.teamList(), ts.teamClaim(), ts.teamComplete()), backgroundTaskTools()...),
		"planner":   ts.PlannerTools(),
		"worker":    append(ts.WorkerTools(), backgroundTaskTools()...),
		// goals（目标拆解器）默认绑 set_goals + set_constraints：靠它们把拆出的目标、
		// 抽出的操作约束写进库。与 mainagent 共用同一受管工具，web 端可改描述/schema、按 agent 勾选。
		"goals": {ts.setGoals(), ts.setConstraints()},
		// auto 默认绑漏洞上报 + 资产管理工具，其他域工具可在 UI 按需勾选。
		// 新库由此 seed 写入；老库由 seedAutoDefaultBindings 迁移。
		"auto": {ts.addFinding(), ts.insertAssets(), ts.addCompanyScope(), ts.listAssets(), ts.listCompanies()},
		// pentest（独立渗透 agent）默认绑：查资产 / 插资产 / 报漏洞 / 查漏洞 / 查企业。
		// 新库由此 seed 写入；老库由 seedPentestDefaultBindings 迁移。
		"pentest": {ts.listAssets(), ts.insertAssets(), ts.addFinding(), ts.listFindings(), ts.listCompanies()},
	}
}

// defaultUnbound：这些 system 工具会照常入目录（web 端可见、可手动按 agent 勾选），但
// 默认【不绑任何 agent】——ToolResolve 对空绑定的工具对所有 agent 一律丢弃,须显式 opt-in。
// 之所以仍留在某个 agent 的 base 工具集里(如 goal_met 在 PlannerTools):一是让 seed 能
// 构造它拿到 desc/schema,二是用户手动绑回后运行时 base 里有它、ToolResolve 才留得住。
//
// goal_met：绕过逐个 prove_goal、直接从全局宣布【整个任务完成】,权重大且有误判风险,又与
// 「prove_goal 标记最后一个目标 → 自动收官」重复,故默认不给任何 agent,需要时再手动绑。
var defaultUnbound = map[string]bool{"goal_met": true}

// TeamToolNames are the shared-board tools granted per SESSION by tasks.team_mode
// (ToolSet.TeamTools), never by the server-level domain registry: the registry copy is
// injected into every agent bound to a tool (server/assembly.go:274-289), which would
// hand the board to a session that never enabled team mode — i.e. it would silently
// undo the capability gate. Kept as a set so the exclusion has one definition.
var TeamToolNames = map[string]bool{
	"team_add": true, "team_list": true, "team_claim": true, "team_complete": true,
}

// BuiltinToolSeeds 把各 agent 的内置工具集去重合并成 seed 列表：同名工具（如 list_assets
// 多个 agent 都有）合成一条，Agents 取并集；defaultUnbound 里的工具则强制绑定为空。
func BuiltinToolSeeds() []ToolSeed {
	byAgent := builtinToolsByAgent()
	order := []string{"mainagent", "goals", "planner", "worker", "auto", "pentest"}

	type acc struct {
		tool   actool.CoreTool
		agents []string
	}
	m := map[string]*acc{}
	var keys []string
	for _, ak := range order {
		for _, t := range byAgent[ak] {
			a, ok := m[t.Name()]
			if !ok {
				a = &acc{tool: t}
				m[t.Name()] = a
				keys = append(keys, t.Name())
			}
			a.agents = append(a.agents, ak)
		}
	}

	out := make([]ToolSeed, 0, len(keys))
	for _, k := range keys {
		a := m[k]
		agents := a.agents
		if defaultUnbound[k] {
			agents = []string{} // 入目录、可手动绑，但默认不给任何 agent（存 [] 而非 null，与其它工具一致）
		}
		out = append(out, ToolSeed{
			Key:    k,
			Desc:   a.tool.Description(),
			Schema: a.tool.InputSchema(),
			Agents: agents,
		})
	}
	return out
}

// ToolResolve, if set, post-processes an agent's fully-assembled tool list against
// the DB tools table: it drops tools not bound to this agent (or globally disabled)
// and wraps the rest so the model sees the DB-overridden description/schema and
// 缺省入参 get injected. Tools with no matching DB row (MCP/skill/host tools like
// traffic) pass through untouched. nil = tools unchanged. Wired in server/assembly.go.
var ToolResolve func(ctx context.Context, agentKey string, tools []actool.CoreTool) []actool.CoreTool

// DecorateTool wraps t so Description()/InputSchema() report the DB overrides and
// Call() injects scalar parameter defaults (from schema's "default" props) whenever
// the model omitted them. Name/Prompt/permission/scheduler flags delegate to t, so
// the tool's identity and handler are unchanged. Empty desc/schema fall back to t's.
func DecorateTool(t actool.CoreTool, desc string, schema map[string]any) actool.CoreTool {
	if desc == "" {
		desc = t.Description()
	}
	if len(schema) == 0 {
		schema = t.InputSchema()
	}
	return &overriddenTool{CoreTool: t, desc: desc, schema: schema}
}

// overriddenTool is a CoreTool decorator: it embeds the original (so all behavioral
// methods — Prompt/IsReadOnly/IsConcurrencySafe/CheckPermissions/Name — delegate)
// and overrides only the model-facing description/schema plus default injection.
type overriddenTool struct {
	actool.CoreTool
	desc   string
	schema map[string]any
}

func (o *overriddenTool) Description() string         { return o.desc }
func (o *overriddenTool) InputSchema() map[string]any { return o.schema }

func (o *overriddenTool) Call(ctx context.Context, in json.RawMessage, tc *actool.ToolContext) (actool.Result, error) {
	return o.CoreTool.Call(ctx, injectDefaults(in, o.schema), tc)
}

// injectDefaults fills scalar parameter defaults declared in the (possibly edited)
// schema into the input JSON whenever the model omitted the field or left it empty/
// null. Structure (names/types/required) is untouched — only缺省值 are merged in.
func injectDefaults(in json.RawMessage, schema map[string]any) json.RawMessage {
	defs := scalarDefaults(schema)
	if len(defs) == 0 {
		return in
	}
	m := map[string]json.RawMessage{}
	if len(in) > 0 {
		if err := json.Unmarshal(in, &m); err != nil {
			return in // non-object input: don't touch it
		}
	}
	changed := false
	for k, dv := range defs {
		if cur, ok := m[k]; !ok || isEmptyJSON(cur) {
			m[k] = dv
			changed = true
		}
	}
	if !changed {
		return in
	}
	b, err := json.Marshal(m)
	if err != nil {
		return in
	}
	return b
}

// scalarDefaults extracts properties[k]["default"] for scalar params (string/
// integer/number/boolean). Array/object defaults are skipped: merging them is
// ambiguous and not worth the surprise.
func scalarDefaults(schema map[string]any) map[string]json.RawMessage {
	props, _ := schema["properties"].(map[string]any)
	if len(props) == 0 {
		return nil
	}
	out := map[string]json.RawMessage{}
	for name, raw := range props {
		p, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		dv, ok := p["default"]
		if !ok || dv == nil {
			continue
		}
		switch p["type"] {
		case "string", "integer", "number", "boolean":
			if b, err := json.Marshal(dv); err == nil {
				out[name] = b
			}
		}
	}
	return out
}

func isEmptyJSON(raw json.RawMessage) bool {
	s := string(raw)
	return s == "null" || s == `""`
}
