/**
 * English language pack.
 *
 * gettext-style catalogs: the source message is the key. Chinese source
 * messages are translated here; English source messages fall back unchanged.
 * Abbreviations such as LLM, API, Agent, HTTP, TCP, MITM and SOCKS stay as-is.
 */
const enUS: Record<string, string> = {
  // Common
  保存: "Save",
  取消: "Cancel",
  已配置: "Configured",
  测试中: "Testing",
  测试搜索: "Test Search",
  版本: "Version",
  重新检测: "Detect Again",

  // Navigation
  功能: "Features",
  系统: "System",
  仪表盘: "Dashboard",
  对话: "Chat",
  任务: "Tasks",
  发现: "Findings",
  流量: "Traffic",
  工具执行: "Commands",
  "LLM 录制": "LLM Records",
  资产: "Assets",
  资产同步: "Asset Sync",
  工作空间: "Workspace",
  LLM: "LLM",
  Agent: "Agent",
  MCP: "MCP",
  Skill: "Skill",
  工具: "Tools",
  通知推送: "Notifications",
  拦截规则: "Intercept Rules",
  资产拦截: "Asset Intercept",
  审批记录: "Approvals",
  日志: "Logs",
  系统配置: "System Settings",

  // System settings page
  全局运行时开关: "Global runtime toggles",
  流量捕获: "Traffic Capture",
  "Agent 自动绑定流量": "Auto-bind Traffic to Agent",
  全局代理: "Global Proxy",
  操作约束注入: "Constraint Injection",
  实验功能: "Experimental Features",
  网络搜索: "Web Search",
  "自定义脚本  Python 解释器": "Custom Scripts  Python Interpreter",
  "工作并发  Work Agent 数": "Concurrency  Work Agents",
  会话输入框发送键位: "Chat Send Key",
  代理地址: "Proxy Address",
  搜索来源: "Search Provider",
  发送方式: "Send Mode",
  "出口代理（可选）": "Egress Proxy (optional)",
  "注入规划者（planner）": "Inject into planner",
  "注入执行者（worker）": "Inject into worker",
  "noa 上下文压缩": "noa context compaction",
  "规划者 / 执行者 / 主 Agent / 对话": "Planner / Worker / Main Agent / Chat",
  "总开关 + 来源配置": "Master switch + provider configuration",
  "每个 Agent 的配置": "each Agent's configuration",
  "当前激活的 LLM 配置": "the currently active LLM profile",
  "仅支持 DeepSeek 官方模型": "only supports official DeepSeek models",
  "必须使用 anthropic 协议": "must use the anthropic protocol",
  "DeepSeek 服务端执行": "executed by the DeepSeek server",
  不经过上面的出口代理: "does not use the egress proxy above",
  不计入流量留痕: "is not recorded as traffic",
  只有标题和链接: "only titles and links",
  "用当前配置（来源 + 代理 + Key）实际搜索一次「test」，验证是否可用。":
    "Run a real test search with the current provider, proxy and Key to verify the configuration.",
  该偏好: "This preference",
  只存在本浏览器: "is stored only in this browser",
  "，不随账号同步，换浏览器或清理站点数据后需重新设置。":
    ", is not synced with the account, and must be set again after switching browsers or clearing site data.",
  "对话页与任务详情的主 Agent 会话输入框共用此设置，选择后立即生效、无需保存。":
    "Shared by the chat page and the main Agent input in task details. Changes take effect immediately without saving.",
  "每个任务并发运行的工作 agent 数量（默认 3）。数值越大并发探测越多、消耗也越高。修改后":
    "Number of work agents running concurrently per task (default: 3). Higher values mean more parallel probing and higher usage. Changes take effect",
  对之后启动的任务生效: "for newly started tasks",
  "，正在运行的任务不受影响。": ", running tasks are unaffected.",
  自定义: "Custom",
  "类型工具用它跑 Python。开机会自动检测（python3 优先）；此处可手填 venv / 特定版本的绝对路径，留空则运行时自动检测。":
    "type tools use it to run Python. Auto-detected at startup (python3 preferred); you can also enter the absolute path of a venv or a specific version here. Leave empty to auto-detect at runtime.",
  "前往 https://tavily.com 注册并获取 API Key。": "Register at https://tavily.com to get an API Key.",
  "免费版额度约 2,000 次/月。前往 https://brave.com/search/api/ 获取 Key。":
    "The free tier allows about 2,000 searches/month. Get a Key at https://brave.com/search/api/.",
  "已选择 Brave 但尚未配置 Key  在保存 Key 之前，搜索工具不会启用。":
    "Brave is selected but no Key is configured  the search tool stays disabled until you save a Key.",
  "已选择 Tavily 但尚未配置 Key  在保存 Key 之前，搜索工具不会启用。":
    "Tavily is selected but no Key is configured  the search tool stays disabled until you save a Key.",
  "独立出口代理，仅用于访问搜索端点（VPN/SOCKS 等）。与记录流量的 MITM 代理无关；网络不通时经此代理访问。":
    "Dedicated egress proxy for search endpoints only (VPN/SOCKS, etc.). It is independent of the MITM traffic-recording proxy; use it when direct access fails.",
  "关闭后该 Agent 不再看到约束。": "Once disabled, the Agent no longer sees constraints.",
  "，无需重建 Agent。": ", no Agent rebuild required.",
  "切换即时生效（下一轮读取）": "Takes effect immediately (read on the next turn)",
  "（在任务总览「操作约束」里维护的 allow/deny 条目）拼进对应 Agent 的系统提示，用来框定探索边界（如「仅测当前端口」「禁止爆破」）。":
    " (allow/deny entries maintained in Task Overview  Operation Constraints) are added to the corresponding Agent system prompt to define exploration boundaries (e.g. only test the current port, no brute force).",
};

