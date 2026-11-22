<div align="center">

# mioX

一个多智能体 agent harness（Go 后端 + Next.js 控制台）

输入框 · 会话侧栏 · 目标与计划 · 定时任务

</div>

---

mioX 是一个自托管的**多智能体工作台**：把「一个输入框 + 一个会话列表」的 harness 交互形态，和一个多智能体执行内核组合在一起。主 Agent 负责与人对话和操舵；规划者维护目标图谱、判断达成、派发工作项；执行者逐项执行并把结论写回图谱。适合作为自托管 agent 工作台的骨架，或在此基础上替换提示词与工具集，搭自己的业务 agent 平台。

## 主要特性

- **多智能体编排**：主 Agent / 规划者 / 执行者三类角色；目标图谱 + 逐项验收（`prove_goal` 驱动收官）；计划模式（`/plan`、Shift+Tab、提交计划 + 审批条）
- **DSH 风格控制台**（`/v2`）：composer 输入区（队列 / 插话 / 停止）、会话多视图（概览 · 探索 · 发现 · 资产）、右侧检查器（审批 / 发现 / 证据 / 文件）、设置面板（模型 / 供应商链 / 工具 / MCP / 技能 / Agent 预设）
- **定时任务**：once / every / daily / weekly / 自制五字段 cron；服务端预览、合并到期、不重放停机窗口、运行记录
- **LLM 接入层**：OpenAI 兼容 / Anthropic / Responses 三种协议；多供应商优先级链与失败切换、每轮推理档位覆盖、token 用量与调用记录
- **工具审批**：工具调用拦截 + 规则与模型两级裁决 + 审批队列 / 审批历史
- **存储**：PostgreSQL（开发环境用 PGlite 起本地库即可）；数据全部走 SQL，前端只经 data adapter 层取数

## 架构

| 层 | 目录 | 说明 |
|---|---|---|
| 后端 | `server/` `agent/` `db/` `guard/` `intercept/` | 编排引擎、REST + SSE、目标 / 计划 / 定时任务、工具拦截层 |
| Agent SDK | `third_party/norma` | 会话循环、流式 SSE 解析、工具调用、上下文压缩（fork，含本地补丁） |
| 前端 | `web/src/v2` `web/src/components/v2` | DSH 风格控制台：设计 kit + data adapter 层 |

项目附带若干**业务处理工具**（资产登记、事实记录、图谱查询、约束登记等）作为示例骨架；工具目录是开放的，按自己的业务替换即可。

## 快速开始

需要：Go 1.24+、Node.js 18+、一个 PostgreSQL（或任意 SQL 兼容服务）。

```bash
# 1) 数据库 —— 任选其一
#    a. 已有 PostgreSQL：直接配连接串
#    b. 本地快速起：用 PGlite（PostgreSQL 的 WASM 版）监听 5433
#       （.localrun/pglite 是本地开发约定，不入库，任意 node + @electric-sql/pglite 均可复刻）
export ARTEX_PG_DSN='postgres://postgres@127.0.0.1:5433/postgres?sslmode=disable'

# 2) 后端
go build -o artex.exe ./cmd/artex && ./artex.exe   # → http://127.0.0.1:8787

# 3) 前端（开发模式）
cd web && npm install && npm run dev               # → http://127.0.0.1:3000/v2/shell
```

首次使用：在「设置 → 模型」里添加一个 LLM 供应商（OpenAI 兼容接口均可），即可在输入框对话、创建任务、体验目标 / 计划 / 定时任务闭环。

## 许可

AGPL-3.0（见 [LICENSE](LICENSE)）。
