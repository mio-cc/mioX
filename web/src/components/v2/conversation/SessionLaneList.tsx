"use client";

/**
 * 子会话列表（P1:B28）：按车道分组列出任务的会话，点一条切过去。
 *
 * 旧页面依据：
 * `ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1233-1259`
 * （按 role 分成 mainagent / planner / worker / system 四组）、
 * `:1655-1729`（分组渲染：组头 + 行；mainagent 组头带「新建」、worker 组尾带
 * 「加载更早的 Worker」）、`:339-437`（行内容：状态图标、`#意图号`、标题、
 * 实时标记、未读角标）。
 *
 * 「未读」的取舍（**不许造假**）：旧页的未读数（`sessions-tab.tsx:115-142,1031`）
 * 是旧前端自己在 SSE 分发里维护的内存计数，后端没有任何未读字段
 * （`api.mainSessions` / `api.intents` / `Activity` 都没有），`/v2` 也没有等价的
 * SSE 分发器。因此这里**不画未读角标**，只在台账与 overlay 里记明这一处缺口。
 *
 * DSH 依据：会话列表本身取自
 * `dsh-upstream/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:135-204`
 * 的 tab/crumb 组合；DSH 没有 lane 分组，分组形态照旧页。
 *
 * 对照表行：P1:B25 P1:B28
 */
import { type ReactNode, useMemo } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { IconNewChatOutlineRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  intentStateLabel,
  LANE_GROUP_LABEL,
  mainSegOf,
  type SessionLane,
  type SessionLaneGroup,
} from "@/v2/data/sessions";

import css from "./SessionLaneList.module.css";

/** 分组渲染顺序，照旧页 `sessions-tab.tsx:1656`（system 组不在本列表里）。 */
const GROUP_ORDER: readonly SessionLaneGroup[] = ["mainagent", "planner", "worker"];

/** Worker 组最多先渲染这么多行，其余靠「显示全部」展开（避免长任务一次铺满）。 */
const WORKER_WINDOW = 8;

export interface SessionLaneListProps {
  /** 车道列表；`null` 表示列表还在读或读取失败，此时只渲染状态行。 */
  readonly lanes: readonly SessionLane[];
  /** 后端当前（可写的）主 Agent 分段号，用于标出「当前写入」。 */
  readonly current: number;
  /** 当前选中的车道键；`null` 是合并视图。 */
  readonly selected: string | null;
  /** 切换车道；`null` 回到合并视图。 */
  readonly onSelect: (key: string | null) => void;
  /** 新建主会话（`POST /exploration/main-sessions`，旧页 `/new`）。 */
  readonly onNewMain: () => void;
  /** 新建请求是否在进行中。 */
  readonly creating: boolean;
  /** 是否正在读取车道列表。 */
  readonly loading: boolean;
  /** 读取失败原因；非 null 时渲染失败态与重试。 */
  readonly error: string | null;
  /** 重新读取车道列表。 */
  readonly onRetry: () => void;
}

/** 一行的右侧状态文字，照旧页组内语义（`:1665-1691`）。 */
function laneStatus(lane: SessionLane, current: number): { text: string; tone: "outline" | "success" | "info" | "neutral" } {
  if (lane.group === "worker") {
    const state = lane.state;
    const tone = state === "running" ? "success" : state === "done" ? "info" : "neutral";
    return { text: intentStateLabel(state), tone };
  }
  if (lane.group === "mainagent") {
    return mainSegOf(lane.key) === current
      ? { text: "当前写入", tone: "success" }
      : { text: "历史分段", tone: "neutral" };
  }
  return { text: "只读", tone: "outline" };
}

/**
 * 渲染按车道分组的子会话列表。
 * @param props - 车道列表、选中项、切换与新建回调、四态标志。
 * @returns 列表卡片。
 */
