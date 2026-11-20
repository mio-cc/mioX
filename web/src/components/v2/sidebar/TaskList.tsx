"use client";

/**
 * 侧栏任务列表：把后端任务排成「置顶优先 + 所选排序字段 + 本地拖动顺序」的一列，
 * 并给每行提供真实的拖动把手（P1:A30）。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:267-305`（置顶判定与
 *   `compareTasks` 排序口径）、`:381-383`（排序应用）、`:2694-2707`（拖动把手按钮）。
 * DSH 依据：DSH 无侧栏拖动排序，按总表 §4「侧栏」扩展；行组件沿用
 *   `components/v2/sidebar/SessionRow.tsx`（ui-workspace/session-actions 的清单）。
 * 对照表行：P1:A30（拖动排序）、P1:A16（多选：`selectable` / `selectedIds` /
 *   `onSelectionChange` 三个可选属性，旧页 `page.tsx:930-935` 的表头全选与每行勾选框）、
 *   P1:A2（「当前 / 已归档」切换：`view` / `onViewChange` 两个可选属性，只在调用方传入时
 *   渲染切换条，旧页 `page.tsx:783-788` 的两个页签）。
 *
 * 本地顺序只存 `localStorage['v2.tasks.order']`（卡片指定）：后端没有排序字段，
 * 所以刷新后按本地顺序恢复，换设备不跟随。排序偏好也只存本地（旧页同口径）。
 */
import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";import { Menu } from "@/vendor/dsh/primitives/Menu";
import { IconChevronsUpDownOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { SessionRow, type Session } from "./SessionRow";
import { TaskListSwitch, type TaskListView } from "./TaskArchiveView";
import {
  applyTaskOrder,
  readTaskOrder,
  reorderTaskIds,
  sortTasks,
  writeTaskOrder,
  TASK_SORT_FIELD_LABEL,
  type TaskSortDirection,
  type TaskSortField,
  type TaskSortPreference,
} from "@/v2/data/tasks";
import type { Task } from "@/lib/types";
import css from "./TaskList.module.css";

/** 排序偏好的本地键（旧页 `page.tsx:262` 是 `artex_task_list_sort`，/v2 用自己的键）。 */
const SORT_PREFERENCE_KEY = "miox.v2.tasks.sort";

const DEFAULT_SORT: TaskSortPreference = { field: "created", direction: "desc" };

/**
 * 读取本地排序偏好；没有或损坏时用默认（创建时间倒序，与后端 `GET /tasks` 顺序一致）。
 * @returns 字段与方向。
 */
function readSortPreference(): TaskSortPreference {
  if (typeof window === "undefined") return DEFAULT_SORT;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SORT_PREFERENCE_KEY);
  } catch {
    return DEFAULT_SORT;
  }
  if (raw === null) return DEFAULT_SORT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SORT;
    const field = (parsed as { field?: unknown }).field;
    const direction = (parsed as { direction?: unknown }).direction;
    const fieldOk = field === "id" || field === "created" || field === "duration" || field === "status";
    const directionOk = direction === "asc" || direction === "desc";
    if (!fieldOk || !directionOk) return DEFAULT_SORT;
    return { field, direction };
  } catch {
    return DEFAULT_SORT;
  }
}

/**
 * 写本地排序偏好；写不进去不影响本次会话。
 * @param preference - 字段与方向。
 */
function writeSortPreference(preference: TaskSortPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SORT_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // 隐私模式 / 配额：本次会话仍然按新偏好排序。
  }
}

const SORT_FIELD_ORDER: readonly TaskSortField[] = ["created", "id", "duration", "status"];

/**
 * 行外壳：把拖动把手挂到这一行左侧，行本体仍是 `SessionRow`。
 * 只有把手能开始拖动，行点击 / 行内菜单不受影响。
 * @returns 可排序的一行。
 */
function SortableTaskRow({
  session,
  active,
  onSelect,
  onChange,
  selectable,
  selected,
  onSelectedChange,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Session> | "remove") => void;
  selectable: boolean;
  selected: boolean;
  onSelectedChange: (id: string, next: boolean) => void;
}): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={css.sortable} data-task-drag-id={session.id}>
      <button
        type="button"
        className={css.grip}
        aria-label={`拖动任务 ${session.label}`}
        title="拖动任务"
        // 按住把手才拖动；行点击/右键不受影响（listeners 只在把手上）。
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <div className={css.rowBody}>
        <SessionRow
          session={session}
          active={active}
          onSelect={onSelect}
          onChange={onChange}
          selectable={selectable}
          selected={selected}
          onSelectedChange={(next) => onSelectedChange(session.id, next)}
        />
      </div>
    </div>
  );
}

