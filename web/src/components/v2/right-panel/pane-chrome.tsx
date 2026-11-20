"use client";

/**
 * 右栏「资产」「证据」两个补充页签共用的 chrome（单元 C23，对照表 P1:E8）。
 * 结构照抄同目录 `Panes.tsx:54-111` 的 `PaneHeader` / `ToolButton` / `EmptyState` / `LoadingRows`
 * （那四个只在该文件内部可见，不 export），样式类走同一个 `Panes.module.css`，
 * 所以六个页签的头行高度、空态排版、骨架行完全一致。
 * DSH 依据：`ui-sidebar-files FilesBody.tsx:63-116`、`FilesBody.module.css:162-180`。
 */
import * as React from "react";

import css from "./Panes.module.css";

/** The pane's header row: context on the left, controls on the right. */
export function PaneHeader({ children, actions }: {
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
}): React.ReactNode {
  return (
    <div className={css.header}>
      <div className={css.headerMain}>{children}</div>
      {actions === undefined ? null : <div className={css.headerActions}>{actions}</div>}
    </div>
  );
}

/** A 28px icon control in the pane header, matching the files page's tools. */
export function ToolButton({ label, onClick, children }: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.ReactNode {
  return (
    <button type="button" className={css.tool} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** A centred state for loading failures and empty lists. */
export function EmptyState({ icon, title, hint }: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly hint?: string;
}): React.ReactNode {
  return (
    <div className={css.empty}>
      <span className={css.emptyIcon} aria-hidden="true">{icon}</span>
      <span className={css.emptyTitle}>{title}</span>
      {hint === undefined ? null : <span className={css.emptyHint}>{hint}</span>}
    </div>
  );
}

/** Placeholder rows while a list is being read. */
export function LoadingRows({ count }: { readonly count: number }): React.ReactNode {
  return (
    <div className={css.scroll} aria-busy="true">
      <div className={css.list}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className={css.skeletonRow} aria-hidden="true">
            <span className={css.skeletonTag} />
            <span className={css.skeletonLine} />
            <span className={css.skeletonMeta} />
          </div>
        ))}
      </div>
      <span className={css.srOnly} role="status">加载中</span>
    </div>
  );
}

