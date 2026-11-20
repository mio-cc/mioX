"use client";

/**
 * 发现页「按资产」视图的左侧资产树（对照表 P2:B21 树部分、P2:B22 面包屑数据）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/findings/_components/asset-tree.tsx:25-45（类型
 * 图标与中文名）、:56-104（深层节点相对父节点的短标签）、:106-146（`buildAssetTree` /
 * `assetPathOf`）、:148-170（`filterTree` 按关键词过滤并保留祖先链）、:185-316（「全部资产」
 * 行、过滤框、刷新按钮、顶层默认展开、搜索时全部展开、截断提示）；树数据来源与「不随选中
 * 节点变化」的口径见旧页 `findings/page.tsx:346-370`（`loadAssetTree` 不带 assetScope）。
 * DSH 依据：DSH 无树原语，按「主区整页」内的自绘树扩展（100-实施计划总表 §6「导航结构自绘」）；
 * 折叠箭头/过滤框用原生元素 + `--dsw-*` 变量，与 `FindingsDataPage.tsx` 的筛选条同一写法。
 * 对照表行：P2:B21 P2:B22
 *
 * 本文件只有展示与本地交互（展开/折叠、本地过滤、点节点选中）；取数在
 * `v2/data/findings-page.ts` 的 `useFindingAssetTree`（`api.findingAssetTree`，api.ts:651）。
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";

import type { FindingAssetKind, FindingAssetNode } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconChevronRightOutlineRegular,
  IconGlobeOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTreeCornerRegular,
  IconUserOutlineRegular,
  IconWorkspaceTreeOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import css from "./FindingsAssetTree.module.css";

/** 资产类型的中文名（旧页 asset-tree.tsx:36-45 的 `KIND_LABEL`，逐条照抄）。 */
export const ASSET_KIND_LABEL: Record<string, string> = {
  company: "企业",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  app: "应用",
  service: "服务",
  endpoint: "接口",
  none: "未关联",
};

/**
 * 树节点的类型图标（旧页用 lucide 的 Building/Globe/Network/Smartphone/LayoutTemplate/
 * Link/CircleDashed）。这里换成 vendor 里真实存在的 DSH 产品图标：企业与未关联用
 * 用户/树图标，域名与 IP 用地球，应用与服务用树，接口用链接（「同一种资产在两处长得
 * 一样」的意图保留，具体字形按 DSH 图标集）。
 */
const KIND_ICON: Record<FindingAssetKind, (props: { size?: number; className?: string }) => ReactNode> = {
  company: IconUserOutlineRegular,
  root_domain: IconGlobeOutlineRegular,
  subdomain: IconGlobeOutlineRegular,
  ip: IconGlobeOutlineRegular,
  app: IconWorkspaceTreeOutlineRegular,
  service: IconWorkspaceTreeOutlineRegular,
  endpoint: IconLinkOutlineRegular,
  none: IconTreeCornerRegular,
};

/** 组装后的树节点：后端的扁平节点 + children + 深度 + 树上实际渲染的文字。 */
export interface AssetTreeNode extends FindingAssetNode {
  children: AssetTreeNode[];
  depth: number;
  /** 树上真正渲染的文字；完整 label 仍保留在 `label`（悬停提示与面包屑用）。 */
  display: string;
}

