"use client";

/**
 * 车道切换（P1:B25 / P1:B27 / P1:B28）：一个紧凑触发器 + 下拉菜单。
 *
 * 旧页面依据：`task-workspace-dsh.tsx:2702-2734`（会话下拉把车道分成
 * mainagent / planner / worker 三组，选中即换数据源）、
 * `_tabs/sessions-tab.tsx:1233-1259,1655-1729`（按名字选具体车道，主 Agent 组
 * 带「新建」、Worker 行带状态）。
 *
 * 形态取 DSH 的「一个触发器 + Menu」机制，与
 * `dsh-upstream/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:28-44`
 * 的 ViewsMoreMenu 同构；不再用 SegmentedControl —— 三段只占菜单里一行，触发器
 * 回到 tab 行右端，会话头因此只保留一行 View tab（`102-UI-UX规范.md` §7.3）。
 *
 * 菜单内容按 mioX 自己的需要分组：
 *   1. 三段（主 Agent / 规划 Planner / Workers），没有车道的那段禁用；
 *   2. 「新建主会话」（P1:B27，旧页 `/new`，`:2496-2505`）；
 *   3. 具体车道（P1:B28），每个 Worker 一行带状态；超过 12 个 Worker 时只提示
 *      剩余条数，不伪造数据。
 *   4. 车道列表的读取中 / 失败（可重试）/ 空三态（`102-UI-UX规范.md` §8）。
 *
 * 对照表行：P1:B25 P1:B27 P1:B28
 */
