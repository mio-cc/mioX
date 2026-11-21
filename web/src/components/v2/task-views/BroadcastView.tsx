"use client";

/**
 * 播报板视图（会话视图 tab「播报」，对照表 P1:C23、P2:L2）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/broadcast-tab.tsx（整页：过滤条、时间轴行、展开看上下游与 payload、分页 20/50/100、8 秒轮询）。
 * DSH 依据：DSH 无播报板；按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2），分页条照抄 `components/v2/data-pages/AssetPager.tsx`。
 * 接口：`api.explorationNodes(task, query)`（api.ts:797）→ `{ items, total, page, size, edges, refs, assets }`（types.ts:441）。
 *
 * D2 版式：PageHead（实时开关 + 刷新）→ 筛选区（搜索、种类多选、排序；15 个状态收进一行可展开的「状态筛选」）
 * → 时间线：按日期分组，每组一张卡，条目是可展开的行（时间 / 种类 / 摘要 + #id·优先级·来源 / 状态）
 * → 底部分页条。数据、轮询与筛选行为不变。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import type { Edge, ExploreKind, Task, TaskNode } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import {
  Badge,
  Card,
  Dot,
  Empty,
  FilterBar,
  FilterSep,
  Facts,
  IconButton,
  kit,
  Meta,
  Notice,
  Page,
  PageHead,
  Section,
  Skeleton,
  type KitTone,
} from "@/components/v2/design/Kit";
import {
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconClockOutlineRegular,
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
 * 状态的 kit 色调（状态取值见 `types.ts:420-423`；旧 Tag 的 outline 归为中性）。
 * @param state - 后端状态。
 * @returns Badge 色调。
 */
function stateTone(state: string): KitTone {
  const tone = exploreStateTone(state);
  return tone === "outline" ? "neutral" : tone;
}

/**
 * 种类的 kit 色调：漏洞醒目、意图/目标用强调色，其余中性。
 * @param kind - 节点类型。
 * @returns Badge 色调。
 */