/** 去掉 `[::1]` 这类方括号，只留宿主本体。 */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** 解析 URL，失败返回 null（资产 label 不一定是合法 URL）。 */
function parseAssetURL(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * 取一个节点代表的宿主：URL 取 hostname，「host:port」取 host，其余就是标签本身
 * （旧页 asset-tree.tsx:70-75）。
 */
function hostOf(label: string): string {
  const url = parseAssetURL(label);
  if (url !== null) return stripBrackets(url.hostname);
  const hostPort = label.match(/^(.+):(\d+)$/);
  return stripBrackets(hostPort === null ? label : hostPort[1]);
}

/**
 * 深层节点的短标签：去掉与父节点重复的前缀（旧页 asset-tree.tsx:77-104 的 `shortLabel`，
 * 逐分支照抄）。深层节点本来就窄，重复宿主会把端口与路径挤掉。
 * @param node - 当前节点。
 * @param parent - 父节点；顶层节点传 undefined，原样返回 label。
 * @returns 树上显示的文字。
 */
export function shortAssetLabel(node: FindingAssetNode, parent?: FindingAssetNode): string {
  if (parent === undefined) return node.label;

  if (node.kind === "subdomain" && node.label.endsWith(`.${parent.label}`)) {
    return node.label.slice(0, -(parent.label.length + 1)) || node.label;
  }
  if (node.kind !== "service" && node.kind !== "endpoint") return node.label;

  if (node.label.startsWith(parent.label)) {
    return node.label.slice(parent.label.length) || node.label;
  }
  if (hostOf(node.label) !== hostOf(parent.label)) return node.label;

  const url = parseAssetURL(node.label);
  if (url === null) return node.label;
  if (node.kind === "endpoint") return `${url.pathname}${url.search}` || "/";
  const scheme = url.protocol.replace(":", "");
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  return `${scheme} :${port}`;
}

/**
 * 把后端的扁平节点数组组装成树（旧页 asset-tree.tsx:106-130）：后端已按「同父下发现多的
 * 在前」排好序，这里只按数组顺序挂载；父节点被截断丢掉时上提为顶层，不让子树消失。
 * @param nodes - 后端 `FindingAssetTree.nodes`。
 * @returns 顶层节点数组。
 */
export function buildAssetTree(nodes: readonly FindingAssetNode[]): AssetTreeNode[] {
  const byKey = new Map<string, AssetTreeNode>();
  for (const node of nodes) {
    byKey.set(node.key, { ...node, children: [], depth: 0, display: node.label });
  }
  const roots: AssetTreeNode[] = [];
  for (const node of nodes) {
    const current = byKey.get(node.key);
    if (current === undefined) continue;
    const parent = node.parent === undefined ? undefined : byKey.get(node.parent);
    if (parent === undefined) {
      roots.push(current);
    } else {
      parent.children.push(current);
      current.display = shortAssetLabel(node, parent);
    }
  }
  const setDepth = (node: AssetTreeNode, depth: number): void => {
    node.depth = depth;
    for (const child of node.children) setDepth(child, depth + 1);
  };
  for (const root of roots) setDepth(root, 0);
  return roots;
}

/**
 * 从顶层到该节点的路径，用于右侧面包屑（旧页 asset-tree.tsx:134-146 的 `assetPathOf`）；
 * 每一级同样只显示相对上一级的增量。父链成环时靠 `seen` 截断。
 * @param nodes - 后端扁平节点。
 * @param key - 选中的节点 key；空串表示「全部资产」，返回空数组。
 * @returns 从根到该节点的路径。
 */
export function assetPathOf(
  nodes: readonly FindingAssetNode[],
  key: string,
): ReadonlyArray<FindingAssetNode & { display: string }> {
  if (key === "") return [];
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const path: FindingAssetNode[] = [];
  const seen = new Set<string>();
  let current = byKey.get(key);
  while (current !== undefined && !seen.has(current.key)) {
    seen.add(current.key);
    path.unshift(current);
    current = current.parent === undefined ? undefined : byKey.get(current.parent);
  }
  return path.map((node, index) => ({
    ...node,
    display: shortAssetLabel(node, path[index - 1]),
  }));
}

/**
 * 按关键词过滤树（旧页 asset-tree.tsx:150-161）：命中的节点保留，并保留整条祖先链
 * （祖先自身可以不命中）；命中节点的子孙一并保留，便于继续下钻。
 * @param roots - 组装好的顶层节点。
 * @param keyword - 过滤词，空白表示不过滤。
 * @returns 过滤后的顶层节点（不改原树）。
 */
export function filterAssetTree(roots: readonly AssetTreeNode[], keyword: string): AssetTreeNode[] {
  const kw = keyword.trim().toLowerCase();
  if (kw === "") return [...roots];
  const walk = (node: AssetTreeNode): AssetTreeNode | null => {
    if (node.label.toLowerCase().includes(kw)) return node;
    const children = node.children.map(walk).filter((child): child is AssetTreeNode => child !== null);
    if (children.length === 0) return null;
    return { ...node, children };
  };
  return roots.map(walk).filter((node): node is AssetTreeNode => node !== null);
}

/** 收集(子)树里的全部 key，用于「搜索时把命中分支全部展开」（旧页 :164-170）。 */
function collectAssetKeys(nodes: readonly AssetTreeNode[], out: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    out.add(node.key);
    collectAssetKeys(node.children, out);
  }
  return out;
}

