"use client";

/**
 * 播报板视图（会话视图 tab「播报」，对照表 P1:C23、P2:L2）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/broadcast-tab.tsx（整页：过滤条、时间轴行、展开看上下游与 payload、分页 20/50/100、8 秒轮询）。
 * DSH 依据：DSH 无播报板；按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2），分页条照抄 `components/v2/data-pages/AssetPager.tsx`。
 * 接口：`api.explorationNodes(task, query)`（api.ts:797）→ `{ items, total, page, size, edges, refs, assets }`（types.ts:441）。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import type { Edge, ExploreKind, Task, TaskNode } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronRightOutlineRegular as IconRowChevron,
  IconChevronUpOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  exploreKindLabel,
  exploreStateLabel,
  exploreStateTone,
  explorationNodeTitle,
} from "@/v2/data/exploration";
import {
  BROADCAST_PAGE_SIZES,
  BROADCAST_STATE_OPTIONS,
  broadcastNodeIndex,
  broadcastRelLabel,
  broadcastRelations,
  broadcastTime,
  groupBroadcastByDay,
  useBroadcastFresh,
  useBroadcastPage,
  type NodeRelation,
} from "@/v2/data/exploration-nodes";

import css from "./BroadcastView.module.css";

/**
 * 可筛选的节点类型（`types.ts:419` 的真实值）。
 * 照旧页 broadcast-tab.tsx:95-96：起点(其实是 fact/state=origin)跟随「事实」一起过滤，不单列；
 * `task` 根节点也归在「事实」里显示与过滤（旧页把它读作「起点」）。
 * `states` 过滤同时筛真实状态，二者是 AND。
 */
const KIND_FILTERS: readonly ExploreKind[] = ["goal", "intent", "fact", "finding", "hint", "digest"];

/** 排序档位。 */
type OrderValue = "desc" | "asc";

const ORDER_OPTIONS: readonly { value: OrderValue; label: string }[] = [
  { value: "desc", label: "最新在前" },
  { value: "asc", label: "最早在前" },
];

/**
 * Tag 色调（状态取值见 `types.ts:420-423`）。
 * @param state - 后端状态。
 * @returns Tag 的 tone。
 */
function stateTone(state: string): "neutral" | "info" | "success" | "warning" | "danger" | "outline" {
  return exploreStateTone(state);
}

/**
 * 把 payload 排版成缩进 JSON；不是 JSON 就原样返回（旧页 broadcast-tab.tsx:161-168）。
 * @param raw - 后端节点 payload。
 * @returns 展示文本。
 */
