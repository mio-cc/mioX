"use client";

/**
 * 发现链路图（A14，对照表 P2:C11、P2:C4）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/findings/detail/lineage.tsx:1-45。
 * 接口：`api.findingLineage(id)`（api.ts:759）→ `{ nodes: TaskNode[]; edges: Edge[] }`。
 * 用已安装的 @xyflow/react 自绘（旧页用 @antv/g6，不照搬；本文件不 import 旧组件）。
 */
import { useMemo } from "react";

import { Background, Controls, ReactFlow, type Edge as FlowEdge, type Node as FlowNode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { TaskNode } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { useFindingLineage } from "@/v2/data/finding-detail";

import css from "./FindingLineage.module.css";

/** 节点类型 → 中文（后端 ExploreKind）。 */
const KIND_LABEL: Record<string, string> = {
  task: "任务",
  begin: "起点",
  goal: "目标",
  intent: "意图",
  fact: "事实",
  finding: "漏洞",
  hint: "提示",
  digest: "摘要",
};

/**
 * 节点显示文本：优先 payload 里能读到的标题，否则 `类型 #id`。
 * @param node - 后端节点。
 * @returns 一行文本。
 */
function nodeLabel(node: TaskNode): string {
  const kind = KIND_LABEL[node.type] ?? node.type;
  const payload = node.payload ?? "";
  if (payload !== "") {
    try {
      const parsed = JSON.parse(payload) as { summary?: unknown; text?: unknown; goal?: unknown };
      const text = typeof parsed.summary === "string" ? parsed.summary : typeof parsed.text === "string" ? parsed.text : typeof parsed.goal === "string" ? parsed.goal : "";
      if (text.trim() !== "") return `${kind}：${text.trim().slice(0, 40)}`;
    } catch {
      const trimmed = payload.trim();
      if (trimmed !== "") return `${kind}：${trimmed.slice(0, 40)}`;
    }
  }
  return `${kind} #${node.id}`;
}

/**
 * 渲染一个发现的链路图。
 * @param props.findingId - 发现 id。
 * @returns 链路图，或加载 / 失败 / 空态。
 */
export function FindingLineage({ findingId }: { findingId: string }): React.ReactNode {
  const lineage = useFindingLineage(findingId);

  const graph = useMemo(() => {
    const data = lineage.data;
    if (data === null) return { nodes: [] as FlowNode[], edges: [] as FlowEdge[] };
    // 简单分层布局：每 5 个节点换一层，够读即可；不引额外布局库。
    const nodes: FlowNode[] = data.nodes.map((node, index) => ({
      id: node.id,
      position: { x: (index % 5) * 220, y: Math.floor(index / 5) * 130 },
      data: { label: nodeLabel(node) },
      type: "default",
    }));
    const edges: FlowEdge[] = data.edges.map((edge, index) => ({
      id: `e${index}-${edge.src}-${edge.dst}`,
      source: edge.src,
      target: edge.dst,
      label: edge.rel,
    }));
    return { nodes, edges };
  }, [lineage.data]);

  if (lineage.phase === "loading") return <div className={css.state}>加载链路图…</div>;
  if (lineage.phase === "offline") {
    return (
      <div className={css.stateError} role="alert">
        <span>链路图读取失败：{lineage.error}</span>
        <Button variant="outline" size="sm" onClick={lineage.reload}>
          重试
        </Button>
      </div>
    );
  }
  if (graph.nodes.length === 0) {
    return (
      <div className={css.empty} data-finding-lineage-empty="">
        <Tag tone="neutral">暂无链路</Tag>
        <span>这个漏洞还没有可用于展示的血缘节点。</span>
      </div>
    );
  }

  return (
    <div className={css.wrap} data-finding-lineage={graph.nodes.length}>
      <div className={css.legend}>
        <span>节点 {graph.nodes.length} 个</span>
        <span>关系 {graph.edges.length} 条</span>
        <span className={css.hint}>拖动可平移，滚轮缩放</span>
      </div>
      <div className={css.canvas}>
        <ReactFlow nodes={graph.nodes} edges={graph.edges} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