/**
 * 截断提示里的层级名（旧页 asset-tree.tsx:310-311 把原值经 `KIND_LABEL` 转中文）。
 * @param kinds - 后端 `dropped_kinds` 原值。
 * @returns 用「 / 」连接的中文层名。
 */
export function droppedKindsText(kinds: readonly string[]): string {
  return kinds.map((kind) => ASSET_KIND_LABEL[kind] ?? kind).join(" / ");
}

/** 资产树上的一行。 */
function AssetTreeRow({
  node,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  node: AssetTreeNode;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}): ReactNode {
  const Icon = KIND_ICON[node.kind] ?? IconGlobeOutlineRegular;
  const hasChildren = node.children.length > 0;
  const kindLabel = ASSET_KIND_LABEL[node.kind] ?? node.kind;
  return (
    <li
      className={selected ? `${css.nodeRow} ${css.nodeRowSelected}` : css.nodeRow}
      style={{ paddingLeft: 2 + node.depth * 10 }}
      data-asset-key={node.key}
      data-asset-kind={node.kind}
      data-asset-selected={selected ? "true" : undefined}
    >
      {hasChildren ? (
        <button
          type="button"
          className={css.twisty}
          aria-label={open ? "折叠" : "展开"}
          aria-expanded={open}
          onClick={onToggle}
          data-asset-twisty={node.key}
        >
          <IconChevronRightOutlineRegular size={11} className={open ? css.twistyOpen : undefined} />
        </button>
      ) : (
        <span className={css.twistyPlaceholder}>
          <IconTreeCornerRegular size={9} />
        </span>
      )}
      <button
        type="button"
        className={css.nodeLabel}
        title={`${kindLabel} · ${node.label}`}
        aria-label={`按资产筛选：${node.label}（${kindLabel}，${node.total} 条发现）`}
        onClick={onSelect}
        data-asset-select={node.key}
      >
        <Icon size={12} className={css.nodeIcon} />
        <span className={css.nodeText}>{node.display}</span>
      </button>
      <span className={css.nodeCounts} title={`共 ${node.total} 条发现`}>
        {node.critical > 0 ? (
          <span className={css.countCritical} title={`严重 ${node.critical}`}>
            {node.critical}
          </span>
        ) : null}
        {node.high > 0 ? (
          <span className={css.countHigh} title={`高危 ${node.high}`}>
            {node.high}
          </span>
        ) : null}
        <span className={css.countTotal}>{node.total}</span>
      </span>
    </li>
  );
}

/**
 * 资产树：过滤框 + 刷新 + 「全部资产」行 + 自绘树 + 截断提示。
 * 选中语义：点「全部资产」→ `onSelect("")`；点已选中的节点 → 取消选择（旧页 :251）。
 * @param props.nodes - 后端节点数组。
 * @param props.selected - 当前选中的节点 key，空串表示全部。
 * @param props.findingTotal - 全部资产下的发现总数（「全部资产」行右侧计数）。
 * @param props.truncated - 后端是否截断了层级。
 * @param props.droppedKinds - 被截断的层级种类。
 * @param props.loading - 正在重读（刷新按钮禁用，行不消失）。
 * @param props.onSelect - 选中回调，参数为节点 key，空串表示全部。
 * @param props.onRefresh - 刷新树。
 * @returns 树面板。
 */