function prettyPayload(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") return "（无 payload）";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * 一行播报的展开区：来源/时间明细、删除原因、与其它节点的边（只显示后端返回的）。
 * @param props.node - 当前节点。
 * @param props.edges - 本页边。
 * @param props.index - 同页 + 邻居的节点索引。
 * @returns 展开区。
 */
function NodeDetail({
  node,
  edges,
  index,
}: {
  node: TaskNode;
  edges: readonly Edge[];
  index: Record<string, TaskNode>;
}): ReactNode {
  const { upstream, downstream } = broadcastRelations(node.id, edges, index);
  const renderRows = (title: string, rows: NodeRelation[]): ReactNode => {
    if (rows.length === 0) return null;
    return (
      <div className={css.relBlock}>
        <span className={css.relTitle}>{title}</span>
        <ul className={css.relList}>
          {rows.map((row) => (
            <li key={`${row.rel}-${row.id}`} className={css.relRow} data-broadcast-rel-id={row.id}>
              <Tag tone="quiet">{broadcastRelLabel(row.rel)}</Tag>
              {row.node === null ? (
                <span className={css.muted}>节点 #{row.id}</span>
              ) : (
                <>
                  <Tag tone="outline">{exploreKindLabel(row.node.type)}</Tag>
                  <span className={css.relTitleText} title={explorationNodeTitle(row.node)}>
                    {explorationNodeTitle(row.node)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className={css.detail} data-broadcast-detail={node.id}>
      <div className={css.detailMeta}>
        <span>节点 #{node.id}</span>
        <span>类型 {exploreKindLabel(node.type)}</span>
        <span>来源 {node.origin === "" ? "system" : node.origin}</span>
        <span>{node.ts === "" ? "无时间" : new Date(node.ts).toLocaleString("zh-CN")}</span>
        {node.source_task_id === undefined || node.source_task_id === "" ? null : (
          <span>来自任务 {node.source_task_id}</span>
        )}
        {node.inherited === true ? <Tag tone="neutral">继承</Tag> : null}
      </div>
      {node.state === "deleted" && node.delete_reason !== undefined && node.delete_reason !== "" ? (
        <div className={css.deleteReason}>
          <span className={css.deleteLabel}>删除原因</span>
          <span>{node.delete_reason}</span>
        </div>
      ) : null}
      {upstream.length === 0 && downstream.length === 0 ? (
        <span className={css.muted}>本页没有与这条播报相关的边。</span>
      ) : (
        <div className={css.relWrap}>
          {renderRows("上游 · 由此而来", upstream)}
          {renderRows("下游 · 由此产生", downstream)}
        </div>
      )}
      <div className={css.payloadBlock}>
        <span className={css.relTitle}>payload</span>
        <pre className={css.payload}>{prettyPayload(node.payload)}</pre>
      </div>
    </div>
  );
}

/**
 * 渲染当前任务的播报板。
 * @param props.task - 当前选中的任务。
 * @returns 播报板，或加载 / 失败 / 空态。
 */
export function BroadcastView({ task }: { task: Task }): ReactNode {
  const [kinds, setKinds] = useState<readonly ExploreKind[]>([]);
  const [states, setStates] = useState<readonly string[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [order, setOrder] = useState<OrderValue>("desc");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(BROADCAST_PAGE_SIZES[0] ?? 20);
  const [live, setLive] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useDebouncedValue(queryInput.trim(), 250);

  const state = useBroadcastPage(task.id, { page, size, kinds, states, q: query, order }, live);
  const fresh = useBroadcastFresh(task.id, state.data, { page, size, kinds, states, q: query, order });

  const index = useMemo(() => broadcastNodeIndex(state.data), [state.data]);
  const groups = useMemo(() => groupBroadcastByDay(state.data?.items ?? []), [state.data]);

  const total = state.data?.total ?? 0;
  const rowCount = state.data?.items.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = (page - 1) * size + rowCount;
  const filtered = query !== "" || kinds.length > 0 || states.length > 0;

  // 换任务或换筛选后条数变少时，把越界的页码收回来（旧页 broadcast-tab.tsx:552-555）。
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // 换任务 = 换一条播报流：清掉展开行，免得展开的是上一个任务的节点。
  useEffect(() => {
    setOpenId(null);
  }, [task.id]);

  const toggleKind = (kind: ExploreKind): void => {
    setKinds((cur) => (cur.includes(kind) ? cur.filter((item) => item !== kind) : [...cur, kind]));
    setPage(1);
  };

  const toggleState = (value: string): void => {
    setStates((cur) => (cur.includes(value) ? cur.filter((item) => item !== value) : [...cur, value]));
    setPage(1);
  };

  const backToLive = (): void => {
    setPage(1);
    setOrder("desc");
  };

  return (
    <div className={css.wrap} data-broadcast-view="">
      <div className={css.toolbar}>
        <Input
          value={queryInput}
          placeholder="搜索内容 / 来源 / 节点 id"
          aria-label="搜索播报"
          icon={<IconSearchOutlineRegular size={14} />}
          data-broadcast-search=""
          onChange={(event) => {
            setQueryInput(event.target.value);
            setPage(1);
          }}
        />
        <div className={css.chipGroup}>
          {KIND_FILTERS.map((kind) => {
            const active = kinds.includes(kind);
            return (
              <Button
                key={kind}
                variant={active ? "primary" : "ghost"}
                size="sm"
                aria-pressed={active}
                data-broadcast-kind={kind}
                onClick={() => toggleKind(kind)}
              >
                {exploreKindLabel(kind)}
              </Button>
            );
          })}
        </div>
        <div className={css.toolbarRight}>
          <SegmentedControl
            id="broadcast-order"
            label="播报排序"
            value={order}
            options={ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(next) => {
              setOrder(next);
              setPage(1);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            aria-label={live ? "暂停自动刷新" : "恢复自动刷新"}
            title={live ? "每 8 秒刷新一次（页面不可见时暂停）" : "恢复自动刷新"}
            data-broadcast-live={live ? "on" : "off"}
            onClick={() => setLive((value) => !value)}
          >
            {live ? "自动刷新" : "已暂停"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-broadcast-refresh=""
            onClick={state.reload}
          >
            刷新
          </Button>
        </div>
      </div>

      <div className={css.filterLine}>
        <span className={css.filterLabel}>状态</span>
        <div className={css.chipGroup}>
          {BROADCAST_STATE_OPTIONS.map((option) => {
            const active = states.includes(option.value);
            return (
              <Button
                key={option.value}
                variant={active ? "primary" : "ghost"}
                size="sm"
                aria-pressed={active}
                data-broadcast-state={option.value}
                onClick={() => toggleState(option.value)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            data-broadcast-clear=""
            onClick={() => {
              setKinds([]);
              setStates([]);
              setQueryInput("");
              setPage(1);
            }}
          >
            清除筛选
          </Button>
        ) : null}
      </div>

      {!fresh.atLive && fresh.pending > 0 ? (
        <div className={css.pendingLine}>
          <Button variant="ghost" size="sm" icon={<IconChevronUpOutlineRegular size={13} />} onClick={backToLive}>
            {fresh.pending > 99 ? "99+" : fresh.pending} 条新播报 · 回到最新
          </Button>
        </div>
      ) : null}

      {state.phase === "loading" ? <div className={css.state}>加载播报…</div> : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>播报读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload}>
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && total === 0 ? (
        <p className={css.empty}>
          {filtered ? "没有符合条件的播报。" : "这个任务还没有产生探索节点。"}
        </p>
      ) : null}

      {state.phase === "ready" && rowCount > 0
        ? groups.map((group) => (
            <section key={group.day} className={css.group}>
              <div className={css.groupDay}>{group.day}</div>
              <ul className={css.list}>
                {group.rows.map((node) => {
                  const time = broadcastTime(node.ts);
                  const open = openId === node.id;
                  const isFresh = fresh.freshIds.has(node.id);
                  return (
                    <li
                      key={node.id}
                      className={isFresh ? `${css.row} ${css.rowFresh}` : css.row}
                      data-broadcast-node={node.id}
                      data-broadcast-fresh={isFresh ? "" : undefined}
                    >
                      <div className={css.timeCol}>
                        <span className={css.clock} title={node.ts}>
                          {time.clock}
                        </span>
                      </div>
                      <div className={css.mainCol}>
                        <button
                          type="button"
                          className={css.head}
                          aria-expanded={open}
                          data-broadcast-toggle={node.id}
                          onClick={() => setOpenId(open ? null : node.id)}
                        >
                          {open ? (
                            <IconChevronDownOutlineRegular size={13} className={css.caret} />
                          ) : (
                            <IconRowChevron size={13} className={css.caret} />
                          )}
                          <Tag tone="outline">{exploreKindLabel(node.type)}</Tag>
                          <span className={css.nodeId}>#{node.id}</span>
                          <Tag tone={stateTone(node.state)}>{exploreStateLabel(node.state)}</Tag>
                          <span className={css.priority} title="优先级（0–10）">
                            P{node.priority}
                          </span>
                          {isFresh ? <Tag tone="info">新</Tag> : null}
                          <span className={css.title} title={explorationNodeTitle(node)}>
                            {explorationNodeTitle(node)}
                          </span>
                          <span className={css.origin}>{node.origin === "" ? "system" : node.origin}</span>
                        </button>
                        {open ? <NodeDetail node={node} edges={state.data?.edges ?? []} index={index} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        : null}

      {state.phase === "ready" && total > 0 ? (
        <div className={css.pager} data-broadcast-pager="">
          <SegmentedControl
            id="broadcast-page-size"
            label="每页条数"
            value={String(size)}
            options={BROADCAST_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }))}
            onChange={(next) => {
              setSize(Number(next));
              setPage(1);
            }}
          />
          <span className={css.range} data-broadcast-range="">
            {start}–{end} / {total}
          </span>
          <span className={css.pagerRight}>
            <Button
              variant="outline"
              size="sm"
              aria-label="上一页"
              title={page <= 1 ? "已经是第一页" : "上一页"}
              disabled={page <= 1}
              icon={<IconChevronLeftOutlineRegular size={13} />}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            />
            <span className={css.pageInfo} data-broadcast-page-info="">
              {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label="下一页"
              title={page >= pageCount ? "已经是最后一页" : "下一页"}
              disabled={page >= pageCount}
              icon={<IconChevronRightOutlineRegular size={13} />}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            />
          </span>
        </div>
      ) : null}
    </div>
  );
}