export interface TaskListProps {
  /** 已读到的任务；`null` 表示还没读到（渲染四态由调用方决定，这里只画列表）。 */
  tasks: readonly Task[];
  /** 当前选中的任务 id。 */
  activeId: string | null;
  /** 选中一行。 */
  onSelect: (id: string) => void;
  /** 行内动作（置顶 / 重命名 / 归档…），由调用方落到真实接口。 */
  onChange: (id: string, patch: Partial<Session> | "remove") => void;
  /** 行内字段投影，调 `tasksToSessions`。 */
  toSession: (task: Task) => Session;
  /** C10（P1:A16）：多选模式开关；打开后每行左侧出现勾选框，点行只切勾选。 */
  selectable?: boolean;
  /** C10：已勾选的任务 id。 */
  selectedIds?: ReadonlySet<string>;
  /** C10：勾选状态变化（id + 新状态）。 */
  onSelectionChange?: (id: string, next: boolean) => void;
  /** C12（P1:A2）：「当前 / 已归档」视图；不传就不渲染切换条（由调用方决定谁持有视图状态）。 */
  view?: TaskListView;
  /** C12：切换视图（纯本地动作）。 */
  onViewChange?: (next: TaskListView) => void;
}

/**
 * 渲染可拖动排序的任务列表。
 * @returns 排序菜单 + 列表本体。
 */
export function TaskList({
  tasks,
  activeId,
  onSelect,
  onChange,
  toSession,
  selectable = false,
  selectedIds,
  onSelectionChange,
  view,
  onViewChange,
}: TaskListProps): React.ReactNode {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  // 首帧不读 localStorage（服务端没有它，读会破坏 hydration），挂载后一次性读入。
  const [order, setOrder] = React.useState<string[]>([]);
  const [preference, setPreference] = React.useState<TaskSortPreference>(DEFAULT_SORT);
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);
  // 拖动后到 `onChange` 重新读列表之前的这段时间按本地顺序显示，避免列表跳回原样。
  const [pending, setPending] = React.useState<Task[] | null>(null);

  const didLoad = React.useRef(false);
  React.useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    setOrder(readTaskOrder());
    setPreference(readSortPreference());
  }, []);

  const nowUnix = Math.floor(Date.now() / 1000);
  const base = pending ?? tasks;
  const sorted = applyTaskOrder(sortTasks(base, preference, nowUnix), order);
  const visibleIds = sorted.map((task) => task.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = visibleIds.indexOf(String(active.id));
    const to = visibleIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    // 拖动结果 = 把被拖行放到落点行的位置，再换算成完整的本地顺序。
    const moved = arrayMove(visibleIds, from, to);
    const dragged = String(active.id);
    const after = moved.indexOf(dragged);
    const beforeId = after + 1 < moved.length ? moved[after + 1] : null;
    const nextOrder = reorderTaskIds(order, visibleIds, dragged, beforeId);
    setOrder(nextOrder);
    writeTaskOrder(nextOrder);
    setPending(arrayMove(sorted, from, to));
  };

  const sortItems = [
    ...SORT_FIELD_ORDER.map((field) => ({
      id: `field:${field}`,
      label: `按${TASK_SORT_FIELD_LABEL[field]}`,
      disabled: preference.field === field,
    })),
    {
      id: "toggle",
      label: preference.direction === "desc" ? "改为升序" : "改为降序",
      separatorBefore: true,
    },
    { id: "reset", label: "恢复默认排序（创建时间倒序）", separatorBefore: true },
  ];

  const runSort = (id: string): void => {
    setSortMenuOpen(false);
    let next = preference;
    if (id === "toggle") next = { ...preference, direction: preference.direction === "asc" ? "desc" : "asc" };
    else if (id === "reset") next = DEFAULT_SORT;
    else if (id.startsWith("field:")) {
      const field = id.slice("field:".length);
      const fieldOk = field === "id" || field === "created" || field === "duration" || field === "status";
      if (!fieldOk) return;
      // 换字段时方向回到倒序（旧页 `sortTasksBy` 同口径，page.tsx:385-393）。
      next = { field, direction: "desc" };
    }
    setPreference(next);
    writeSortPreference(next);
  };

  if (!mounted) return null;

  return (
    <div className={css.wrap} data-task-list-sort={`${preference.field}:${preference.direction}`}>
      {/* C12 P1:A2：调用方给了视图与切换回调才画切换条；「已归档」的列表本体由
          `TaskArchiveView` 渲染，所以这里只在「当前」视图给切换条留位置。 */}
      {onViewChange === undefined ? null : (
        <TaskListSwitch value={view ?? "current"} onChange={onViewChange} />
      )}
      <div className={css.sortBar}>
        <Menu
          open={sortMenuOpen}
          anchor={
            <button
              type="button"
              className={css.sortBtn}
              aria-label="任务排序方式"
              title="任务排序方式"
              onClick={() => setSortMenuOpen((v) => !v)}
            >
              <IconChevronsUpDownOutlineRegular size={12} />
              排序：{TASK_SORT_FIELD_LABEL[preference.field]}·{preference.direction === "asc" ? "升序" : "降序"}
            </button>
          }
          items={sortItems}
          onSelect={runSort}
          onClose={() => setSortMenuOpen(false)}
        />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          {sorted.map((task) => {
            const session = toSession(task);
            return (
              <SortableTaskRow
                key={task.id}
                session={session}
                active={activeId === task.id}
                onSelect={() => onSelect(task.id)}
                onChange={(patch) => onChange(task.id, patch)}
                selectable={selectable}
                selected={selectedIds?.has(task.id) === true}
                onSelectedChange={(id, next) => onSelectionChange?.(id, next)}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}