export function SessionLaneList(props: SessionLaneListProps): ReactNode {
  const { lanes, current, selected, onSelect, onNewMain, creating, loading, error, onRetry } = props;

  const grouped = useMemo(() => {
    const empty: Record<SessionLaneGroup, SessionLane[]> = { mainagent: [], planner: [], worker: [] };
    for (const lane of lanes) empty[lane.group].push(lane);
    return empty;
  }, [lanes]);

  /** 四态之一：读取中。 */
  if (loading && lanes.length === 0) {
    return (
      <div className={css.list} data-p1-b28-list="" data-p1-b28-state="loading">
        <div className={css.state}>读取会话列表…</div>
      </div>
    );
  }

  /** 四态之二：读取失败，可重试。 */
  if (error !== null) {
    return (
      <div className={css.list} data-p1-b28-list="" data-p1-b28-state="offline">
        <div className={css.stateError} role="alert">
          <span className={css.stateErrorText}>会话列表读取失败：{error}</span>
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefreshOutlineRegular size={14} />}
            onClick={onRetry}
            data-p1-b28-retry=""
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  /** 四态之三：读到了，但只有合并视图可选（后端没有任何分段/意图）。 */
  if (lanes.length === 0) {
    return (
      <div className={css.list} data-p1-b28-list="" data-p1-b28-state="empty">
        <div className={css.state}>这个任务还没有会话记录。</div>
        <div className={css.stateActions}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconNewChatOutlineRegular size={14} />}
            disabled={creating}
            onClick={onNewMain}
            data-p1-b28-new=""
          >
            {creating ? "新建中…" : "新建主会话"}
          </Button>
        </div>
      </div>
    );
  }

  /** 四态之四：有数据。 */
  return (
    <div className={css.list} data-p1-b28-list="" data-p1-b28-state="ready">
      {GROUP_ORDER.map((group) => {
        const rows = grouped[group];
        // 空组不渲染组头（旧页 `sessions-tab.tsx:1658` 同样跳过空组）。
        if (rows.length === 0) return null;
        const windowed = group === "worker" && rows.length > WORKER_WINDOW ? rows.slice(0, WORKER_WINDOW) : rows;
        return (
          <section key={group} className={css.group} data-p1-b28-group={group}>
            <header className={css.groupHead}>
              <span className={css.groupTitle}>{LANE_GROUP_LABEL[group]}</span>
              <span className={css.groupCount}>{rows.length}</span>
              {group === "mainagent" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconNewChatOutlineRegular size={14} />}
                  disabled={creating}
                  title="新建主会话（清空上下文，任务的图与资产保留）"
                  aria-label="新建主会话"
                  onClick={onNewMain}
                  data-p1-b27-new=""
                >
                  {creating ? "新建中…" : "新建"}
                </Button>
              ) : null}
            </header>
            <ul className={css.rows}>
              {windowed.map((lane) => {
                const active = lane.key === selected;
                const status = laneStatus(lane, current);
                return (
                  <li key={lane.key} className={css.rowItem}>
                    <button
                      type="button"
                      className={css.row}
                      aria-current={active ? "true" : undefined}
                      data-p1-b28-row=""
                      data-lane-key={lane.key}
                      data-lane-group={lane.group}
                      data-lane-active={active ? "true" : "false"}
                      title={lane.label}
                      onClick={() => {
                        onSelect(lane.key);
                      }}
                    >
                      <span className={css.dot} data-state={lane.live ? "running" : "idle"} aria-hidden="true" />
                      <span className={css.rowLabel}>{lane.label}</span>
                      {lane.meta !== undefined && lane.meta !== "" ? (
                        <span className={css.rowMeta}>{lane.meta}</span>
                      ) : null}
                      <Tag tone={status.tone}>{status.text}</Tag>
                    </button>
                  </li>
                );
              })}
            </ul>
            {group === "worker" && rows.length > windowed.length ? (
              // 旧页用分页接口「加载更早的 Worker」（`:1708-1722`）；/v2 的车道读取
              // 复用 `useSessionLanes`（api.intents 一次取回），这里只做本地的展开显示。
              <div className={css.groupFoot}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const first = rows[windowed.length];
                    if (first !== undefined) onSelect(first.key);
                  }}
                  data-p1-b28-worker-more=""
                >
                  其余 {rows.length - windowed.length} 条未展开
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
