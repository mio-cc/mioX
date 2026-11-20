"use client";

/**
 * 侧栏任务列表的分类分组（C11 · P1:A26 的「分类分组」一半、P1:A27 的行内「移入分类」）。
 *
 * 分组口径：任务上的 `Task.category_name` / `Task.category_id`（`lib/types.ts:10-11`）决定归属，
 * 组头显示分类名与任务数，可折叠；折叠状态只存 `localStorage['miox.v2.tasks.categories.collapsed']`
 * （后端没有「分类折叠」这种用户偏好字段，属纯本地展示状态）。
 * 行内「移入分类」/「移出分类」走真实接口：`PATCH /tasks/{id}/category`（经
 * `v2/data/task-categories.ts` 的 `moveTaskToCategory` → `api.updateTaskCategory`，
 * api.ts:331）；成功后由调用方 `useTasks().reload()` 重读列表。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/_harness/task-list.tsx:193-308`（按 `category_id`
 *   过滤）、`page.tsx:2742-3060`（分类管理里的分组与移动）、`:2857-2900`（单任务改分类 → `api.updateTaskCategory`）。
 * DSH 依据：DSH 没有任务分类，侧栏不分组；按总表 §4「侧栏」扩展成可折叠分组，
 *   组头样式沿用 `ui-sidebar` 的 section 标题行（`--dsw-alias-label-tertiary` + 展开箭头）。
 * 对照表行：P1:A26 P1:A27 P1:A16（多选透传：`selectable` / `selectedIds` /
 *   `onSelectionChange` 三个可选属性，原样交给每行的 `SessionRow`）。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { IconChevronDownOutlineRegular, IconChevronRightOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import type { TaskCategory } from "@/lib/types";
import { moveTaskToCategory, UNCATEGORIZED_LABEL, type TaskCategoryGroup } from "@/v2/data/task-categories";
import { toast } from "../settings/Toast";
import { SessionRow, type Session } from "./SessionRow";
import css from "./TaskCategoryGroups.module.css";

/** 折叠状态的本地键；只影响显示，不影响后端数据。 */
const COLLAPSED_STORAGE_KEY = "miox.v2.tasks.categories.collapsed";

/**
 * 读取折叠的分组 key 列表；没有或损坏时返回空数组（全部展开）。
 * @returns 折叠的分组 key。
 */
function readCollapsed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/**
 * 写入折叠的分组 key 列表；写不进去不影响本次会话。
 * @param keys - 折叠的分组 key。
 */
function writeCollapsed(keys: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // 隐私模式 / 配额：本次会话仍然按新状态折叠。
  }
}

export interface TaskCategoryGroupsProps {
  /** 分组结果，来自 `groupTasksByCategory`。 */
  groups: readonly TaskCategoryGroup[];
  /** 所有分类（行内「移入分类」的菜单项），用于把任务移到别的分类。 */
  categories: readonly TaskCategory[];
  /** 当前选中的任务 id。 */
  activeId: string | null;
  /** 选中一行。 */
  onSelect: (id: string) => void;
  /** 行内其它动作（置顶 / 重命名 / 归档），原样透传给 `SessionRow`。 */
  onChange: (id: string, patch: Partial<Session> | "remove") => void;
  /** 行内字段投影，调 `tasksToSessions`。 */
  toSession: (id: string) => Session;
  /** 分类移动成功后让调用方重读任务列表。 */
  onTaskMoved: () => void;
  /** C10（P1:A16）：多选模式开关；打开后每行左侧出现勾选框（组头也有全选）。 */
  selectable?: boolean;
  /** C10：已勾选的任务 id。 */
  selectedIds?: ReadonlySet<string>;
  /** C10：勾选状态变化（id + 新状态）。 */
  onSelectionChange?: (id: string, next: boolean) => void;
}

/**
 * 渲染按分类分组的任务列表（组头可折叠 + 行内改分类）。
 * @returns 分组列表；分组为空时调用方负责画空状态。
 */