function kindTone(kind: string): KitTone {
  if (kind === "finding") return "danger";
  if (kind === "intent") return "info";
  if (kind === "goal") return "done";
  return "neutral";
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
        <span className={css.label}>{title}</span>
        <ul className={css.relList}>
          {rows.map((row) => (
            <li key={`${row.rel}-${row.id}`} className={css.relRow} data-broadcast-rel-id={row.id}>
              <span className={css.relName}>{broadcastRelLabel(row.rel)}</span>
              {row.node === null ? (
                <span className={kit.muted}>节点 #{row.id}</span>
              ) : (
                <>
                  <Badge tone={kindTone(row.node.type)}>{exploreKindLabel(row.node.type)}</Badge>
                  <span className={css.relTitle} title={explorationNodeTitle(row.node)}>
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
      <Card quiet>
        <Facts
          items={[
            { key: "id", label: "节点", value: `#${node.id}`, mono: true },
            { key: "type", label: "类型", value: exploreKindLabel(node.type) },
            { key: "origin", label: "来源", value: node.origin === "" ? "system" : node.origin, mono: true },
            { key: "ts", label: "时间", value: node.ts === "" ? "无时间" : new Date(node.ts).toLocaleString("zh-CN") },
            ...(node.source_task_id === undefined || node.source_task_id === ""
              ? []
              : [
                  {
                    key: "src",
                    label: "来自任务",
                    value: (
                      <span className={css.inline}>
                        {node.source_task_id}
                        {node.inherited === true ? <Badge>继承</Badge> : null}
                      </span>
                    ),
                  },
                ]),
          ]}
        />
      </Card>
      {node.state === "deleted" && node.delete_reason !== undefined && node.delete_reason !== "" ? (
        <Notice tone="warning">删除原因：{node.delete_reason}</Notice>
      ) : null}
      {upstream.length === 0 && downstream.length === 0 ? (
        <span className={css.note}>本页没有与这条播报相关的边。</span>
      ) : (
        <div className={css.relWrap}>
          {renderRows("上游 · 由此而来", upstream)}
          {renderRows("下游 · 由此产生", downstream)}
        </div>
      )}
      <div className={css.payloadBlock}>
        <span className={css.label}>payload</span>
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
  const [statesOpen, setStatesOpen] = useState(false);
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

  const stateSummary =
    states.length === 0
      ? "全部状态"
      : BROADCAST_STATE_OPTIONS.filter((option) => states.includes(option.value))
          .map((option) => option.label)
          .join("、");

  return (
    <Page data={{ "data-broadcast-view": "" }}>
      <PageHead
        title="播报"
        lead="Agent 在探索中产生的目标、意图、事实与漏洞，按时间排成一条时间线；点开一条看上下游与原始 payload。"
        actions={
          <>
            <button
              type="button"
              className={css.liveToggle}
              aria-pressed={live}
              aria-label={live ? "暂停自动刷新" : "恢复自动刷新"}
              title={live ? "每 8 秒刷新一次（页面不可见时暂停）" : "恢复自动刷新"}
              data-broadcast-live={live ? "on" : "off"}
              onClick={() => setLive((value) => !value)}
            >
              <Dot tone={live ? "success" : "neutral"} pulse={live} />
              {live ? "实时" : "已暂停"}
            </button>
            <IconButton label="刷新" spinning={state.phase === "loading"} data-broadcast-refresh="" onClick={state.reload}>
              <IconRefreshOutlineRegular size={14} />
            </IconButton>
          </>
        }
      />

      <div className={css.filters}>
        <div className={css.filterTop}>
          <Input
            className={css.search}
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
          <FilterBar
            id="broadcast-order"
            label="播报排序"
            value={order}
            options={ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(next) => {
              setOrder(next);
              setPage(1);
            }}
          />
        </div>

        <div className={css.filterLine}>
          <div className={kit.filterBar} role="group" aria-label="播报种类" data-kit-filter-toggles="">
            {KIND_FILTERS.map((kind) => {
              const active = kinds.includes(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  className={active ? `${kit.filter} ${kit.filterActive}` : kit.filter}
                  data-broadcast-kind={kind}
                  onClick={() => toggleKind(kind)}
                >
                  {exploreKindLabel(kind)}
                </button>
              );
            })}
          </div>
          <FilterSep />
          <button
            type="button"
            className={states.length > 0 ? `${kit.filter} ${kit.filterActive}` : kit.filter}
            aria-expanded={statesOpen}
            aria-controls="broadcast-state-panel"
            data-broadcast-state-toggle=""
            onClick={() => setStatesOpen((value) => !value)}
          >
            <span className={css.stateSummary}>{states.length === 0 ? "状态" : stateSummary}</span>
            {states.length === 0 ? null : <span className={kit.filterCount}>{states.length}</span>}
            {statesOpen ? <IconChevronUpOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
          </button>
          {filtered ? (
            <button
              type="button"
              className={css.clear}
              data-broadcast-clear=""
              onClick={() => {
                setKinds([]);
                setStates([]);
                setQueryInput("");
                setPage(1);
              }}
            >
              清除筛选
            </button>
          ) : null}
        </div>

        {/* 状态档位常驻 DOM（折叠时 hidden），保留每项的 data-broadcast-state 钩子。 */}
        <div id="broadcast-state-panel" className={css.statePanel} hidden={!statesOpen}>
          <div className={css.stateGrid} role="group" aria-label="按状态筛选">
            {BROADCAST_STATE_OPTIONS.map((option) => {
              const active = states.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  className={active ? `${kit.filter} ${kit.filterActive}` : kit.filter}
                  data-broadcast-state={option.value}
                  onClick={() => toggleState(option.value)}
                >
                  <Dot tone={stateTone(option.value)} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!fresh.atLive && fresh.pending > 0 ? (
        <button type="button" className={css.pending} onClick={backToLive}>
          <IconChevronUpOutlineRegular size={13} />
          {fresh.pending > 99 ? "99+" : fresh.pending} 条新播报 · 回到最新
        </button>
      ) : null}

      {state.phase === "loading" ? (
        <Card>
          <Skeleton label="加载播报" />
        </Card>
      ) : null}

      {state.phase === "offline" ? (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={state.reload}>
              重试
            </Button>
          }
        >
          播报读取失败：{state.error}
        </Notice>
      ) : null}

      {state.phase === "ready" && total === 0 ? (
        <Card>
          <Empty
            inCard
            icon={filtered ? <IconSearchOutlineRegular size={18} /> : <IconClockOutlineRegular size={18} />}
            title={filtered ? "没有符合条件的播报" : "还没有播报"}
            text={filtered ? "放宽种类或状态，或换个关键词。" : "这个任务还没有产生探索节点；Agent 开始探索后会实时出现在这里。"}
          />
        </Card>
      ) : null}

      {state.phase === "ready" && rowCount > 0
        ? groups.map((group) => (
            <Section key={group.day} title={group.day} count={group.rows.length}>
              <Card className={css.timeline}>
                {group.rows.map((node) => {
                  const time = broadcastTime(node.ts);
                  const open = openId === node.id;
                  const isFresh = fresh.freshIds.has(node.id);
                  const title = explorationNodeTitle(node);
                  return (
                    <div
                      key={node.id}
                      className={isFresh ? `${css.item} ${css.itemFresh}` : css.item}
                      data-broadcast-node={node.id}
                      data-broadcast-fresh={isFresh ? "" : undefined}
                      data-open={open ? "true" : undefined}
                    >
                      <button
                        type="button"
                        className={css.head}
                        aria-expanded={open}
                        data-broadcast-toggle={node.id}
                        onClick={() => setOpenId(open ? null : node.id)}
                      >
                        <span className={css.clock} title={node.ts}>
                          {time.clock}
                        </span>
                        <span className={css.kind}>
                          <Badge tone={kindTone(node.type)}>{exploreKindLabel(node.type)}</Badge>
                        </span>
                        <span className={css.body}>
                          <span className={css.title} title={title}>
                            {title}
                          </span>
                          <Meta
                            items={[
                              <span key="id" className={kit.mono}>
                                #{node.id}
                              </span>,
                              <span key="p" title="优先级（0–10）">
                                P{node.priority}
                              </span>,
                              node.origin === "" ? "system" : node.origin,
                              isFresh ? (
                                <span key="new" className={css.freshMark}>
                                  新
                                </span>
                              ) : null,
                            ]}
                          />
                        </span>
                        <span className={css.state}>
                          <Badge tone={stateTone(node.state)}>{exploreStateLabel(node.state)}</Badge>
                        </span>
                        <span className={css.caret} aria-hidden="true">
                          {open ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
                        </span>
                      </button>
                      {open ? <NodeDetail node={node} edges={state.data?.edges ?? []} index={index} /> : null}
                    </div>
                  );
                })}
              </Card>
            </Section>
          ))
        : null}

      {state.phase === "ready" && total > 0 ? (
        <div className={css.pager} data-broadcast-pager="">
          <FilterBar
            id="broadcast-page-size"
            label="每页条数"
            value={String(size)}
            options={BROADCAST_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }))}
            onChange={(next) => {
              setSize(Number(next));
              setPage(1);
            }}
          />
          <span className={css.pagerRight}>
            <span className={css.range} data-broadcast-range="">
              {start}–{end} / {total}
            </span>
            <IconButton
              label="上一页"
              title={page <= 1 ? "已经是第一页" : "上一页"}
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <IconChevronLeftOutlineRegular size={14} />
            </IconButton>
            <span className={css.pageInfo} data-broadcast-page-info="">
              {page} / {pageCount}
            </span>
            <IconButton
              label="下一页"
              title={page >= pageCount ? "已经是最后一页" : "下一页"}
              disabled={page >= pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              <IconChevronRightOutlineRegular size={14} />
            </IconButton>
          </span>
        </div>
      ) : null}
    </Page>
  );
}
