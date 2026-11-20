"use client";

/**
 * 设置弹窗的「行」容器：左侧 label + 可选 hint，右侧控件。
 * 从 SettingsDialog.tsx 的本地 Row 抽出来共用（C22），结构、类名与渲染结果完全一致。
 * 旧页面依据：components/settings/settings-dialog.tsx 的 group/row 布局（label 左、控件右）。
 * DSH 依据：ui-settings-general/src/client 的 label + hint 行（与 SettingsDialog.tsx 现状同款）。
 * 对照表行：P3:S11 P3:S12 P3:B4 P3:B7
 */
import * as React from "react";

import css from "./SettingsDialog.module.css";

/**
 * 渲染一行设置。
 * @param props.label - 行标题。
 * @param props.hint - 可选的说明文字。
 * @param props.children - 右侧控件。
 * @returns 行元素。
 */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.rowLabel}>{label}</div>
        {hint ? <div className={css.rowHint}>{hint}</div> : null}
      </div>
      <div className={css.rowControl}>{children}</div>
    </div>
  );
}
