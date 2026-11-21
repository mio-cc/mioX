"use client";

/**
 * 探索图视图（会话视图 tab「探索图」，对照表 P1:C16、P2:L1）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/graph-tab.tsx（旧页用 @antv/g6 画探索图）
 * DSH 依据：DSH 无探索图，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：全量图 `api.explorationGraph(task?)`（api.ts:795）→ `{ nodes: TaskNode[]; edges: Edge[] }`；
 * 画布直接迁移旧版 ExplorationGraph（components/exploration-graph.tsx，用户要求「别重写，迁移旧版适配」）；
 * U2：原「按节点分页浏览」块与「探索 ▸ 时间线」同一接口同一 hook（useBroadcastPage），
 * 已删去，按时间翻节点请用时间线（.tmp/d6-ia-inventory.md §4.2）。
 *
 * D2 版式：宽页 → PageHead（统计 + 刷新）→ 筛选条 → 画布卡（定高画布 + 底部图例条）
 * →「图中节点」卡。只重排画布之外，画布组件不改。
 */
import { type ReactNode, useMemo, useState } from "react";

import type { Task, TaskNode } from "@/lib/types";
import { ExplorationGraph } from "@/components/exploration-graph";
import {
  Badge,
  Card,
  Empty,
  FilterBar,
  IconButton,
  kit,
  Meta,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
  type KitTone,
} from "@/components/v2/design/Kit";
import { IconBranchOutlineRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Button } from "@/vendor/dsh/primitives/Button";
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

import css from "./GraphView.module.css";

/** 过滤档位选项。 */
const FILTER_OPTIONS = [
  { value: "all", label: "全部节点" },
  { value: "intent", label: "只看意图" },
  { value: "finding", label: "只看漏洞" },
] as const;

/**
 * 状态的 kit 色调（旧 Tag 的 outline 归为中性）。
 * @param state - 后端状态。
 * @returns Badge 色调。
 */
function stateTone(state: string): KitTone {
  const tone = exploreStateTone(state);
  return tone === "outline" ? "neutral" : tone;
}

/**
 * 种类的 kit 色调：漏洞醒目、意图/目标用强调色，其余中性（与播报页一致）。
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
 * 一个节点的卡内行：标题 + 种类，#id · 优先级，右侧状态。
 * @param props.node - 节点。
 * @param props.data - 校验钩子。
 * @returns 行。
 */
function NodeRow({ node, data }: { node: TaskNode; data: Record<`data-${string}`, string> }): ReactNode {
  const title = explorationNodeTitle(node);
  return (
    <Row
      data={data}
      label={<span title={title}>{title}</span>}
      labelAdornment={<Badge tone={kindTone(node.type)}>{exploreKindLabel(node.type)}</Badge>}
      description={
        <Meta
          items={[
            <span key="id" className={kit.mono}>
              #{node.id}
            </span>,
            `优先级 ${node.priority}`,
          ]}
        />
      }
    >
      <Badge tone={stateTone(node.state)}>{exploreStateLabel(node.state)}</Badge>
    </Row>
  );
}

/**
 * 渲染当前任务的探索图。
 * @param props.task - 当前选中的任务。
 * @returns 探索图，或加载 / 失败 / 空态。
 */