export function TaskCategoryGroups({
  groups,
  categories,
  activeId,
  onSelect,
  onChange,
  toSession,
  onTaskMoved,
  selectable = false,
  selectedIds,
  onSelectionChange,
}: TaskCategoryGroupsProps): React.ReactNode {
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const [mounted, setMounted] = React.useState(false);
  // 移动中的任务 id：按钮忙碌、避免连点发出两次 PATCH。
  const [moving, setMoving] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCollapsed(readCollapsed());
    setMounted(true);
  }, []);

  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      writeCollapsed(next);
      return next;
    });
  };

  const move = (taskId: string, categoryId: number | null): void => {
    if (moving !== null) return;
    setMoving(taskId);
    moveTaskToCategory(taskId, categoryId === null ? undefined : categoryId)
      .then(() => {
        setMoving(null);
        toast(categoryId === null ? "已移出分类" : "已移入分类");
        onTaskMoved();
      })
      .catch((reason: unknown) => {
        setMoving(null);
        toast(`移到分类失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  // 首帧不读 localStorage（服务端没有它，读会破坏 hydration），挂载后一次性读入。
  if (!mounted) return null;

  return (
    <div className={css.wrap} data-task-category-groups="">
      {groups.map((group) => {
        const isCollapsed = collapsed.includes(group.key);
        return (
          <section className={css.group} key={group.key} data-task-category-group={group.key}>
            <div className={css.groupHead}>
              <button
                type="button"
                className={css.groupToggle}
                aria-expanded={!isCollapsed}
                data-task-category-toggle={group.key}
                onClick={() => toggle(group.key)}
              >
                {isCollapsed ? (
                  <IconChevronRightOutlineRegular size={11} />
                ) : (
                  <IconChevronDownOutlineRegular size={11} />
                )}
                <span className={css.groupName} title={group.name}>
                  {group.name}
                </span>
                <span className={css.groupCount}>{group.tasks.length}</span>
              </button>
            </div>
            {isCollapsed
              ? null
              : group.tasks.map((task) => {
                  const session = toSession(task.id);
                  return (
                    <div className={css.rowWrap} key={task.id}>
                      <SessionRow
                        session={session}
                        active={activeId === task.id}
                        onSelect={() => onSelect(task.id)}
                        onChange={(patch) => onChange(task.id, patch)}
                        selectable={selectable}
                        selected={selectedIds?.has(task.id) === true}
                        onSelectedChange={(next) => onSelectionChange?.(task.id, next)}
                      />
                      <MoveCategoryMenu
                        taskId={task.id}
                        currentCategoryId={group.categoryId}
                        categories={categories}
                        busy={moving === task.id}
                        onMove={(categoryId) => move(task.id, categoryId)}
                      />
                    </div>
                  );
                })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * 行内「移入分类」按钮：展开一个真实分类菜单，点选后立刻 PATCH 该任务的分类。
 * 后端没有「批量移分类」以外的额外字段，菜单项就是 `GET /task-categories` 的原样列表 + 未分类。
 * @returns 小按钮 + 菜单。
 */
function MoveCategoryMenu({
  taskId,
  currentCategoryId,
  categories,
  busy,
  onMove,
}: {
  taskId: string;
  currentCategoryId: number | null;
  categories: readonly TaskCategory[];
  busy: boolean;
  onMove: (categoryId: number | null) => void;
}): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const items = [
    {
      id: "none",
      label: UNCATEGORIZED_LABEL,
      disabled: currentCategoryId === null,
    },
    ...categories.map((category) => ({
      id: String(category.id),
      label: category.name,
      disabled: currentCategoryId === category.id,
    })),
  ];

  return (
    <span className={css.moveSeat}>
      <Menu
        open={open}
        anchor={
          <Button
            variant="ghost"
            size="sm"
            className={css.moveBtn}
            disabled={busy}
            aria-label={`移动任务 ${taskId} 到分类`}
            title="移入分类"
            data-task-category-move={taskId}
            onMouseDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
            }}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
          >
            分类
          </Button>
        }
        items={items}
        selectedId={currentCategoryId === null ? "none" : String(currentCategoryId)}
        selection="check"
        onSelect={(id) => {
          setOpen(false);
          onMove(id === "none" ? null : Number(id));
        }}
        onClose={() => setOpen(false)}
      />
    </span>
  );
}
