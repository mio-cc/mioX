"use client";

/**
 * 侧栏任务列表的多选模式开关（P1:A16）：一个「选择」按钮进入多选，进入后变成「完成」，
 * 旁边给「全选」/「清空」。勾选本体在每行（`SessionRow` 的 `selectable` / `selected`）。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:929-935`（表头「选择本页全部任务」
 *   勾选框）、`:845-849`（工具条的「已选 N 个 / 取消选择」）。旧页把全选放在表头，/v2 侧栏没有表头，
 *   所以全选放在这个开关条里，入口收进「工作区」行的操作区。
 * DSH 依据：DSH 无侧栏多选，按总表 §4「侧栏」扩展；按钮用 `Button`、勾选框用 `Checkbox`。
 * 对照表行：P1:A16。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { IconChecklistOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./TaskBulkBar.module.css";

export interface TaskSelectToggleProps {
  /** 多选模式是否打开。 */
  active: boolean;
  /** 打开 / 关闭多选模式。 */
  onToggle: (next: boolean) => void;
  /** 当前列表里可选的任务总数（已按搜索 / 收起过滤，由调用方决定）。 */
  total: number;
  /** 已勾选条数。 */
  selected: number;
  /** 勾选 / 取消勾选全部。 */
  onSelectAll: (next: boolean) => void;
  /** 清单为空时禁用（没有可选的任务）。 */
  disabled?: boolean;
}

/**
 * 渲染多选模式开关。
 * @returns 触发按钮（未进入多选）或「完成 + 全选 + 计数」（已进入多选）。
 */
export function TaskSelectToggle({
  active,
  onToggle,
  total,
  selected,
  onSelectAll,
  disabled = false,
}: TaskSelectToggleProps): React.ReactNode {
  if (!active) {
    return (
      <button
        type="button"
        className={css.toggleBtn}
        aria-label="多选任务"
        aria-pressed={false}
        title="多选任务"
        disabled={disabled}
        data-task-multiselect-toggle=""
        onClick={() => onToggle(true)}
      >
        <IconChecklistOutlineRegular size={13} />
      </button>
    );
  }

  const allSelected = total > 0 && selected === total;

  return (
    <span className={css.toggleGroup} data-task-multiselect-toggle="on">
      <Checkbox
        checked={allSelected}
        label="全选"
        title="全选当前列表里的任务"
        onChange={(next) => onSelectAll(next)}
        className={css.allCheck}
      />
      <Button variant="ghost" size="sm" className={css.doneBtn} onClick={() => onToggle(false)}>
        完成
      </Button>
    </span>
  );
}
