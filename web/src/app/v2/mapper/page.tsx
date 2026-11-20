"use client";

/**
 * Mapping probe: feed recorded-shaped activities through `toBlocks` and show both
 * the chosen block kinds and a rendered preview. This is how the activity→card
 * mapping is verified before a live stream exists.
 */
import { TerminalBlock } from "@/vendor/dsh/primitives/TerminalBlock";
import type { Activity } from "@/lib/types";
import { toBlocks, toolPayload } from "@/v2/data/activity-blocks";
import { RECORDED_SHAPES } from "@/v2/data/activity-recorded";

const TERMINAL_LABELS = {
  commandLine: (n: number) => `命令 ${n}`,
  signal: (s: string) => `信号 ${s}`,
  exitCode: (n: number) => `退出码 ${n}`,
  noExitCode: "无退出码",
  running: "执行中",
  failed: "失败",
  done: "完成",
  copy: "复制",
  copied: "已复制",
  noOutput: "无输出",
  collapseAria: "收起输出",
  collapse: "收起",
  expandAria: (n: number) => `展开其余 ${n} 行`,
  expand: (n: number) => `展开其余 ${n} 行`,
};

const SAMPLE: Activity[] = [
  { seq: 1, worker: "mainagent", ts: "2026-11-18T10:02:00Z", kind: "user", summary: "先从 huoxingai.shop 拿商品数据" },
  { seq: 2, worker: "mainagent", ts: "2026-11-18T10:02:10Z", kind: "thinking", summary: "目标是拿到商品数据，先看公开接口有没有鉴权" },
  { seq: 3, worker: "mainagent", ts: "2026-11-18T10:03:00Z", kind: "tool_use", tool: "Bash", tool_use_id: "t1", summary: "curl -sS https://huoxingai.shop/rest-api/getCategoryProducts" },
  { seq: 4, worker: "mainagent", ts: "2026-11-18T10:03:02Z", kind: "tool_result", tool: "Bash", tool_use_id: "t1", summary: "HTTP/2 200", detail: "HTTP/2 200\ncontent-type: application/json\n\n{\"code\":0,\"data\":{\"list\":[{\"product_sku\":\"A001\"}]}}" },
  { seq: 5, worker: "mainagent", ts: "2026-11-18T10:04:00Z", kind: "tool_use", tool: "Grep", tool_use_id: "t2", summary: "rest-api 路由" },
  { seq: 6, worker: "mainagent", ts: "2026-11-18T10:04:02Z", kind: "tool_result", tool: "Grep", tool_use_id: "t2", summary: "2 文件 3 匹配", detail: "server/handler.go:41\nserver/router.go:18" },
  { seq: 7, worker: "mainagent", ts: "2026-11-18T10:05:00Z", kind: "tool_use", tool: "Read", tool_use_id: "t3", summary: "server/handler.go" },
  { seq: 8, worker: "mainagent", ts: "2026-11-18T10:05:02Z", kind: "tool_result", tool: "Read", tool_use_id: "t3", summary: "128 行", detail: "func (s *Server) handleCategoryProducts(...)" },
  { seq: 9, worker: "mainagent", ts: "2026-11-18T10:06:00Z", kind: "tool_use", tool: "Write", tool_use_id: "t4", summary: "poc/get_category_products.sh" },
  { seq: 10, worker: "mainagent", ts: "2026-11-18T10:06:02Z", kind: "tool_result", tool: "Write", tool_use_id: "t4", summary: "已写入 8 行" },
  { seq: 11, worker: "mainagent", ts: "2026-11-18T10:07:00Z", kind: "result", summary: "确认接口未鉴权，已登记漏洞 #1187" },
  { seq: 12, worker: "mainagent", ts: "2026-11-18T10:07:01Z", kind: "usage", summary: "3997M tok" },
];

export default function MapperPage() {
  const blocks = toBlocks(SAMPLE);
  const recorded = toBlocks(RECORDED_SHAPES);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>活动映射</h1>
      <p style={{ margin: "6px 0 20px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
        12 条样例活动 → {blocks.length} 个块。用于验证 tool_use / tool_result 配对与卡片选择。
      </p>

      <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 24 }}>
        <thead>
          <tr>
            {["seq", "块类型", "来源", "内容"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 12px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 500 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <tr key={block.seq}>
              <td style={{ padding: "5px 12px", color: "var(--dsw-alias-label-tertiary)" }}>{block.seq}</td>
              <td style={{ padding: "5px 12px" }}>{block.kind}</td>
              <td style={{ padding: "5px 12px", color: "var(--dsw-alias-label-tertiary)" }}>
                {"tool" in block ? block.tool : "—"}
              </td>
              <td style={{ padding: "5px 12px", maxWidth: 620, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {"text" in block ? block.text : "command" in block ? block.command : "label" in block ? block.label : "path" in block ? block.path : "query" in block ? block.query : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ margin: "28px 0 6px", fontSize: 15, fontWeight: 500 }}>真实形状解析</h2>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
        取自 data/transcripts/*.jsonl 里工具调用的真实 JSON 形状（Bash/Read/Glob/Edit/Write），验证 detail 能被解析出结构化字段。
      </p>
      <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 20 }}>
        <thead>
          <tr>
            {["seq", "块类型", "工具", "解析出的字段"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 12px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recorded.map((block) => {
            const activity = RECORDED_SHAPES.find((row) => row.seq === block.seq);
            const payload = activity === undefined ? {} : toolPayload(String(activity.tool ?? "").toLowerCase(), activity.detail);
            const fields = Object.entries(payload)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => key + "=" + (String(value).slice(0, 28) || "''"))
              .join(" · ");
            return (
              <tr key={block.seq}>
                <td style={{ padding: "5px 12px", color: "var(--dsw-alias-label-tertiary)" }}>{block.seq}</td>
                <td style={{ padding: "5px 12px" }}>{block.kind}</td>
                <td style={{ padding: "5px 12px", color: "var(--dsw-alias-label-tertiary)" }}>{"tool" in block ? block.tool : "—"}</td>
                <td style={{ padding: "5px 12px", fontFamily: "var(--ds-font-family-code, monospace)", fontSize: 11 }}>{fields === "" ? "（无 JSON detail）" : fields}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {blocks
        .filter((block) => block.kind === "terminal")
        .map((block) =>
          block.kind === "terminal" ? (
            <TerminalBlock
              key={block.seq}
              command={block.command}
              output={block.output}
              cwd="~/tasks/1107"
              exitCode={block.isError ? 1 : 0}
              labels={TERMINAL_LABELS}
            />
          ) : null,
        )}
    </main>
  );
}
