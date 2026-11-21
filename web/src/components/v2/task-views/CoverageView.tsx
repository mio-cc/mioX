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
 *
 * D2 版式：PageHead（粗估说明 + 刷新）→ 「概览」指标格 + 按类型分布卡（每类一行：名称 / 进度条 / 已测/总数）
 * → 「覆盖图」卡（顶部图例条，画布定高）→ 节点详情弹窗：属性用 Facts，关联引用分组成行。
 * 数据与交互不变。
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
import {
  Badge,
  Card,
  Empty,
  Facts,
  IconButton,
  kit,
  Meta,
  Metrics,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
  type Fact,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  IconBranchOutlineRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
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
 * 资产详情里的一个引用分组（卡内行）。
 * @param props.title - 区块标题。
 * @param props.items - 该组引用。
 * @returns 引用卡；该组为空时不渲染。
 */
function RefBlock({ title, items }: { title: string; items: CoverageAssetRef[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <Section title={title} count={items.length}>
      <Card>
        {items.map((ref) => (
          <Row
            key={`${ref.kind}-${ref.id}`}
            data={{ "data-coverage-ref": `${ref.kind}-${ref.id}` }}
            top
            label={<span className={css.refSummary}>{ref.summary === "" ? "—" : ref.summary}</span>}
            description={
              <Meta
                items={[
                  <span key="id" className={kit.mono}>
                    #{ref.id}
                  </span>,
                  ref.inherited === true && ref.source_task_id !== undefined ? `来源 #${ref.source_task_id} · 只读` : null,
                ]}
              />
            }
          >
            {ref.state === "" ? null : <Badge>{ref.state}</Badge>}
          </Row>
        ))}
      </Card>
    </Section>
  );
}

/**
 * 选中资产的详情：属性与关联意图 / 事实 / 发现。
 * @param props.taskId - 任务 id。
 * @param props.node - 选中的节点。
 * @returns 详情内容（含加载 / 失败 / 空四态）。
 */
function AssetDetail({ taskId, node }: { taskId: string; node: CoverageGraphNode }): ReactNode {
  const refs = useCoverageAssetRefs(taskId, node.asset_id ?? null);
  const groups = refs.data === null ? [] : coverageRefGroups(refs.data);
  const hasRefs = groups.some((group) => group.items.length > 0);

  const meta: { label: string; value: string | number | undefined; mono?: boolean; wrap?: boolean }[] = [
    { label: "类型", value: coverageKindLabel(node.kind) },
    { label: "测试状态", value: coverageTestStateLabel(node) },
    { label: "域名", value: node.domain, mono: true },
    { label: "根域名", value: node.root_domain, mono: true },
    { label: "IP", value: node.ip, mono: true },
    { label: "端口", value: node.port, mono: true },
    { label: "URL", value: node.url, mono: true, wrap: true },
    { label: "标题", value: node.page_title, wrap: true },
    { label: "状态码", value: node.status_code, mono: true },
    { label: "App", value: node.app_name },
    { label: "资产ID", value: node.asset_id, mono: true },
  ];
  const facts: Fact[] = meta
    .filter((row) => row.value !== undefined && row.value !== "" && row.value !== 0)
    .map((row) => ({
      key: row.label,
      label: row.label,
      value: String(row.value),
      mono: row.mono === true,
      wrap: row.wrap === true,
      title: String(row.value),
    }));

  const testTone = !node.in_scope ? "neutral" : node.tested ? "success" : "warning";

  return (
    <div className={css.detail} data-coverage-detail={node.key}>
      <div className={css.detailHead}>
        <Badge tone="info">{coverageKindLabel(node.kind)}</Badge>
        <span className={css.detailLabel} title={node.label}>
          {node.label}
        </span>
        <Badge tone={testTone}>{coverageTestStateLabel(node)}</Badge>
      </div>

      <Card quiet>
        <Facts items={facts} columns={2} />
      </Card>

      {node.asset_id === undefined ? (
        <Notice>这个节点不是资产，没有可查询的引用。</Notice>
      ) : refs.phase === "loading" ? (
        <Card quiet>
          <Skeleton label="读取引用" />
        </Card>
      ) : refs.phase === "offline" ? (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={refs.reload}>
              重试
            </Button>
          }
        >
          引用读取失败：{refs.error}
        </Notice>
      ) : hasRefs ? (
        <div className={css.refWrap}>
          {groups.map((group) => (
            <RefBlock key={group.title} title={group.title} items={group.items} />
          ))}
        </div>
      ) : (
        <Notice>这个资产在本任务还没有关联的意图、事实或发现。</Notice>
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
  const kindsPresent = COVERAGE_KINDS.filter((kind) => nodes.some((node) => node.kind === kind));

  const data = summary.phase === "ready" ? summary.data : null;
  const noScope = data !== null && data.enabled !== false && data.scope_rows === 0;
  const disabled = data !== null && data.enabled === false;

  return (
    <Page data={{ "data-coverage-view": "" }}>
      <PageHead
        title="资产测试覆盖度"
        adornment={<Badge>粗估，仅供参考</Badge>}
        lead="范围内资产中有多少已被 Agent 测试过；按资产关系画成覆盖图，点节点看它关联的意图、事实与发现。"
        actions={
          <IconButton
            label="刷新"
            spinning={summary.phase === "loading" || graph.phase === "loading"}
            data-coverage-refresh=""
            onClick={reloadAll}
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      />

      <Section title="概览" data={{ "data-coverage-summary": "" }}>
        {summary.phase === "loading" ? (
          <Card>
            <Skeleton label="读取覆盖度" />
          </Card>
        ) : null}
        {summary.phase === "offline" ? (
          <Notice
            tone="danger"
            action={
              <Button variant="ghost" size="sm" onClick={summary.reload}>
                重试
              </Button>
            }
          >
            覆盖度读取失败：{summary.error}
          </Notice>
        ) : null}
        {disabled ? (
          <Card>
            <Empty
              inCard
              icon={<IconShieldOutlineRegular size={18} />}
              title="资产覆盖度未开启"
              text="在设置里打开资产覆盖度后，这里才会有统计与覆盖图。"
            />
          </Card>
        ) : null}
        {noScope ? (
          <Card>
            <Empty
              inCard
              icon={<IconShieldOutlineRegular size={18} />}
              title="还没有测试范围"
              text="先在「资产」里登记任务的测试范围，覆盖度才有分母可算。"
            />
          </Card>
        ) : null}
        {data !== null && !disabled && !noScope ? (
          <>
            <Metrics
              items={[
                data.pct === null
                  ? { key: "pct", label: "覆盖率", value: coveragePercentText(data.pct), muted: true }
                  : {
                      key: "pct",
                      label: "覆盖率",
                      value: coveragePercentText(data.pct),
                      tone: data.pct >= 0.8 ? "success" : data.pct >= 0.3 ? "info" : "warning",
                    },
                {
                  key: "tested",
                  label: "已测 / 范围内",
                  value: (
                    <span>
                      {data.tested}
                      <span className={css.denominator}> / {data.denominator}</span>
                    </span>
                  ),
                },
                { key: "rows", label: "范围条目", value: data.scope_rows },
              ]}
            />
            {data.by_type.length === 0 ? null : (
              <Card>
                {data.by_type.map((bucket) => {
                  const ratio = bucket.total === 0 ? 0 : bucket.tested / bucket.total;
                  return (
                    <Row key={bucket.type} label={coverageKindLabel(bucket.type)} wideControl>
                      <span className={css.bar} aria-hidden="true">
                        <span className={css.barFill} style={{ width: `${Math.round(ratio * 100)}%` }} />
                      </span>
                      <span className={css.ratio}>
                        {bucket.tested}
                        <span className={css.denominator}> / {bucket.total}</span>
                      </span>
                    </Row>
                  );
                })}
              </Card>
            )}
          </>
        ) : null}
      </Section>

      <Section
        title="覆盖图"
        count={graph.phase === "ready" && nodes.length > 0 ? `${nodes.length} 个节点` : undefined}
        hint={
          disabled || noScope
            ? "有测试范围后显示"
            : graph.phase === "ready" && flow.nodes.length > 0
              ? "拖动平移 · 滚轮缩放 · 点节点看详情"
              : undefined
        }
        data={{ "data-coverage-graph": "" }}
      >
        {/* 没开启 / 没范围时概览已给出诚实空态，这里只留眉题提示，不叠第二张空卡。 */}
        {disabled || noScope ? null : (
          <>
        {graph.phase === "loading" ? (
          <Card>
            <Skeleton label="读取覆盖图" />
          </Card>
        ) : null}
        {graph.phase === "offline" ? (
          <Notice
            tone="danger"
            action={
              <Button variant="ghost" size="sm" onClick={graph.reload}>
                重试
              </Button>
            }
          >
            覆盖图读取失败：{graph.error}
          </Notice>
        ) : null}
        {graph.phase === "ready" && flow.nodes.length === 0 ? (
          <Card>
            <Empty
              inCard
              icon={<IconBranchOutlineRegular size={18} />}
              title="暂无范围内资产"
              text="锚定任务范围后，资产及其关系会画在这里。"
            />
          </Card>
        ) : null}
        {graph.phase === "ready" && flow.nodes.length > 0 ? (
          <Card className={css.graphCard}>
            <div className={css.legend}>
              <Meta
                items={[
                  `范围内 ${inScope}`,
                  coverageEnabled ? `已测 ${testedNodes}` : null,
                  `连线 ${edges.length}`,
                ]}
              />
              <span className={css.legendKinds}>
                {kindsPresent.map((kind) => (
                  <Badge key={kind}>{coverageKindLabel(kind)}</Badge>
                ))}
              </span>
            </div>
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
          </Card>
        ) : null}
          </>
        )}
      </Section>

      <Modal open={selected !== null} onClose={() => setSelectedKey(null)} title="资产覆盖详情" closeLabel="关闭">
        {selected === null ? null : <AssetDetail taskId={task.id} node={selected} />}
      </Modal>
    </Page>
  );
}
