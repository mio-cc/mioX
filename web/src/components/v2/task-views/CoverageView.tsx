"use client";

/**
 * 覆盖度视图（会话视图 tab「覆盖度」，对照表 P1:C24、P2:L4、P2:L6）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/coverage-graph-tab.tsx:459-516（图与统计）、
 *   :297-395（资产侧栏：属性 + 关联意图/事实/发现）、:643-695（图例与图例统计）、
 *   _tabs/overview-tab.tsx:704-736（覆盖度计数与按类型分布）。
 * DSH 依据：DSH 无覆盖图；按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2），
 *   图用已安装的 @xyflow/react，分层布局与画法照抄 `components/v2/findings/FindingLineage.tsx:62-114`
 *   （旧页用的 @antv/g6 不照搬，本文件不 import 旧组件）。
 * 接口：`api.taskCoverage`（api.ts:421）、`api.taskCoverageGraph`（api.ts:431 → types.ts:325）、
 *   `api.taskAssetRefs`（api.ts:527 → types.ts:339）；全部经 `@/v2/data/coverage` 取数。
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";

import {
  Background,
  Controls,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { CoverageAssetRef, CoverageGraphNode, Task } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import {
  COVERAGE_KINDS,
  coverageKindLabel,
  coveragePercentText,
  coverageRefGroups,
  coverageTestStateLabel,
  useCoverageAssetRefs,
  useTaskCoverage,
  useTaskCoverageGraph,
} from "@/v2/data/coverage";

import css from "./CoverageView.module.css";

/**
 * 分层布局：按「离父节点最远的深度」分列，同列内按顺序排列。
 * 旧页用 d3-force 力导向；这里按 FindingLineage.tsx:65-71 的做法自己算位置，不引额外布局库。
 * @param nodes - 图节点。
 * @param edges - 图的父子边（`src` 的子节点挂在 `dst` 父节点下，见 coverage-graph-tab.tsx:116-122）。
 * @returns 节点 → 位置。
 */
function layeredPositions(
  nodes: readonly CoverageGraphNode[],
  edges: readonly { src: string; dst: string }[],
): Map<string, { x: number; y: number }> {
  const keys = new Set(nodes.map((node) => node.key));
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (!keys.has(edge.src) || !keys.has(edge.dst)) continue;
    if (!parentOf.has(edge.src)) parentOf.set(edge.src, edge.dst);
    const bucket = childrenOf.get(edge.dst);
    if (bucket === undefined) childrenOf.set(edge.dst, [edge.src]);
    else bucket.push(edge.src);
  }

  const depth = new Map<string, number>();
  const roots = nodes.map((node) => node.key).filter((key) => !parentOf.has(key));
  const queue: string[] = [...roots];
  for (const key of queue) depth.set(key, 0);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index] ?? "";
    const next = (depth.get(current) ?? 0) + 1;
    for (const child of childrenOf.get(current) ?? []) {
      if ((depth.get(child) ?? -1) >= next) continue;
      depth.set(child, next);
      queue.push(child);
    }
  }

  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const level = depth.get(node.key) ?? 0;
    const bucket = columns.get(level);
    if (bucket === undefined) columns.set(level, [node.key]);
    else bucket.push(node.key);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, column] of columns) {
    column.forEach((key, row) => {
      positions.set(key, { x: level * 210, y: row * 90 });
    });
  }
  return positions;
}

/**
 * 覆盖度概览的数字块。
 * @param props.label - 指标名。
 * @param props.value - 指标值（已格式化）。
 * @returns 一小块统计。
 */
function StatBlock({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={css.stat}>
      <span className={css.statLabel}>{label}</span>
      <span className={css.statValue}>{value}</span>
    </div>
  );
}

/**
 * 资产侧栏的一个引用分组。
 * @param props.title - 区块标题。
 * @param props.items - 该组引用。
 * @returns 引用列表；该组为空时不渲染。
 */
