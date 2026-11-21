"use client";

/**
 * 任务资产视图（会话视图 tab「资产」，对照表 P1:C20、P1:C21、P1:C22、P2:D14、P2:D15、P2:D16、P2:D17）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/assets-tab.tsx:342-707
 * （类型页签 + 计数、DSL 搜索框、6 类资产表格、每页 50 分页、来源列、移出任务 + 二次确认）、
 * :270-340（「新增测试资产」= 填测试范围后调 `api.registerTaskAssetScopes`）、
 * sessions-tab.tsx:446-479（意图资产只读展示）。
 * DSH 依据：DSH 无任务资产页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：全部走 `v2/data/task-assets.ts`（`api.taskAssets` api.ts:586、`api.searchTaskAssets` :592、
 * `api.assetCounts` :581、`api.attachTaskAssets` :596、`api.detachTaskAsset` :603、
 * `api.registerTaskAssetScopes` :601、`api.taskIntentAssets` :604）。
 *
 * D2 版式：PageHead → 「测试资产」（类型筛选 + DSL 搜索与一行语法提示 → 资产卡：每行勾选 / 资产 / 说明 / 来源 / 分离
 * → 底部分页条）→ 「意图资产（只读）」卡 → 「登记测试范围」卡（多行编辑器 + 识别结果 + 主按钮）。
 * 数据与写入行为不变。
 */
import { type ReactNode, useEffect, useState } from "react";

import type { Asset, CompanyScopeKind, IntentAsset, NewAssetType, Task } from "@/lib/types";
import { parseCompanyScopeText } from "@/lib/company-scope";
import { toast } from "@/components/v2/settings/Toast";
import { assetTypeLabel } from "@/v2/data/assets-page";
import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import {
  Badge,
  Card,
  Empty,
  IconButton,
  kit,
  Meta,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCloseOutlineRegular,
  IconDatabaseOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  assetDslHint,
  attachTaskAssets,
  detachTaskAsset,
  registerTaskAssetScopes,
  TASK_ASSETS_PAGE_SIZE,
  TASK_ASSET_TYPES,
  useTaskAssetCounts,
  useTaskAssetsPage,
  useTaskIntentAssets,
} from "@/v2/data/task-assets";

import css from "./TaskAssetsView.module.css";

/** 搜索框防抖（卡片 C15：250ms）。 */
const SEARCH_DEBOUNCE_MS = 250;

/** 范围类型的中文名（旧组件 scope-text-editor.tsx:11-17）。 */
const SCOPE_KIND_LABELS: Record<CompanyScopeKind, string> = {
  domain: "域名",
  ip: "IP",
  cidr: "CIDR",
  icp: "ICP",
  keyword: "关键词",
};

/** 范围类型的展示顺序（同上）。 */
const SCOPE_KIND_ORDER: readonly CompanyScopeKind[] = ["domain", "ip", "cidr", "icp", "keyword"];

/** 资产来源的中文名（lib/task-assets.ts:12-21，只读引用其取值口径）。 */
const SOURCE_LABELS: Record<string, string> = {
  agent: "Agent 发现",
  anchor: "黑板锚点",
  api: "资产 API",
  company: "企业关联",
  legacy: "历史关联",
  manual: "人工加入",
  system: "系统关联",
  task: "任务初始化",
};

/**
 * 资产来源的中文名。
 * @param source - 后端 `task_source`。
 * @returns 中文名；未知来源原样返回。
 */
function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * 一行资产的主标识（照旧页 assets-tab.tsx:72-89 的优先级）。
 * @param asset - 后端资产行。
 * @returns 用于行标题的文本。
 */
function assetLabel(asset: Asset): string {
  switch (asset.type) {
    case "root_domain":
    case "subdomain":
      return asset.domain || `#${asset.id}`;
    case "ip":
      return asset.ip || `#${asset.id}`;
    case "app":
      return asset.app_name || asset.url || `#${asset.id}`;
    case "service": {
      const host = asset.ip || asset.domain || "";
      const address = [host, asset.port === undefined ? "" : String(asset.port)].filter(Boolean).join(":");
      return asset.url || address || asset.service_name || `#${asset.id}`;
    }
    case "endpoint":
      return [asset.method, asset.url].filter(Boolean).join(" ") || `#${asset.id}`;
    default:
      return `#${asset.id}`;
  }
}