export function FindingsAssetTree({
  nodes,
  selected,
  findingTotal,
  truncated,
  droppedKinds,
  loading,
  onSelect,
  onRefresh,
}: {
  nodes: readonly FindingAssetNode[];
  selected: string;
  findingTotal: number;
  truncated: boolean;
  droppedKinds: readonly string[];
  loading: boolean;
  onSelect: (key: string) => void;
  onRefresh: () => void;
}): ReactNode {
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  // 记住用户手动折叠过的节点，免得「顶层默认展开」在每次重读后又把它们撑开（旧页 :197-198）。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());

  const roots = useMemo(() => buildAssetTree(nodes), [nodes]);
  const visible = useMemo(() => filterAssetTree(roots, keyword), [roots, keyword]);

  // 搜索时把匹配到的分支全部展开，否则命中项藏在折叠节点里等于没搜（旧页 :203-205）。
  const searching = keyword.trim() !== "";
  const searchKeys = useMemo(() => (searching ? collectAssetKeys(visible) : null), [searching, visible]);

  const isExpanded = useCallback(
    (node: AssetTreeNode): boolean => {
      if (searchKeys !== null) return searchKeys.has(node.key);
      if (expanded.has(node.key)) return true;
      // 顶层默认展开一层：再深的层级要用户自己点开，免得一次铺开上千行。
      return node.depth === 0 && !collapsed.has(node.key);
    },
    [collapsed, expanded, searchKeys],
  );

  const toggle = useCallback(
    (node: AssetTreeNode): void => {
      const open = isExpanded(node);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.delete(node.key);
        else next.add(node.key);
        return next;
      });
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (open) next.add(node.key);
        else next.delete(node.key);
        return next;
      });
    },
    [isExpanded],
  );

  const rows = useMemo(() => {
    const out: AssetTreeNode[] = [];
    const push = (list: readonly AssetTreeNode[]): void => {
      for (const node of list) {
        out.push(node);
        if (isExpanded(node) && node.children.length > 0) push(node.children);
      }
    };
    push(visible);
    return out;
  }, [isExpanded, visible]);

  if (nodes.length === 0) {
    return (
      <div className={css.wrap} data-findings-asset-tree="empty">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelect("")}
          className={css.allRowSelected}
          data-asset-select-all=""
        >
          全部资产
          <span className={css.allCount}>{findingTotal}</span>
        </Button>
        <p className={css.hint}>
          {loading ? "读取中…" : "当前筛选下没有关联到资产的发现。"}
        </p>
      </div>
    );
  }

  return (
    <div className={css.wrap} data-findings-asset-tree={loading ? "refreshing" : "ready"}>
      <div className={css.tools}>
        <label className={css.search}>
          <IconSearchOutlineRegular size={12} className={css.searchIcon} />
          <input
            type="search"
            className={css.searchInput}
            value={keyword}
            placeholder="过滤资产"
            aria-label="过滤资产"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKeyword(event.currentTarget.value)}
            data-asset-filter=""
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={onRefresh}
          title="刷新资产树"
          aria-label="刷新资产树"
          data-asset-refresh=""
        >
          <IconRefreshOutlineRegular size={13} />
        </Button>
      </div>

      <button
        type="button"
        className={selected === "" ? `${css.allRow} ${css.allRowSelected}` : css.allRow}
        aria-pressed={selected === ""}
        onClick={() => onSelect("")}
        data-asset-select-all=""
      >
        <span>全部资产</span>
        <span className={css.allCount}>{findingTotal}</span>
      </button>

      <ul className={css.tree} data-asset-rows="">
        {rows.map((node) => (
          <AssetTreeRow
            key={node.key}
            node={node}
            open={isExpanded(node)}
            selected={selected === node.key}
            onToggle={() => toggle(node)}
            onSelect={() => onSelect(selected === node.key ? "" : node.key)}
          />
        ))}
      </ul>

      {rows.length === 0 ? <p className={css.hint}>没有匹配的资产。</p> : null}

      {truncated ? (
        <p className={css.truncated} data-asset-truncated="">
          资产过多，已隐藏{droppedKindsText(droppedKinds)}层级（计数仍已计入上层）。用筛选或过滤框收窄可看到完整层级。
        </p>
      ) : null}
    </div>
  );
}