function RefBlock({ title, items }: { title: string; items: CoverageAssetRef[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <div className={css.refBlock}>
      <span className={css.blockTitle}>
        {title}（{items.length}）
      </span>
      <ul className={css.refList}>
        {items.map((ref) => (
          <li key={`${ref.kind}-${ref.id}`} className={css.refRow} data-coverage-ref={`${ref.kind}-${ref.id}`}>
            <span className={css.refId}>#{ref.id}</span>
            {ref.state === "" ? null : <Tag tone="quiet">{ref.state}</Tag>}
            <span className={css.refSummary}>{ref.summary === "" ? "—" : ref.summary}</span>
            {ref.inherited === true && ref.source_task_id !== undefined ? (
              <Tag tone="outline">来源 #{ref.source_task_id} · 只读</Tag>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 选中资产的侧栏区块：属性与关联意图 / 事实 / 发现。
 * @param props.taskId - 任务 id。
 * @param props.node - 选中的节点。
 * @returns 侧栏内容（含加载 / 失败 / 空四态）。
 */
function AssetDetail({ taskId, node }: { taskId: string; node: CoverageGraphNode }): ReactNode {
  const refs = useCoverageAssetRefs(taskId, node.asset_id ?? null);
  const groups = refs.data === null ? [] : coverageRefGroups(refs.data);
  const hasRefs = groups.some((group) => group.items.length > 0);

  const meta: { label: string; value: string | number | undefined }[] = [
    { label: "类型", value: coverageKindLabel(node.kind) },
    { label: "测试状态", value: coverageTestStateLabel(node) },
    { label: "域名", value: node.domain },
    { label: "根域名", value: node.root_domain },
    { label: "IP", value: node.ip },
    { label: "端口", value: node.port },
    { label: "URL", value: node.url },
    { label: "标题", value: node.page_title },
    { label: "状态码", value: node.status_code },
    { label: "App", value: node.app_name },
    { label: "资产ID", value: node.asset_id },
  ];

  return (
    <div className={css.detail} data-coverage-detail={node.key}>
      <div className={css.detailHead}>
        <Tag tone="outline">{coverageKindLabel(node.kind)}</Tag>
        <span className={css.detailLabel} title={node.label}>
          {node.label}
        </span>
      </div>

      <div className={css.props}>
        {meta
          .filter((row) => row.value !== undefined && row.value !== "" && row.value !== 0)
          .map((row) => (
            <div key={row.label} className={css.propRow}>
              <span className={css.propLabel}>{row.label}</span>
              <span className={css.propValue}>{row.value}</span>
            </div>
          ))}
      </div>

      {node.asset_id === undefined ? (
        <span className={css.note}>这个节点不是资产，没有可查询的引用。</span>
      ) : refs.phase === "loading" ? (
        <span className={css.note}>读取引用…</span>
      ) : refs.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>引用读取失败：{refs.error}</span>
          <Button variant="outline" size="sm" onClick={refs.reload}>
            重试
          </Button>
        </div>
      ) : hasRefs ? (
        <div className={css.refWrap}>
          {groups.map((group) => (
            <RefBlock key={group.title} title={group.title} items={group.items} />
          ))}
        </div>
      ) : (
        <span className={css.note}>这个资产在本任务还没有关联的意图、事实或发现。</span>
      )}
    </div>
  );
}

/**
 * 渲染当前任务的覆盖度视图。
 * @param props.task - 当前选中的任务。
 * @returns 覆盖度视图，或加载 / 失败 / 空态。
 */
export function CoverageView({ task }: { task: Task }): ReactNode {
  const summary = useTaskCoverage(task.id);
  const coverageEnabled = summary.data?.enabled ?? false;
  const graph = useTaskCoverageGraph(task.id, coverageEnabled);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const nodes = graph.data?.nodes ?? [];
  const edges = graph.data?.edges ?? [];

  const flow = useMemo(() => {
    const positions = layeredPositions(nodes, edges);
    const flowNodes: FlowNode[] = nodes.map((node) => ({
      id: node.key,
      position: positions.get(node.key) ?? { x: 0, y: 0 },
      data: {
        label: `${coverageKindLabel(node.kind)}：${node.label}${coverageEnabled && node.in_scope && node.tested ? "（已测）" : ""}`,
      },
      type: "default",
    }));
    const flowEdges: FlowEdge[] = edges.map((edge, index) => ({
      id: `e${index}-${edge.src}-${edge.dst}`,
      source: edge.src,
      target: edge.dst,
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [nodes, edges, coverageEnabled]);

  const onNodeClick = useCallback<NodeMouseHandler<FlowNode>>((_event, node) => {
    setSelectedKey(node.id);
  }, []);

  const selected = nodes.find((node) => node.key === selectedKey) ?? null;

  const reloadAll = useCallback(() => {
    summary.reload();
    graph.reload();
  }, [summary, graph]);

  const inScope = nodes.filter((node) => node.in_scope).length;
  const testedNodes = nodes.filter((node) => node.in_scope && node.tested).length;

  return (
    <div className={css.wrap} data-coverage-view="">
      <div className={css.toolbar}>
        <span className={css.title}>资产测试覆盖度</span>
        <span className={css.muted}>粗估，仅供参考</span>
        <span className={css.toolbarRight}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-coverage-refresh=""
            onClick={reloadAll}
          >
            刷新
          </Button>
        </span>
      </div>

      <section className={css.section} data-coverage-summary="">
        <span className={css.blockTitle}>覆盖度概览</span>
        {summary.phase === "loading" ? <span className={css.note}>读取覆盖度…</span> : null}
        {summary.phase === "offline" ? (
          <div className={css.stateError} role="alert">
            <span>覆盖度读取失败：{summary.error}</span>
            <Button variant="outline" size="sm" onClick={summary.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {summary.phase === "ready" && summary.data !== null ? (
          summary.data.enabled === false ? (
            <span className={css.note}>资产覆盖度功能未开启（设置里打开后才有统计）。</span>
          ) : summary.data.scope_rows === 0 ? (
            <span className={css.note}>这个任务还没有测试范围（先锚定任务范围，才会有覆盖度统计）。</span>
          ) : (
            <>
              <div className={css.stats}>
                <StatBlock label="已测 / 范围内" value={`${summary.data.tested} / ${summary.data.denominator}`} />
                <StatBlock label="覆盖率" value={coveragePercentText(summary.data.pct)} />
                <StatBlock label="范围条目" value={String(summary.data.scope_rows)} />
              </div>
              {summary.data.by_type.length === 0 ? null : (
                <div className={css.typeChips}>
                  {summary.data.by_type.map((bucket) => (
                    <Tag key={bucket.type} tone="neutral">
                      {`${bucket.type} ${bucket.tested}/${bucket.total}`}
                    </Tag>
                  ))}
                </div>
              )}
            </>
          )
        ) : null}
      </section>

      <section className={css.section} data-coverage-graph="">
        <div className={css.sectionHead}>
          <span className={css.blockTitle}>覆盖图</span>
          {graph.phase === "ready" && nodes.length > 0 ? (
            <span className={css.legend}>
              <span>范围内 {inScope}</span>
              {coverageEnabled ? <span>已测 {testedNodes}</span> : null}
              <span>连线 {edges.length}</span>
              {COVERAGE_KINDS.map((kind) => (
                <Tag key={kind} tone="quiet">
                  {coverageKindLabel(kind)}
                </Tag>
              ))}
            </span>
          ) : null}
        </div>

        {graph.phase === "loading" ? <span className={css.note}>读取覆盖图…</span> : null}
        {graph.phase === "offline" ? (
          <div className={css.stateError} role="alert">
            <span>覆盖图读取失败：{graph.error}</span>
            <Button variant="outline" size="sm" onClick={graph.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {graph.phase === "ready" && flow.nodes.length === 0 ? (
          <span className={css.note}>暂无范围内资产（先锚定任务范围）。</span>
        ) : null}
        {graph.phase === "ready" && flow.nodes.length > 0 ? (
          <>
            <span className={css.muted}>点节点看它在本任务里关联的意图 / 事实 / 发现；拖动可平移，滚轮缩放。</span>
            <div className={css.canvas} data-coverage-canvas="">
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                fitView
                proOptions={{ hideAttribution: true }}
                onNodeClick={onNodeClick}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          </>
        ) : null}
      </section>

      <Modal
        open={selected !== null}
        onClose={() => setSelectedKey(null)}
        title="资产覆盖详情"
        closeLabel="关闭"
      >
        {selected === null ? null : <AssetDetail taskId={task.id} node={selected} />}
      </Modal>
    </div>
  );
}