/**
 * 一行的次要说明（随类型不同取不同字段）。
 * @param asset - 后端资产行。
 * @returns 一句话摘要，可能为空串。
 */
function assetDetail(asset: Asset): string {
  switch (asset.type) {
    case "root_domain":
      return asset.icp === undefined || asset.icp === "" ? "" : `ICP ${asset.icp}`;
    case "subdomain": {
      const parts = [asset.root_domain, asset.record_type].filter((value) => value !== undefined && value !== "");
      const record = Array.isArray(asset.record_value) ? asset.record_value.join(", ") : (asset.record_value ?? "");
      if (record !== "") parts.push(record);
      return parts.join(" · ");
    }
    case "ip": {
      const ports = (asset.open_ports ?? []).map((item) => (item.service ? `${item.port}/${item.service}` : String(item.port)));
      const parts = [asset.c_segment, ports.length > 0 ? `端口 ${ports.join(", ")}` : ""].filter(
        (value) => value !== undefined && value !== "",
      );
      return parts.join(" · ");
    }
    case "app": {
      const parts = [asset.category, asset.page_title].filter((value) => value !== undefined && value !== "");
      return parts.join(" · ");
    }
    case "service": {
      const parts = [
        asset.status_code === undefined ? "" : String(asset.status_code),
        asset.page_title ?? "",
        (asset.technologies ?? []).join(", "),
      ].filter((value) => value !== "");
      return parts.join(" · ");
    }
    case "endpoint":
      return (asset.params ?? [])
        .map((item) => {
          const name = typeof item.name === "string" ? item.name : "";
          const location = typeof item.location === "string" ? item.location : "";
          return name === "" ? "" : `${name}(${location === "" ? "?" : location})`;
        })
        .filter((value) => value !== "")
        .join(", ");
    default:
      return "";
  }
}

/**
 * 类型筛选条（照旧页 assets-tab.tsx:489-504：每个类型带自己的计数）。
 * 外观与 kit FilterBar 一致（复用其类名），自己渲染是为了保留每项的 `data-task-assets-tab` 钩子。
 * @returns 类型页签。
 */