import { type ReactNode, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { IconChevronDownOutlineRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { MenuEntry } from "@/vendor/dsh/primitives/Menu";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import {
  intentStateLabel,
  LANE_GROUP_LABEL,
  mainSegOf,
  type SessionLane,
  type SessionLaneGroup,
} from "@/v2/data/sessions";

import css from "./SessionLaneSwitcher.module.css";

/** 控件取值：三段各一条车道，`null` 表示这一类当前没有车道。 */
export type LaneSegmentValue = "main" | "planner" | "worker";

export interface SessionLaneSwitcherProps {
  /** 当前段（由所选车道反推）。 */
  readonly value: LaneSegmentValue;
  /** 选一段。 */
  readonly onChange: (segment: LaneSegmentValue) => void;
  /** 每段是否可用（无车道 → 不能选）。 */
  readonly available: Readonly<Record<LaneSegmentValue, boolean>>;
  /** 每段的补充说明，用作触发器 title。 */
  readonly titles?: Readonly<Record<LaneSegmentValue, string>>;
  /** 车道列表读取中：触发器显示读取态并禁用。 */
  readonly loading: boolean;
  /** 车道列表（P1:B28 的具体车道行）；缺省为空。 */
  readonly lanes?: readonly SessionLane[];
  /** 后端当前（可写的）主 Agent 分段号，用于标出「当前写入」。 */
  readonly current?: number;
  /** 当前选中的车道键；`null` 或缺省是合并视图。 */
  readonly selected?: string | null;
  /** 按名字选一条车道（P1:B28）。 */
  readonly onSelectLane?: (key: string) => void;
  /** 新建主会话（P1:B27）。 */
  readonly onNewMain?: () => void;
  /** 新建请求进行中。 */
  readonly creating?: boolean;
  /** 车道列表读取失败的原因；非空时菜单里给出原因与重试。 */
  readonly error?: string | null;
  /** 重新读取车道列表。 */
  readonly onRetry?: () => void;
}

/** 段顺序与标签，照旧页分组顺序（mainagent → planner → worker）。 */
const SEGMENTS: readonly { value: LaneSegmentValue; group: SessionLaneGroup }[] = [
  { value: "main", group: "mainagent" },
  { value: "planner", group: "planner" },
  { value: "worker", group: "worker" },
];

/** 菜单里最多列出的 Worker 行数，超出部分只提示条数（旧页同样分页）。 */
const WORKER_ROW_LIMIT = 12;

/**
 * 一条车道右侧的状态文字，语义照旧页组内标注（`sessions-tab.tsx:1665-1691`）。
 * @param lane - 车道。
 * @param current - 后端当前可写的主 Agent 分段号。
 * @returns 状态文案。
 */
function laneStateText(lane: SessionLane, current: number): string {
  if (lane.group === "worker") return intentStateLabel(lane.state);
  if (lane.group === "mainagent") return mainSegOf(lane.key) === current ? "当前写入" : "历史分段";
  return "只读";
}

/**
 * 渲染车道触发器与它的菜单。
 * @param props - 当前段、切换回调、车道列表与新建回调、四态标志。
 * @returns tab 行右端的车道菜单。
 */
export function SessionLaneSwitcher(props: SessionLaneSwitcherProps): ReactNode {
  const [open, setOpen] = useState(false);
  const lanes = props.lanes ?? [];
  const current = props.current ?? 0;
  const selected = props.selected ?? null;
  const segment = SEGMENTS.find((entry) => entry.value === props.value) ?? SEGMENTS[0];
  const group = segment?.group ?? "mainagent";

  const workers = lanes.filter((lane) => lane.group === "worker");
  const shownWorkers = workers.slice(0, WORKER_ROW_LIMIT);
  const listedLanes = [...lanes.filter((lane) => lane.group !== "worker"), ...shownWorkers];
  const hiddenWorkers = workers.length - shownWorkers.length;

  /** 三段 → 分隔线 → 新建主会话 → 具体车道。 */
  const entries: MenuEntry[] = SEGMENTS.map((entry) => ({
    id: `segment:${entry.value}`,
    label: LANE_GROUP_LABEL[entry.group],
    disabled: props.available[entry.value] !== true,
  }));
  entries.push({ type: "separator", id: "lane-actions" });
  entries.push({
    id: "new-main",
    label: props.creating === true ? "创建中…" : "新建主会话",
    disabled: props.creating === true || props.onNewMain === undefined,
  });
  if (listedLanes.length > 0 && props.onSelectLane !== undefined) {
    entries.push({ type: "separator", id: "lane-list" });
    entries.push({ type: "label", id: "lane-list-heading", text: "按名称选择" });
    for (const lane of listedLanes) {
      entries.push({
        id: `lane:${lane.key}`,
        label: (
          <span className={css.laneRow}>
            <span className={css.laneRowTitle}>{lane.label}</span>
            <span className={css.laneRowState}>{laneStateText(lane, current)}</span>
          </span>
        ),
      });
    }
    if (hiddenWorkers > 0) {
      entries.push({
        type: "label",
        id: "lane-list-more",
        text: `还有 ${hiddenWorkers} 个 Worker，在右栏「会话」页签查看`,
      });
    }
  }

  /** 车道列表三态：读取中 / 失败（可重试）/ 空。 */
  let state: ReactNode = null;
  if (props.loading) {
    state = (
      <div className={css.state}>
        <span className={css.stateText}>读取会话列表…</span>
      </div>
    );
  } else if (props.error !== undefined && props.error !== null && props.error !== "") {
    state = (
      <div className={css.state}>
        <span className={css.stateError}>会话列表读取失败：{props.error}</span>
        <Button
          size="sm"
          variant="outline"
          icon={<IconRefreshOutlineRegular size={14} />}
          disabled={props.onRetry === undefined}
          onClick={() => {
            props.onRetry?.();
          }}
        >
          重试
        </Button>
      </div>
    );
  } else if (lanes.length === 0) {
    state = (
      <div className={css.state}>
        <span className={css.stateTitle}>这个任务还没有会话记录</span>
        <span className={css.stateText}>新建主会话后，车道会出现在这里。</span>
      </div>
    );
  }

  /** 一次选择：段、新建主会话，或一条具体车道。 */
  const onSelect = (id: string): void => {
    setOpen(false);
    if (id === "new-main") {
      props.onNewMain?.();
      return;
    }
    if (id.startsWith("segment:")) {
      const next = id.slice("segment:".length);
      if (next === "main" || next === "planner" || next === "worker") props.onChange(next);
      return;
    }
    if (id.startsWith("lane:")) props.onSelectLane?.(id.slice("lane:".length));
  };

  return (
    <div className={css.laneMenuWrap} data-p1-b25-switcher="" data-lane-loading={props.loading ? "" : undefined}>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        onSelect={onSelect}
        items={entries}
        selectedId={selected === null ? undefined : `lane:${selected}`}
        // The current segment is always known (the merged view reads as 主 Agent),
        // so its row carries the check even before a specific lane is picked.
        selectedIds={[`segment:${props.value}`]}
        dense
        portal
        align="end"
        autoFocus
        className={css.laneAnchor}
        listClassName={css.laneMenu}
        anchor={
          <button
            type="button"
            className={css.laneTrigger}
            data-lane-trigger=""
            title={props.titles?.[props.value] ?? "切换会话车道"}
            aria-label="切换会话车道"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={props.loading}
            onClick={() => {
              setOpen((value) => !value);
            }}
          >
            <span className={css.laneValue}>{props.loading ? "读取会话…" : LANE_GROUP_LABEL[group]}</span>
            <IconChevronDownOutlineRegular size={10} className={css.laneChevron} />
          </button>
        }
      >
        {state}
      </Menu>
    </div>
  );
}
