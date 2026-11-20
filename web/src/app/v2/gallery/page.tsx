"use client";

/**
 * Phase 0 gallery: renders the vendored DSH primitives on a /v2 route so the
 * port can be compared against ui-lab's `?gallery` view. Not product UI.
 *
 * Imports go to individual modules rather than the primitives barrel: the barrel
 * pulls `markdown/highlight.ts`, whose `@shikijs/langs*` dynamic imports are not
 * installed in ARTEX yet. Resolving syntax highlighting is a separate decision.
 */
import { useEffect, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Pill } from "@/vendor/dsh/primitives/Pill";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { StateDot } from "@/vendor/dsh/primitives/StateDot";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { Toast } from "@/vendor/dsh/primitives/Toast";
import { ThemeToggle } from "@/components/v2/theme-toggle";
import {
  IconCheckOutlineRegular,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

const SECTION: React.CSSProperties = {
  marginBottom: 32,
  paddingBottom: 24,
  borderBottom: "0.5px solid var(--dsw-alias-border-l1, #e5e7eb)",
};
const LABEL: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 12,
  color: "var(--dsw-alias-label-tertiary, #6b7280)",
};

export default function GalleryPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(false);
  const [segment, setSegment] = useState("a");
  const [toastOn, setToastOn] = useState(false);
  // Menu reads document during render, so it must not run on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 48px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>组件画廊</h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
            验证 vendored DSH primitives 在 ARTEX /v2 下渲染正确。
          </p>
        </div>
        <ThemeToggle />
      </div>
      <div style={{ height: 24 }} />

      <section style={SECTION}>
        <h2 style={LABEL}>按钮</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="primary" size="sm">主要按钮</Button>
          <Button variant="outline" size="sm">次要按钮</Button>
          <Button variant="outline" size="sm" disabled>禁用</Button>
          <Button variant="outline" size="sm">
            <IconPlusOutlineRegular size={14} /> 带图标
          </Button>
        </div>
      </section>

      <section style={SECTION}>
        <h2 style={LABEL}>输入控件</h2>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Input value="" onChange={() => undefined} placeholder="输入内容" aria-label="示例输入" />
          <Checkbox checked={checked} onChange={setChecked} label="复选框" />
          <Switch checked={switched} onChange={setSwitched} label="开关" />
          <SegmentedControl
            id="gallery-segment"
            label="分段"
            value={segment}
            onChange={setSegment}
            options={[
              { value: "a", label: "选项 A" },
              { value: "b", label: "选项 B" },
              { value: "c", label: "选项 C" },
            ]}
          />
        </div>
      </section>

      <section style={SECTION}>
        <h2 style={LABEL}>标签与状态</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Tag tone="neutral">中性</Tag>
          <Tag tone="danger">高危</Tag>
          <Tag tone="warning">中危</Tag>
          <Tag tone="outline">低危</Tag>
          <Pill>预览版</Pill>
          <StateDot state="done" />
          <StateDot state="ongoing" />
          <StateDot state="error" />
        </div>
      </section>

      <section style={SECTION}>
        <h2 style={LABEL}>表格</h2>
        <table style={{ width: "100%", maxWidth: 720, borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              {["类型", "资产", "来源", "覆盖"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--dsw-alias-label-tertiary, #6b7280)",
                    borderBottom: "0.5px solid var(--dsw-alias-border-l1, #e5e7eb)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["站点", "huoxingai.shop", "ScopeSentry", "63%"],
              ["接口", "/rest-api/getCategoryProducts", "探索发现", "100%"],
              ["主机", "10.0.8.14", "手工导入", "0%"],
            ].map((row) => (
              <tr key={row[1]}>
                {row.map((cell) => (
                  <td
                    key={cell}
                    style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--dsw-alias-border-l1, #e5e7eb)" }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ ...SECTION, borderBottom: 0 }}>
        <h2 style={LABEL}>浮层</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>打开 Modal</Button>
          {mounted ? (
            <Menu
              open={menuOpen}
              anchor={
                <Button variant="outline" size="sm" onClick={() => setMenuOpen((v) => !v)}>
                  <IconSearchOutlineRegular size={14} /> 打开菜单
                </Button>
              }
              items={[
                { id: "a", label: "第一项" },
                { id: "b", label: "第二项" },
                { id: "c", label: "第三项" },
              ]}
              onSelect={() => setMenuOpen(false)}
              onClose={() => setMenuOpen(false)}
            />
          ) : (
            <Button variant="outline" size="sm">
              <IconSearchOutlineRegular size={14} /> 打开菜单
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setToastOn(true)}>显示 Toast</Button>
        </div>
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        closeLabel="关闭"
        title="示例弹窗"
        description="验证 Modal 在 /v2 下的样式与遮罩。"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>取消</Button>
            <Button variant="primary" size="sm" onClick={() => setModalOpen(false)}>
              <IconCheckOutlineRegular size={14} /> 确定
            </Button>
          </>
        }
      >
        <div style={{ fontSize: 13 }}>弹窗内容区域。</div>
      </Modal>

      {toastOn ? <Toast text="这是一条 Toast 提示" holdMs={3000} onDone={() => setToastOn(false)} /> : null}
    </main>
  );
}
