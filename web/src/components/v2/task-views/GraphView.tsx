"use client";

/**
 * 探索图视图（会话视图 tab「探索图」，对照表 P1:C16、P2:L1）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/graph-tab.tsx（旧页用 @antv/g6 画探索图）
 * DSH 依据：DSH 无探索图，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：全量图 `api.explorationGraph(task?)`（api.ts:795）→ `{ nodes: TaskNode[]; edges: Edge[] }`，
 * 用已安装的 @xyflow/react 自绘（实现在 `v2/data/exploration.ts`）；
 * 按节点分页浏览 `api.explorationNodes(task, {page,size,kinds})`（api.ts:797，只读复用
 * `v2/data/exploration-nodes.ts:67` 的 `useBroadcastPage`），分页口径照旧页
 * broadcast-tab.tsx:548-555（pageCount = ceil(total/size)、页码越界回落到末页）
 * 与 :705-729（`start–end / total`、上一页 / 页号 / 下一页）。
 */
import { type ReactNode, useMemo, useState } from "react";

import { Background, Controls, ReactFlow, type Edge as FlowEdge, type Node as FlowNode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { ExploreKind, Task } from "@/lib/types";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Button } from "@/vendor/dsh/primitives/Button";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  exploreKindLabel,
  exploreStateLabel,
  exploreStateTone,
  explorationNodeTitle,
  filterExplorationEdges,
  filterExplorationNodes,
  useExplorationGraph,
  type ExplorationFilter,
} from "@/v2/data/exploration";
import { BROADCAST_PAGE_SIZES, useBroadcastPage } from "@/v2/data/exploration-nodes";

import css from "./GraphView.module.css";

/** 过滤档位选项。 */
const FILTER_OPTIONS = [
  { value: "all", label: "全部节点" },
  { value: "intent", label: "只看意图" },
  { value: "finding", label: "只看漏洞" },
] as const;

/** 分页浏览用的每页条数档位（照旧页 broadcast-tab.tsx:37 的 PAGE_SIZES 与播报板口径一致）。 */
const PAGE_SIZE_OPTIONS = BROADCAST_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }));

/** 分页档位默认每页条数（播报板默认也是 20）。 */
const DEFAULT_PAGE_SIZE = BROADCAST_PAGE_SIZES[0] ?? 20;

/** 节点框宽度（布局用，px）。 */
const NODE_W = 220;
/** 节点框高度（布局用，px）。 */
const NODE_H = 64;

/**
 * 简单分层布局：按节点下标每 5 个换一层，够读即可；不引额外布局库。
 * @param nodes - 保留的节点。
 * @param titles - 节点显示文本。
 * @returns React Flow 节点。
 */
function layoutNodes(nodes: readonly { id: string }[], titles: readonly string[]): FlowNode[] {
  return nodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % 5) * (NODE_W + 40), y: Math.floor(index / 5) * (NODE_H + 60) },
    data: { label: titles[index] ?? node.id },
    type: "default",
  }));
}

/**
 * 渲染当前任务的探索图。
 * @param props.task - 当前选中的任务。
 * @returns 探索图，或加载 / 失败 / 空态。
 */