export function GraphView({ task }: { task: Task }): ReactNode {
  const graph = useExplorationGraph(task.id);
  const [filter, setFilter] = useState<ExplorationFilter>("all");
  const kept = useMemo(
    () => (graph.data === null ? [] : filterExplorationNodes(graph.data.nodes, filter)),
    [graph.data, filter],
  );
  const keptEdges = useMemo(
    () => (graph.data === null ? [] : filterExplorationEdges(graph.data.edges, kept)),
    [graph.data, kept],
  );
  const relList = useMemo(
    () => [...new Set((graph.data?.edges ?? []).map((edge) => String(edge.rel)))].sort(),
    [graph.data],
  );
  const kindList = useMemo(() => [...new Set(kept.map((node) => node.type))], [kept]);

  const head = (lead: ReactNode): ReactNode => (
    <PageHead
      title="探索图"
      lead={lead}
      actions={
        <IconButton label="刷新" spinning={graph.phase === "loading"} onClick={graph.reload}>
          <IconRefreshOutlineRegular size={14} />
        </IconButton>
      }
    />
  );

  if (graph.phase === "loading") {
    return (
      <Page width="wide">
        {head("Agent 的目标、意图、事实与漏洞之间的派生关系。")}
        <Card>
          <Skeleton label="加载探索图" />
        </Card>
      </Page>
    );
  }
  if (graph.phase === "offline") {
    return (
      <Page width="wide">
        {head("Agent 的目标、意图、事实与漏洞之间的派生关系。")}
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={graph.reload}>
              重试
            </Button>
          }
        >
          探索图读取失败：{graph.error}
        </Notice>
      </Page>
    );
  }
  if (graph.data === null || graph.data.nodes.length === 0) {
    return (
      <Page width="wide">
        {head("Agent 的目标、意图、事实与漏洞之间的派生关系。")}
        <Card>
          <Empty
            data={{ "data-exploration-empty": "" }}
            icon={<IconBranchOutlineRegular size={18} />}
            title="暂无探索图数据"
            text="这个任务还没有产生探索节点；Agent 开始探索后，节点与关系会画在这里。"
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page width="wide" data={{ "data-exploration-graph": String(graph.data.nodes.length) }}>
      {head("Agent 的目标、意图、事实与漏洞之间的派生关系；点节点看属性、关联与原始数据。")}

      <div className={css.bar}>
        <FilterBar
          id="exploration-graph-filter"
          value={filter}
          options={FILTER_OPTIONS}
          onChange={setFilter}
          label="探索图节点过滤"
        />
        <span className={css.count}>
          <Meta
            items={[
              <span key="n">
                节点 <span className={css.num}>{kept.length}</span>
                {kept.length === graph.data.nodes.length ? null : ` / ${graph.data.nodes.length}`}
              </span>,
              <span key="e">
                关系 <span className={css.num}>{keptEdges.length}</span>
              </span>,
            ]}
          />
        </span>
      </div>

      {kept.length === 0 ? (
        <Card>
          <Empty
            data={{ "data-exploration-filter-empty": "" }}
            icon={<IconBranchOutlineRegular size={18} />}
            title="当前筛选没有匹配的节点"
            text="切换到「全部节点」可以看完整探索图。"
            action={
              <Button variant="outline" size="sm" onClick={() => setFilter("all")}>
                看全部节点
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className={css.graphCard}>
          {/* 直接迁移旧版 ExplorationGraph（exploration-graph.tsx）。旧组件本体不设高度
              （exploration-graph.tsx:657 只 wrap w-full overflow-hidden rounded-xl），
              必须外部给高度，否则 ReactFlow 无声明高度→零高度不显示。 */}
          <div className={css.graphCanvas}>
            <ExplorationGraph nodes={kept} edges={keptEdges} className={css.explorationHeight} />
          </div>
          <div className={css.legend} data-exploration-legend="">
            <span className={css.legendGroup}>
              <span className={css.legendLabel}>关系</span>
              {relList.length === 0 ? (
                <span className={css.legendMuted}>这张图没有边</span>
              ) : (
                relList.map((rel) => (
                  <Badge key={rel} title="边上的字是关系类型（rel），原文照后端返回显示">
                    {rel}
                  </Badge>
                ))
              )}
            </span>
            <span className={css.legendGroup}>
              <span className={css.legendLabel}>节点</span>
              {kindList.map((kind) => (
                <Badge key={kind} tone={kindTone(kind)}>
                  {exploreKindLabel(kind)}
                </Badge>
              ))}
            </span>
            <span className={css.legendHint}>拖动平移 · 滚轮缩放</span>
          </div>
        </Card>
      )}

      {kept.length === 0 ? null : (
        <Section title="图中节点" count={kept.length}>
          <Card className={css.scrollCard} data={{ "data-exploration-nodes": "" }}>
            {kept.map((node) => (
              <NodeRow key={node.id} node={node} data={{ "data-node-id": node.id }} />
            ))}
          </Card>
        </Section>
      )}

    </Page>
  );
}