function TypeTabs({
  value,
  counts,
  onChange,
}: {
  value: NewAssetType;
  counts: Record<string, number>;
  onChange: (next: NewAssetType) => void;
}): ReactNode {
  return (
    <div className={kit.filterBar} role="tablist" aria-label="资产类型" data-kit-filter-bar="" data-task-assets-tabs="">
      {TASK_ASSET_TYPES.map((type) => {
        const active = type === value;
        const count = counts[type] ?? 0;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-task-assets-tab={type}
            className={active ? `${kit.filter} ${kit.filterActive}` : kit.filter}
            onClick={() => onChange(type)}
          >
            {assetTypeLabel(type)}
            <span className={kit.filterCount}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 意图资产的色调：域名/IP 用强调色，其余中性。 */
function intentTone(asset: IntentAsset): "info" | "neutral" {
  return asset.type === "root_domain" || asset.type === "subdomain" || asset.type === "ip" ? "info" : "neutral";
}

/**
 * 渲染任务资产视图。
 * @param props.task - 当前选中的任务。
 * @returns 资产列表、附加/分离、意图资产与测试范围登记。
 */
export function TaskAssetsView({ task }: { task: Task }): ReactNode {
  const [type, setType] = useState<NewAssetType>("root_domain");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const dsl = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const list = useTaskAssetsPage({ taskId: task.id, type, dsl, page, size: TASK_ASSETS_PAGE_SIZE });
  const counts = useTaskAssetCounts(task.id);
  const intent = useTaskIntentAssets(task.id);

  // 换任务或换类型：回到第一页并清空搜索（旧页 assets-tab.tsx:369-376）。
  useEffect(() => {
    setPage(0);
    setQuery("");
  }, [task.id, type]);

  const [selected, setSelected] = useState<number[]>([]);
  // 选中项在换页后保留，但换类型/换任务/换搜索时必须清空（否则会附加别处勾的行）。
  useEffect(() => {
    setSelected([]);
  }, [task.id, type, dsl]);

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachSummary, setAttachSummary] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const [detachTarget, setDetachTarget] = useState<Asset | null>(null);
  const [detachBusy, setDetachBusy] = useState(false);
  const [detachError, setDetachError] = useState<string | null>(null);

  const [scopeText, setScopeText] = useState("");
  const [scopeConfirm, setScopeConfirm] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const parsedScope = parseCompanyScopeText(scopeText);

  const pageCount = Math.max(1, Math.ceil(list.total / TASK_ASSETS_PAGE_SIZE));

  /**
   * 重新读取列表与计数（写操作成功后）。
   */
  const refreshAll = (): void => {
    list.reload();
    counts.reload();
  };

  /**
   * 勾选/取消勾选一行。
   * @param id - 资产 id。
   * @param next - 目标勾选状态。
   */
  const toggleRow = (id: number, next: boolean): void => {
    setSelected((current) => (next ? (current.includes(id) ? current : [...current, id]) : current.filter((x) => x !== id)));
  };

  /**
   * 提交「附加到任务」（`POST /tasks/{id}/assets`，带 asset_ids + source_summary）。
   */
  const submitAttach = (): void => {
    if (attachBusy || selected.length === 0) return;
    const summary = attachSummary.trim();
    if (summary === "") return;
    setAttachBusy(true);
    setAttachError(null);
    attachTaskAssets(task.id, selected, summary)
      .then((result) => {
        setAttachBusy(false);
        setAttachOpen(false);
        setAttachSummary("");
        setSelected([]);
        toast(`已附加 ${result.attached} 项，${result.existing} 项本已在任务中`);
        refreshAll();
      })
      .catch((reason: unknown) => {
        setAttachBusy(false);
        setAttachError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  /**
   * 提交「从任务分离」（`DELETE /tasks/{id}/assets/{assetId}`，已在弹窗里二次确认过）。
   */
  const submitDetach = (): void => {
    if (detachBusy || detachTarget === null) return;
    setDetachBusy(true);
    setDetachError(null);
    detachTaskAsset(task.id, detachTarget.id)
      .then(() => {
        setDetachBusy(false);
        setDetachTarget(null);
        setSelected((current) => current.filter((id) => id !== detachTarget.id));
        toast("已从任务分离");
        refreshAll();
        intent.reload();
      })
      .catch((reason: unknown) => {
        setDetachBusy(false);
        setDetachError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  /**
   * 提交「登记测试范围」（`POST /tasks/{id}/assets`，带 scope 规则）。
   */
  const submitScope = (): void => {
    const rules = parsedScope.rules;
    if (scopeBusy || rules.length === 0 || parsedScope.errors.length > 0) return;
    setScopeBusy(true);
    setScopeError(null);
    setScopeNotice(null);
    registerTaskAssetScopes(task.id, rules)
      .then((result) => {
        setScopeBusy(false);
        setScopeConfirm(false);
        setScopeText("");
        setScopeNotice(
          `已登记 ${result.requested} 条范围：新增 ${result.scopes_added} 条、已存在 ${result.scopes_existing} 条；` +
            `关联资产新 ${result.assets_linked} 项、已有 ${result.assets_existing} 项`,
        );
        toast("测试范围已登记");
        refreshAll();
        intent.reload();
      })
      .catch((reason: unknown) => {
        setScopeBusy(false);
        setScopeError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const scopeCounts = SCOPE_KIND_ORDER.map((kind) => ({
    kind,
    count: parsedScope.rules.filter((rule) => rule.kind === kind).length,
  })).filter((row) => row.count > 0);

  const totalHint =
    counts.phase === "ready" ? `共 ${counts.total} 项` : counts.phase === "loading" ? "统计中…" : "统计失败";

  return (
    <Page data={{ "data-task-assets": "" }}>
      <PageHead
        title="资产"
        lead="本任务关联的测试资产、意图引用到的资产，以及给 Agent 登记新的测试范围。"
        actions={
          <IconButton
            label="刷新"
            spinning={list.phase === "loading" || counts.phase === "loading"}
            onClick={refreshAll}
            data-task-assets-refresh=""
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      />

      <Section
        title="测试资产"
        count={<span data-task-assets-total={counts.total}>{totalHint}</span>}
        data={{ "data-task-assets-list": "" }}
      >
        <TypeTabs value={type} counts={counts.counts} onChange={setType} />

        <div className={css.search}>
          <Input
            icon={<IconSearchOutlineRegular size={14} />}
            className={css.searchInput}
            value={query}
            aria-label="DSL 搜索本任务资产"
            placeholder="DSL 搜索，例如 domain ==a.com && ip=10."
            data-task-assets-search=""
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
          />
          {query.trim() === "" ? null : (
            <Button variant="ghost" size="sm" onClick={() => setQuery("")} data-task-assets-search-clear="">
              清除
            </Button>
          )}
        </div>
        <div className={css.syntax}>
          <span className={css.syntaxLine}>
            <span className={css.op}>=</span> 模糊
            <span className={css.op}>==</span> 精确
            <span className={css.op}>!=</span> 排除
            <span className={css.op}>&amp;&amp;</span> 组合条件
          </span>
          <button
            type="button"
            className={css.linkButton}
            aria-expanded={syntaxOpen}
            onClick={() => setSyntaxOpen((value) => !value)}
          >
            {syntaxOpen ? "收起字段" : "可用字段"}
          </button>
        </div>
        {syntaxOpen ? (
          <Card quiet padded>
            <span className={css.syntaxFull}>{assetDslHint()}</span>
          </Card>
        ) : null}

        {counts.phase === "offline" ? <Notice tone="danger">类型计数读取失败：{counts.error}</Notice> : null}

        {selected.length > 0 && list.phase === "ready" && list.assets.length > 0 ? (
          <div className={css.selectionBar} data-task-assets-selected={selected.length}>
            <span className={css.selectionText}>已选 {selected.length} 项</span>
            <span className={css.selectionActions}>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])} data-task-assets-clear-selection="">
                取消勾选
              </Button>
              <Button variant="primary" size="sm" onClick={() => setAttachOpen(true)} data-task-assets-attach="">
                附加到任务
              </Button>
            </span>
          </div>
        ) : null}

        {list.phase === "loading" ? (
          <Card data={{ "data-task-assets-state": "loading" }}>
            <Skeleton label="加载资产" />
          </Card>
        ) : null}

        {list.phase === "offline" ? (
          <Notice
            tone="danger"
            data={{ "data-task-assets-state": "offline" }}
            action={
              <Button variant="ghost" size="sm" onClick={list.reload} data-task-assets-action="retry">
                重试
              </Button>
            }
          >
            {dsl === "" ? "资产读取失败" : "搜索失败"}：{list.error}
          </Notice>
        ) : null}

        {list.phase === "ready" && list.assets.length === 0 ? (
          <Card>
            <Empty
              inCard
              data={{ "data-task-assets-state": "empty" }}
              icon={dsl === "" ? <IconDatabaseOutlineRegular size={18} /> : <IconSearchOutlineRegular size={18} />}
              title={dsl === "" ? `还没有${assetTypeLabel(type)}资产` : "没有匹配的资产"}
              text={
                dsl === ""
                  ? "可以在下方「登记测试范围」写入，Agent 发现的资产也会自动出现在这里。"
                  : "换个 DSL 条件，或清空搜索。"
              }
              action={
                dsl === "" ? undefined : (
                  <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                    清空搜索
                  </Button>
                )
              }
            />
          </Card>
        ) : null}

        {list.phase === "ready" && list.assets.length > 0 ? (
          <>
            <Card data={{ "data-task-assets-table": "" }}>
              {list.assets.map((asset) => {
                const label = assetLabel(asset);
                const detail = assetDetail(asset);
                return (
                  <Row
                    key={asset.id}
                    data={{ "data-task-asset": String(asset.id) }}
                    lead={
                      <Checkbox
                        className={css.check}
                        checked={selected.includes(asset.id)}
                        label={`勾选 ${label}`}
                        onChange={(next) => toggleRow(asset.id, next)}
                      />
                    }
                    label={
                      <span className={kit.mono} title={label}>
                        {label}
                      </span>
                    }
                    description={detail === "" ? undefined : <span title={detail}>{detail}</span>}
                  >
                    <Badge>{sourceLabel(asset.task_source ?? "legacy")}</Badge>
                    <IconButton
                      label="从任务分离"
                      data-task-assets-detach={asset.id}
                      onClick={() => {
                        setDetachError(null);
                        setDetachTarget(asset);
                      }}
                    >
                      <IconCloseOutlineRegular size={14} />
                    </IconButton>
                  </Row>
                );
              })}
            </Card>

            <div className={css.pager} data-task-assets-pager="">
              <span className={css.pagerInfo} data-task-assets-page-info="">
                <Meta items={[`第 ${page + 1} / ${pageCount} 页`, `共 ${list.total} 条`, `每页 ${TASK_ASSETS_PAGE_SIZE} 条`]} />
              </span>
              <span className={css.pagerActions}>
                <IconButton
                  label="上一页"
                  disabled={page <= 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  data-task-assets-page="prev"
                >
                  <IconChevronLeftOutlineRegular size={14} />
                </IconButton>
                <IconButton
                  label="下一页"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  data-task-assets-page="next"
                >
                  <IconChevronRightOutlineRegular size={14} />
                </IconButton>
              </span>
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="意图资产"
        count={intent.phase === "ready" ? intent.assets.length : undefined}
        hint="只读 · 意图在推进中引用到的资产"
        data={{ "data-task-assets-intent": "" }}
        actions={
          <IconButton
            label="刷新意图资产"
            spinning={intent.phase === "loading"}
            onClick={intent.reload}
            data-task-intent-assets-refresh=""
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      >
        {intent.error !== null && intent.phase !== "offline" ? (
          <Notice tone="danger">意图资产读取失败：{intent.error}</Notice>
        ) : null}
        {intent.phase === "loading" ? (
          <Card data={{ "data-task-intent-assets-state": "loading" }}>
            <Skeleton label="加载意图资产" />
          </Card>
        ) : null}
        {intent.phase === "offline" ? (
          <Notice
            tone="danger"
            data={{ "data-task-intent-assets-state": "offline" }}
            action={
              <Button variant="ghost" size="sm" onClick={intent.reload}>
                重试
              </Button>
            }
          >
            意图资产读取失败{intent.error === null ? "。" : `：${intent.error}`}
          </Notice>
        ) : null}
        {intent.phase === "ready" && intent.assets.length === 0 ? (
          <Card>
            <Empty
              inCard
              data={{ "data-task-intent-assets-state": "empty" }}
              icon={<IconSparkleRegular size={18} />}
              title="暂无意图资产"
              text="意图还没有绑定资产；Agent 推进意图时引用到的资产会列在这里。"
            />
          </Card>
        ) : null}
        {intent.phase === "ready" && intent.assets.length > 0 ? (
          <Card data={{ "data-task-intent-assets-rows": "" }}>
            {intent.assets.map((row) => (
              <Row
                key={`${row.intent_id}-${row.asset_id}`}
                label={
                  <span className={kit.mono} title={row.label}>
                    {row.label === "" ? `#${row.asset_id}` : row.label}
                  </span>
                }
                labelAdornment={<Badge tone={intentTone(row)}>{assetTypeLabel(row.type)}</Badge>}
                description={
                  <Meta
                    items={[
                      sourceLabel(row.source),
                      row.source_summary === "" ? null : row.source_summary,
                      row.inherited ? `继承自任务 #${row.source_task_id}` : null,
                    ]}
                  />
                }
              />
            ))}
          </Card>
        ) : null}
      </Section>

      <Section title="登记测试范围" hint="域名和 IP 会成为资产；CIDR、ICP、关键词作为 Agent 的范围上下文" data={{ "data-task-assets-scope": "" }}>
        <Card>
          <Row
            stacked
            label="测试资产与范围"
            description="每行一条，自动识别域名、IP、CIDR、ICP 备案和关键词。"
          >
            <textarea
              id="task-assets-scope"
              className={css.textArea}
              rows={6}
              value={scopeText}
              aria-label="测试资产与范围"
              placeholder={"example.com\n10.0.0.0/24\n京ICP备12345678号"}
              data-task-assets-scope-text=""
              disabled={scopeBusy}
              onChange={(event) => setScopeText(event.currentTarget.value)}
            />
          </Row>
          <Row
            label={`已识别 ${parsedScope.rules.length} 条`}
            description={
              scopeCounts.length === 0 ? (
                "输入后在这里预览识别结果"
              ) : (
                <span className={css.kindBadges}>
                  {scopeCounts.map((row) => (
                    <Badge key={row.kind}>
                      {SCOPE_KIND_LABELS[row.kind]} {row.count}
                    </Badge>
                  ))}
                </span>
              )
            }
          >
            <Button
              variant="primary"
              size="sm"
              disabled={scopeBusy || parsedScope.rules.length === 0 || parsedScope.errors.length > 0}
              onClick={() => {
                setScopeError(null);
                setScopeConfirm(true);
              }}
              data-task-assets-scope-submit=""
            >
              登记 {parsedScope.rules.length > 0 ? parsedScope.rules.length : ""} 条
            </Button>
          </Row>
        </Card>
        {parsedScope.errors.length > 0 ? (
          <Notice tone="warning">
            <ul className={css.errorList}>
              {parsedScope.errors.slice(0, 5).map((item) => (
                <li key={`${item.line}-${item.error}`}>
                  第 {item.line} 行：{item.error}
                </li>
              ))}
              {parsedScope.errors.length > 5 ? <li>另有 {parsedScope.errors.length - 5} 行错误</li> : null}
            </ul>
          </Notice>
        ) : null}
        {scopeError === null ? null : (
          <Notice tone="danger" data={{ "data-task-assets-scope-error": "" }}>
            登记失败：{scopeError}
          </Notice>
        )}
        {scopeNotice === null ? null : <Notice tone="success">{scopeNotice}</Notice>}
      </Section>

      <Modal
        open={attachOpen}
        onClose={() => {
          if (attachBusy) return;
          setAttachOpen(false);
        }}
        title="附加到任务"
        closeLabel="关闭"
        description={`把已选的 ${selected.length} 项资产附加到当前任务。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={attachBusy} onClick={() => setAttachOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={attachBusy || attachSummary.trim() === ""}
              onClick={submitAttach}
              data-task-assets-attach-confirm=""
            >
              {attachBusy ? "提交中…" : "确认附加"}
            </Button>
          </>
        }
      >
        <div className={css.dialogBody}>
          <ul className={css.dialogList}>
            {list.assets
              .filter((asset) => selected.includes(asset.id))
              .map((asset) => (
                <li key={asset.id}>{assetLabel(asset)}</li>
              ))}
          </ul>
          <div className={css.fieldBlock}>
            <label className={css.fieldLabel} htmlFor="task-assets-attach-summary">
              附加说明（必填，会写进资产的来源说明）
            </label>
            <input
              id="task-assets-attach-summary"
              className={css.textInput}
              value={attachSummary}
              placeholder="为什么要附加这些资产"
              data-task-assets-attach-summary=""
              disabled={attachBusy}
              data-modal-autofocus=""
              onChange={(event) => setAttachSummary(event.currentTarget.value)}
            />
          </div>
          {attachError === null ? null : <Notice tone="danger">附加失败：{attachError}</Notice>}
        </div>
      </Modal>

      <Modal
        open={detachTarget !== null}
        onClose={() => {
          if (detachBusy) return;
          setDetachTarget(null);
        }}
        title="从任务分离？"
        closeLabel="关闭"
        tone="warning"
        description={`把「${detachTarget === null ? "" : assetLabel(detachTarget)}」从当前任务的测试资产中分离。全局资产、关联流量和历史记录会继续保留。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={detachBusy} onClick={() => setDetachTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={detachBusy}
              onClick={submitDetach}
              data-task-assets-detach-confirm=""
            >
              {detachBusy ? "分离中…" : "确认分离"}
            </Button>
          </>
        }
      >
        <div className={css.dialogBody}>
          <span>分离后该资产不再属于本任务的测试资产清单，本任务已产生的发现不受影响。</span>
          {detachError === null ? null : <Notice tone="danger">分离失败：{detachError}</Notice>}
        </div>
      </Modal>

      <Modal
        open={scopeConfirm}
        onClose={() => {
          if (scopeBusy) return;
          setScopeConfirm(false);
        }}
        title="确认登记测试范围"
        closeLabel="关闭"
        tone="warning"
        description={`将向本任务登记 ${parsedScope.rules.length} 条测试范围。域名和 IP 会创建或复用全局资产；CIDR、ICP 和关键词只作为 Agent 的范围上下文。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={scopeBusy} onClick={() => setScopeConfirm(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={scopeBusy}
              onClick={submitScope}
              data-task-assets-scope-confirm=""
            >
              {scopeBusy ? "提交中…" : "确认登记"}
            </Button>
          </>
        }
      >
        <div className={css.dialogBody}>
          <ul className={css.dialogList}>
            {parsedScope.rules.map((rule, index) => (
              <li key={`${rule.kind}-${rule.value}-${index}`}>
                {SCOPE_KIND_LABELS[rule.kind]} · {rule.value}
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </Page>
  );
}