export function GraphView({ task }: { task: Task }): ReactNode {
  const graph = useExplorationGraph(task.id);
  const [filter, setFilter] = useState<ExplorationFilter>("all");
  // 分页浏览（P2:L1）：真实后端分页，页码从 1 起，换每页条数回到第 1 页（旧页 broadcast-tab.tsx:554-556）。
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);

  // 过滤档位与播报板的 kind 口径一致：只看意图 → kinds=["intent"]，只看漏洞 → kinds=["finding"]。
  const pageKinds = useMemo<ExploreKind[]>(() => (filter === "all" ? [] : [filter]), [filter]);
  const pageState = useBroadcastPage(
    task.id,
    // states / q / order 固定：分页浏览不做状态/关键词筛选，顺序与整图一致（后端默认最新在前）。
    { page, size, kinds: pageKinds, states: [], q: "", order: "desc" },
    false,
  );
  const pageTotal = pageState.data === null ? 0 : pageState.data.total;
  const pageCount = Math.max(1, Math.ceil(pageTotal / size));
  const pageStart = pageTotal === 0 ? 0 : (page - 1) * size + 1;
  const pageEnd = (page - 1) * size + (pageState.data?.items.length ?? 0);

  // 页码越界（换档位前的旧页码 / 数据被删）：回落到末页（旧页 broadcast-tab.tsx:553-555）。
  if (page > pageCount) setPage(pageCount);

  const kept = useMemo(
    () => (graph.data === null ? [] : filterExplorationNodes(graph.data.nodes, filter)),
    [graph.data, filter],
  );
  const keptEdges = useMemo(
    () => (graph.data === null ? [] : filterExplorationEdges(graph.data.edges, kept)),
    [graph.data, kept],
  );
  const titles = useMemo(() => kept.map((node) => explorationNodeTitle(node)), [kept]);
  const flowNodes = useMemo(() => layoutNodes(kept, titles), [kept, titles]);
  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      keptEdges.map((edge, index) => ({
        id: `e${index}-${edge.src}-${edge.dst}`,
        source: edge.src,
        target: edge.dst,
        label: edge.rel,
      })),
    [keptEdges],
  );
  const relList = useMemo(
    () => [...new Set((graph.data?.edges ?? []).map((edge) => String(edge.rel)))].sort(),
    [graph.data],
  );

  if (graph.phase === "loading") return <div className={css.state}>加载探索图…</div>;
  if (graph.phase === "offline") {
    return (
      <div className={css.stateError} role="alert">
        <span>探索图读取失败：{graph.error}</span>
        <Button variant="outline" size="sm" onClick={graph.reload}>
          重试
        </Button>
      </div>
    );
  }
  if (graph.data === null || graph.data.nodes.length === 0) {
    return (
      <div className={css.empty} data-exploration-empty="">
        <Tag tone="neutral">暂无探索图数据</Tag>
        <span>这个任务还没有产生探索节点。</span>
      </div>
    );
  }

  return (
    <div className={css.wrap} data-exploration-graph={graph.data.nodes.length}>
      <div className={css.toolbar}>
        <SegmentedControl
          id="exploration-graph-filter"
          value={filter}
          options={FILTER_OPTIONS}
          onChange={(next) => {
            setFilter(next);
            setPage(1);
          }}
          label="探索图节点过滤"
        />
        <span className={css.count}>
          节点 {kept.length} / {graph.data.nodes.length} · 关系 {keptEdges.length}
        </span>
        <Button variant="outline" size="sm" onClick={graph.reload}>
          刷新
        </Button>
      </div>

      {kept.length === 0 ? (
        <div className={css.empty} data-exploration-filter-empty="">
          <Tag tone="neutral">当前筛选没有匹配的节点</Tag>
          <span>切换到「全部节点」可以看完整探索图。</span>
        </div>
      ) : (
        <div className={css.canvas}>
          <ReactFlow nodes={flowNodes} edges={flowEdges} fitView proOptions={{ hideAttribution: true }}>
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      )}

      <div className={css.legend} data-exploration-legend="">
        <span className={css.legendTitle}>图例</span>
        <span className={css.legendItem}>边上的字是关系类型（rel），原文照后端返回显示</span>
        {relList.length === 0 ? (
          <span className={css.muted}>这张图没有边</span>
        ) : (
          relList.map((rel) => (
            <Tag key={rel} tone="outline">
              {rel}
            </Tag>
          ))
        )}
        <span className={css.legendItem}>
          节点类型：
          {[...new Set(kept.map((node) => exploreKindLabel(node.type)))].join(" / ")}
        </span>
        <span className={css.hint}>拖动可平移，滚轮缩放</span>
      </div>

      <ul className={css.nodeList} data-exploration-nodes="">
        {kept.map((node) => (
          <li key={node.id} className={css.nodeRow} data-node-id={node.id}>
            <span className={css.nodeTitle} title={explorationNodeTitle(node)}>
              {explorationNodeTitle(node)}
            </span>
            <Tag tone="outline">{exploreKindLabel(node.type)}</Tag>
            <Tag tone={exploreStateTone(node.state)}>{exploreStateLabel(node.state)}</Tag>
            <span className={css.muted}>优先级 {node.priority}</span>
          </li>
        ))}
      </ul>

      {/* P2:L1：按节点分页浏览。数据全部来自 `api.explorationNodes`（真实分页，不伪造节点），
          分页口径照旧页 broadcast-tab.tsx:705-729（start–end / total、上一页 / 页号 / 下一页）。 */}
      <section className={css.pagerBlock} data-exploration-pager="">
        <div className={css.subHead}>
          <span className={css.subTitle}>按节点分页浏览</span>
          <span className={css.muted}>后端按创建顺序分页（最新在前）；这里只翻页，不额外过滤状态与关键词。</span>
        </div>
        {pageState.phase === "loading" ? (
          <div className={css.state} data-exploration-pager-state="loading">
            加载节点…
          </div>
        ) : null}
        {pageState.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-exploration-pager-state="offline">
            <span>节点读取失败：{pageState.error}</span>
            <Button variant="outline" size="sm" onClick={pageState.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {pageState.phase === "ready" && pageTotal === 0 ? (
          <p className={css.empty} data-exploration-pager-state="empty">
            {filter === "all" ? "这个任务还没有产生探索节点。" : "当前筛选下没有可翻页的节点。"}
          </p>
        ) : null}
        {pageState.phase === "ready" && pageState.data !== null && pageTotal > 0 ? (
          <>
            <ul className={css.nodeList} data-exploration-page-rows="">
              {pageState.data.items.map((node) => (
                <li key={node.id} className={css.nodeRow} data-exploration-page-node={node.id}>
                  <span className={css.nodeTitle} title={explorationNodeTitle(node)}>
                    {explorationNodeTitle(node)}
                  </span>
                  <Tag tone="outline">{exploreKindLabel(node.type)}</Tag>
                  <Tag tone={exploreStateTone(node.state)}>{exploreStateLabel(node.state)}</Tag>
                  <span className={css.muted}>优先级 {node.priority}</span>
                </li>
              ))}
            </ul>
            <div className={css.pager}>
              <SegmentedControl
                id="exploration-page-size"
                label="每页条数"
                value={String(size)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(next) => {
                  setSize(Number(next));
                  setPage(1);
                }}
              />
              <span className={css.range} data-exploration-page-range="">
                {pageStart}–{pageEnd} / {pageTotal}
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
                <span className={css.pageInfo} data-exploration-page-info="">
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
          </>
        ) : null}
      </section>
    </div>
  );
}
