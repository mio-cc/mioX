import type { ReactNode } from "react";

import Link from "next/link";

/**
 * /v2 index: one entry per migrated surface, so the port can be reviewed without
 * remembering probe URLs. Not product UI.
 */
const SURFACES: { href: string; title: string; note: string; data: "已接" | "离线可看" | "静态" }[] = [
  { href: "/v2/shell", title: "整体外壳", note: "三栏布局 + 消息流 + Composer + 右栏（含断点与抽屉）", data: "静态" },
  { href: "/v2/gallery", title: "组件画廊", note: "按钮 / 输入 / 标签 / 表格 / 浮层，含深色切换", data: "静态" },
  { href: "/v2/thread", title: "工具卡", note: "Terminal / Diff / Search / Read 四张卡", data: "静态" },
  { href: "/v2/assets", title: "资产", note: "资产清单：类型 / 资产 / 关联任务 / 最近出现", data: "已接" },
  { href: "/v2/traffic", title: "流量", note: "抓包记录；采集关闭时明确提示而不是空表", data: "已接" },
  { href: "/v2/mapper", title: "活动映射", note: "activity 流 → 工具卡 的纯映射验证（12 条样例 → 7 个块）", data: "静态" },
  { href: "/v2/composer", title: "输入区", note: "模型选择、权限档、/ 指令、@ 引用、目标横幅、计划预览", data: "静态" },
  { href: "/v2/sidebar", title: "侧栏构件", note: "会话行三种状态 + 工作区流程", data: "静态" },
  { href: "/v2/right-panel", title: "右栏", note: "文件 / 会话 / 审批 / 发现", data: "静态" },
  { href: "/v2/settings", title: "设置弹窗", note: "8 页导航；通用页已接真实 GET /settings", data: "离线可看" },
];

export default function V2IndexPage(): ReactNode {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "48px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>v2 迁移预览</h1>
      <p style={{ margin: "6px 0 24px", fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
        从 ui-lab 迁入的界面。数据层尚未接通（Go 后端未启动时显示离线态）。
      </p>

      <div style={{ display: "grid", gap: 10, maxWidth: 760 }}>
        {SURFACES.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "14px 16px",
              border: "0.5px solid var(--dsw-alias-border-l1, #e5e7eb)",
              borderRadius: 12,
              background: "var(--dsw-alias-bg-layer-1, #f7f7f8)",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{item.title}</span>
              <span
                style={{
                  fontSize: 10.5,
                  padding: "1px 6px",
                  borderRadius: 4,
                  border: "0.5px solid var(--dsw-alias-border-l2, #e5e7eb)",
                  color: item.data === "已接" ? "var(--dsw-alias-text-success, #2f9e44)" : "var(--dsw-alias-label-tertiary, #6b7280)",
                }}
              >
                {item.data}
              </span>
            </span>
            <span style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>{item.note}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