const overrides: Record<string, string> = {
  不会: "will not",
  不含: "do not include",
  "拿到代理配置与流量工具，提示词也": "receive proxy configuration and traffic tools, and the prompt also",
  "所有 Agent 的": "All Agents' ",
  "经此代理出网（隐藏源 IP / 走跳板）。支持":
    "egress through this proxy (hides the source IP / uses a jump host). Supports ",
  "，可带": ", supports ",
  "认证。留空=直连。": " authentication. Leave blank for a direct connection.",
  目标流量: "target traffic",
  "当前已是最新版本。": "You are on the latest version.",
  当前已是最新版本: "You are on the latest version",

  独立程序: "Standalone",
  检查更新: "Check for Updates",
  更新日志: "Changelog",
  最新版本: "Latest Version",
  版本与更新: "Version & Updates",
  "工作并发 · Work Agent 数": "Concurrency · Work Agents",
  "自定义脚本 · Python 解释器": "Custom Scripts · Python Interpreter",

  "搜索测试成功 · {backend} 返回 {count} 条结果": "Search test succeeded · {backend} returned {count} results",
  "发现新版本 {version}": "New version {version} found",
  "已更新到 {version}，正在重新加载页面": "Updated to {version}, reloading the page",

  "Enter 发送，Shift+Enter 换行": "Enter to send, Shift+Enter for newline",
  "Ctrl+Enter 发送，Enter 换行": "Ctrl+Enter to send, Enter for newline",

  界面语言: "Interface Language",
  "选择界面显示语言，默认简体中文。": "Choose the interface language. Simplified Chinese is the default.",

  修改密码: "Change Password",
  退出登录: "Log out",
  当前密码: "Current Password",
  新密码: "New Password",
  确认新密码: "Confirm New Password",
  确认修改: "Confirm Change",
  "修改中…": "Changing…",
  请填写当前密码和新密码: "Please enter the current and new passwords",
  两次输入的新密码不一致: "The new passwords do not match",
  密码已修改: "Password changed",
  "修改失败：": "Change failed: ",
  用户名固定为: "The username is fixed to ",
  "。需先输入当前密码验证；修改后已签发的登录 token 仍有效直至过期。":
    ". Enter the current password to verify first; existing login tokens remain valid until they expire after the change.",
  "已开启 · 增加了 Token 消耗": "Enabled · increases Token usage",
  "已关闭 · 不记录、不注入代理": "Disabled · no recording or proxy injection",
  "已关闭 · 可继续人工绑定": "Disabled · manual binding still available",
  "已开启 · 正在记录流量并注入代理": "Enabled · recording traffic and injecting proxy",
  "已开启 · 会增加 Token 消耗": "Enabled · increases Token usage",
  "总开关已开启 · 可在各 Agent 配置里单独启用": "Master switch on · can be enabled per Agent",
  "已配置 · 所有目标流量经此代理出网": "Configured · all target traffic egresses through this proxy",
  "未配置 · 目标流量直连出网": "Not configured · target traffic goes direct",
  "测试中…": "Testing…",
  "保存失败：": "Save failed: ",
  "搜索测试失败：": "Search test failed: ",
  未知错误: "Unknown error",
  "已保存并发工作 agent 数（对之后启动的任务生效）": "Work Agent concurrency saved (applies to newly started tasks)",
  "已保存 Python 解释器配置": "Python interpreter saved",
  已保存网络搜索配置: "Web search configuration saved",
  "已保存 Brave API Key": "Brave API Key saved",
  "已保存 Tavily API Key": "Tavily API Key saved",
  "并发数必须是大于 0 的整数": "Concurrency must be a positive integer",
};

export default { ...enUS, ...overrides };
