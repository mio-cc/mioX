"use client";

/**
 * Session-header「自动化时钟」utility（DX-S3）。
 *
 * 只有当前任务存在 enabled 的自动化才渲染：镜像 `jobs-chip` 的自隐策略——条目保持
 * 注册（`headerSlotContributions.tsx` 的 `SCHEDULE_CLOCK_UTILITY`），这里在无数据时
 * 返回 null。数据走 `v2/data/automations.ts` 适配器（`GET /api/automations?task_id=`，
 * 15s 轮询 ≤30s），组件不直接 import `@/lib/api`。
 *
 * 点击：1 个 → 直接跳 `?page=automations&automation=<id>`（页面定位到该行）；
 * 多个 → Menu 列出标题与下次运行时间，点项跳页。
 */
import { useState } from "react";

import { formatWhen, openAutomationsPage, useAutomations } from "@/v2/data/automations";
import { IconClockOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Menu, type MenuEntry } from "@/vendor/dsh/primitives/Menu";
import { Tooltip } from "@/vendor/dsh/primitives/Tooltip";

import css from "./ConversationRoot.module.css";

/** 停用 / 读失败时静默隐藏：头部不是报错的地方（同 `Shell.tsx` UpdateBadge 的策略）。 */
const HIDDEN_PHASES = new Set(["loading", "offline"]);

/**
 * Render the clock button（单条直跳，多条带菜单）。
 * @param props.taskId - 当前任务 id，列表按 task_id 过滤。
 * @returns the utility button, or null without an enabled automation.
 */
export function ScheduleClock({ taskId }: { readonly taskId: string }): React.ReactNode {
  const state = useAutomations(taskId);
  const [open, setOpen] = useState(false);
  if (HIDDEN_PHASES.has(state.phase)) return null;
  const enabled = state.automations.filter((row) => row.enabled);
  if (enabled.length === 0) return null;

  const tooltip = `本任务有 ${enabled.length} 个自动化`;
  const go = (id: string): void => {
    setOpen(false);
    openAutomationsPage(id);
  };

  if (enabled.length === 1) {
    const row = enabled[0];
    return (
      <Tooltip label={tooltip} side="bottom">
        <button
          type="button"
          className={css.headerMenuButton}
          aria-label={tooltip}
          title={tooltip}
          data-automation-clock={enabled.length}
          onClick={() => go(row.id)}
        >
          <IconClockOutlineRegular size={16} />
        </button>
      </Tooltip>
    );
  }

  const items: MenuEntry[] = enabled.map((row) => ({
    id: row.id,
    label: `${row.title}${row.next_run_at === null ? "" : ` · 下次 ${formatWhen(row.next_run_at)}`}`,
  }));
  return (
    <Menu
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      onSelect={(id) => {
        const row = enabled.find((item) => item.id === id);
        if (row !== undefined) go(row.id);
      }}
      items={items}
      align="start"
      side="bottom"
      portal
      listClassName={css.moreMenu}
      anchor={
        <button
          type="button"
          className={css.headerMenuButton}
          aria-label={tooltip}
          title={tooltip}
          aria-haspopup="menu"
          aria-expanded={open}
          data-automation-clock={enabled.length}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <IconClockOutlineRegular size={16} />
        </button>
      }
    />
  );
}
