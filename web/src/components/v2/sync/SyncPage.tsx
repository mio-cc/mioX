"use client";

/**
 * 资产同步整页（对照表 P2:H1–P2:H4）：ScopeSentry 数据源的连接状态与地址 / 密钥配置，
 * 项目维度或任务维度选目标，勾选资产类型后执行同步，执行完显示后端返回的结果摘要。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/function/sync/page.tsx
 * - :55-88 面板：先读状态，数据源未就绪时不显示工作区；
 * - :92-196 数据源卡（状态徽标 / 创建占位 / 地址 + API Key / 保存并启用 / 工具数 / 刷新）；
 * - :218-451 工作区（维度切换、资产类型与「按项目建立企业」、搜索 + 刷新 + 已选数 + 同步按钮、
 *   列表、上一页 / 下一页、选中后清空规则）；
 * - :454-485 结果摘要（synced 各计数 / 新建或更新企业 / warnings / errors）。
 * DSH 依据：DSH 无资产同步页，按「主区整页」扩展（总表 §4.1）；
 * 页头与四态照抄 `components/v2/llm/LlmRecordsPage.tsx:398-558`，
 * 表格照 `components/v2/workspace/WorkspacePage.tsx:284-356`（外层 overflow-x），
 * 二次确认照总表 §5.5 与 `components/v2/data-pages/AssetDeleteDialog.tsx`（Modal + tone="warning"）。
 * 主区整页的 body 不带参数、自己通过 `v2/data/sync.ts` 取数。
 * 对照表行：P2:H1 P2:H2 P2:H3 P2:H4
 *
 * 后端没有预览接口，也没有新增 / 更新 / 跳过三类计数（见 `v2/data/sync.ts` 文件头），
 * 所以本页不画预览数字，结果只显示 api.ts:1255-1260 真实返回的字段。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { toast } from "@/components/v2/settings/Toast";
import type { SSProject, SSTask } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  SS_ASSET_TYPES,
  SS_PAGE_SIZE,
  SS_SEARCH_DEBOUNCE_MS,
  SS_SYNCED_LABEL,
  type SsAssetType,
  type SsDimension,
  type SsStatus,
  type SsSyncResult,
  runSsSync,
  saveSsDatasource,
  ssSyncedTotal,
  ssTargetKey,
  useSsList,
  useSsStatus,
} from "@/v2/data/sync";

import css from "./sync.module.css";

/** 维度切换的选项（旧页 page.tsx:351-354 的两个 tab）。 */
const DIMENSION_OPTIONS: readonly { value: SsDimension; label: string }[] = [
  { value: "project", label: "项目维度" },
  { value: "task", label: "任务维度" },
];

/** 在结果列表里最多显示多少条 warning / error（旧页 page.tsx:478 对 errors 只显示前 20 条）。 */
const MESSAGE_LIMIT = 20;

/**
 * 数据源状态徽标：按后端返回的布尔值逐级显示（旧页 page.tsx:198-214 的同一口径）。
 * @param props.status - 状态快照；null 表示还没拿到。
 * @param props.phase - 读取阶段。
 * @returns 一个 Tag。
 */
function StatusTag({ status, phase }: { status: SsStatus | null; phase: "loading" | "ready" | "offline" }): ReactNode {
  if (phase === "loading") return <Tag tone="quiet">检测中…</Tag>;
  if (phase === "offline" || status === null) return <Tag tone="danger">读取失败</Tag>;
  if (!status.exists) return <Tag tone="danger">未创建</Tag>;
  if (!status.configured) return <Tag tone="warning">未配置</Tag>;
  if (!status.enabled) return <Tag tone="warning">未启用</Tag>;
  if (status.reachable) return <Tag tone="success">已连接</Tag>;
  return <Tag tone="danger">不可达</Tag>;
}

/**
 * 时间文案：任务列表的 creatTime / endTime 原样可能带本地化格式，解析不了就原样显示。
 * @param raw - 后端时间串；空串按未给出处理。
 * @returns 可显示的文本。
 */
function formatTime(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "—";
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return raw;
  return at.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 同步结果块：只显示后端真实返回的 synced 计数、企业名、warnings、errors（旧页 page.tsx:454-485）。
 * @param props.result - 同步结果。
 * @returns 结果摘要。
 */
function SyncResult({ result }: { result: SsSyncResult }): ReactNode {
  const synced = result.synced ?? {};
  const companies = result.companies ?? [];
  const warnings = result.warnings ?? [];
  const errors = result.errors ?? [];
  const total = ssSyncedTotal(result);

  return (
    <section className={css.card} aria-label="同步结果" data-sync-result="">
      <div className={css.cardHead}>
        <h2 className={css.cardTitle}>同步结果</h2>
        <Tag tone={errors.length > 0 ? "warning" : "success"} data-sync-result-status="">
          {errors.length > 0 ? `完成，${errors.length} 条错误` : "完成"}
        </Tag>
        <span className={css.cardSpacer} />
        <span className={`${css.muted} ${css.mutedSmall}`}>
          合计入库 {total} 条
        </span>
      </div>

      <div className={css.resultGrid} data-sync-result-counts="">
        {Object.keys(synced).length === 0 ? (
          <span className={css.muted}>后端没有返回任何入库计数</span>
        ) : (
          Object.entries(synced).map(([key, value]) => (
            <span key={key} className={css.resultItem} data-sync-result-count={key}>
              <span className={css.resultKey}>{SS_SYNCED_LABEL[key] ?? key}</span>
              <span className={css.resultNum}>{value}</span>
            </span>
          ))
        )}
      </div>

      {companies.length === 0 ? null : (
        <p className={css.cardHint} data-sync-result-companies="">
          按项目建立 / 更新的企业：{companies.join("、")}
        </p>
      )}

      {warnings.length === 0 ? null : (
        <ul className={css.msgList} data-sync-result-warnings="">
          {warnings.slice(0, MESSAGE_LIMIT).map((text, index) => (
            <li key={`${index}-${text}`}>{text}</li>
          ))}
          {warnings.length > MESSAGE_LIMIT ? <li>…共 {warnings.length} 条警告</li> : null}
        </ul>
      )}

      {errors.length === 0 ? null : (
        <ul className={`${css.msgList} ${css.msgListError}`} data-sync-result-errors="">
          {errors.slice(0, MESSAGE_LIMIT).map((text, index) => (
            <li key={`${index}-${text}`}>{text}</li>
          ))}
          {errors.length > MESSAGE_LIMIT ? <li>…共 {errors.length} 条错误</li> : null}
        </ul>
      )}
    </section>
  );
}

/**
 * 渲染资产同步页。
 * @returns 页头、连接状态卡、选择与执行卡、同步结果卡，以及同步的二次确认弹窗。
 */
export function SyncPage(): ReactNode {
  const status = useSsStatus();

  /** 数据源地址 / 密钥的输入草稿（旧页 page.tsx:101-102）。 */
  const [urlDraft, setUrlDraft] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [dimension, setDimension] = useState<SsDimension>("project");
  const [page, setPage] = useState(1);
  const [queryDraft, setQueryDraft] = useState("");
  const search = useDebouncedValue(queryDraft.trim(), SS_SEARCH_DEBOUNCE_MS);

  /** 勾选的资产类型（旧页 page.tsx:220-224 默认三种全选）。 */
  const [assetTypes, setAssetTypes] = useState<Record<SsAssetType, boolean>>({
    subdomain: true,
    service: true,
    app: true,
  });
  /** 是否按项目建立企业并写入资产范围（旧页 page.tsx:225 默认勾选）。 */
  const [createCompany, setCreateCompany] = useState(true);

  /** 选中的目标键（项目 id / 任务名）。 */
  const [selected, setSelected] = useState<string[]>([]);

  /** 待确认的同步请求；null 表示确认弹窗关闭。 */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [result, setResult] = useState<SsSyncResult | null>(null);

  const ready = status.phase === "ready" && status.status !== null && status.status.exists && status.status.configured && status.status.enabled;
  const list = useSsList({ dimension, page, search, enabled: ready });
  /** 只在数据源就绪时才展示列表（旧页 :77-85 的同一条件）。 */
  const rows: (SSProject | SSTask)[] = ready ? (dimension === "project" ? list.projects : list.tasks) : [];

  // 地址输入框跟随后端回显（旧页 page.tsx:105-107），密钥永远不回显、留空表示保留原值。
  useEffect(() => {
    setUrlDraft(status.status?.url ?? "");
  }, [status.status?.url]);

  const chosenTypes = useMemo(() => SS_ASSET_TYPES.filter((item) => assetTypes[item.key]).map((item) => item.key), [assetTypes]);

  /** 切换维度或搜索词时回第 1 页并清空选择（旧页 page.tsx:246-249、:346-349）。 */
  const changeDimension = useCallback((next: SsDimension): void => {
    setDimension(next);
    setPage(1);
    setSelected([]);
  }, []);

  const applySearch = useCallback((next: string): void => {
    setPage(next === search ? page : 1);
    setSelected([]);
  }, [page, search]);

  // 防抖值落定后才算一次真正的搜索提交。
  useEffect(() => {
    applySearch(search);
  }, [search, applySearch]);

  const reloadList = useCallback((): void => {
    setSelected([]);
    list.reload();
  }, [list]);

  const toggleRow = useCallback((key: string): void => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }, []);

  const allKeys = useMemo(() => rows.map((row) => ssTargetKey(dimension, row)), [rows, dimension]);
  const allSelected = allKeys.length > 0 && allKeys.every((key) => selected.includes(key));

  const toggleAll = useCallback((): void => {
    setSelected((prev) => (allKeys.length > 0 && allKeys.every((key) => prev.includes(key)) ? [] : [...allKeys]));
  }, [allKeys]);

  /** 保存并启用数据源（旧页 page.tsx:122-135）。 */
  const submitDatasource = useCallback((): void => {
    if (saving) return;
    const url = urlDraft.trim();
    const apiKey = apiKeyDraft.trim();
    if (url === "") {
      setSaveError("请填写 MCP 地址");
      return;
    }
    setSaving(true);
    setSaveError(null);
    saveSsDatasource(url, apiKey)
      .then((value) => {
        setSaving(false);
        setApiKeyDraft("");
        toast(value.enabled ? "已保存并启用数据源" : "已保存（尚未满足启用条件）");
        status.reload();
      })
      .catch((reason: unknown) => {
        setSaving(false);
        setSaveError(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [saving, urlDraft, apiKeyDraft, status]);

  /** 打开二次确认：「开始同步」只做本地动作，真正的写入在 confirmSync 里（总表 §5.5）。 */
  const askSync = useCallback((): void => {
    if (selected.length === 0) {
      setSyncError(`请至少选择一个${dimension === "project" ? "项目" : "任务"}`);
      return;
    }
    if (chosenTypes.length === 0) {
      setSyncError("请至少选择一种资产类型");
      return;
    }
    setSyncError(null);
    setConfirmOpen(true);
  }, [selected, chosenTypes, dimension]);

  const cancelSync = useCallback((): void => {
    if (syncing) return;
    setConfirmOpen(false);
  }, [syncing]);

  /** 确认后真正执行同步（旧页 page.tsx:268-288）。 */
  const confirmSync = useCallback((): void => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    runSsSync({ dimension, targets: selected, assetTypes: chosenTypes, createCompany })
      .then((value) => {
        setSyncing(false);
        setConfirmOpen(false);
        setResult(value);
        toast(`同步完成，共入库 ${ssSyncedTotal(value)} 条资产`);
      })
      .catch((reason: unknown) => {
        setSyncing(false);
        setSyncError(`同步失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [syncing, dimension, selected, chosenTypes, createCompany]);

  const refreshAll = useCallback((): void => {
    status.reload();
    if (ready) reloadList();
  }, [status, ready, reloadList]);

  const pageCount = Math.max(1, page + (rows.length >= SS_PAGE_SIZE ? 1 : 0));
  const targetNoun = dimension === "project" ? "项目" : "任务";
  /** 后端 api.ts:1241 返回的标签计数（`Record<string, number>`），只做展示，不参与请求参数。 */
  const tagEntries = useMemo(() => Object.entries(list.tags), [list.tags]);
  // 选中的目标名：本页能对上的直接取行里的 name，对不上的（别的页选的）用项目名 / 任务名接口
  // 拿不到，就只显示键本身，不猜名字。
  const selectedNames = useMemo(() => {
    const picked = new Set(selected);
    const onPage = new Map(rows.map((row) => [ssTargetKey(dimension, row), row.name]));
    return [...picked].map((key) => `${onPage.get(key) ?? key}（${key}）`);
  }, [rows, selected, dimension]);

  const tools = status.status?.tools ?? [];

  return (
    <div data-data-page="sync" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>资产同步</h1>
          <p className={css.lead}>从 ScopeSentry 数据源把项目或任务的资产拉回本地：先选数据，再确认范围，最后写入资产库。</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="资产同步动作" data-sync-toolbar="">
          <Button
            variant="ghost"
            size="sm"
            disabled={status.phase === "loading"}
            onClick={refreshAll}
            title="重新读取数据源状态与当前列表"
            aria-label="刷新"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-sync-action="refresh"
          />
        </div>
      </header>

      {/* ── H1 连接状态卡 ── */}
      <section className={css.card} aria-label="数据源连接状态" data-sync-card="status">
        <div className={css.cardHead}>
          <h2 className={css.cardTitle}>数据源状态</h2>
          <StatusTag status={status.status} phase={status.phase} />
        </div>

        {status.phase === "loading" ? (
          <div className={css.state} data-sync-status-state="loading">
            读取数据源状态…
          </div>
        ) : null}

        {status.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-sync-status-state="offline">
            <span>读取数据源状态失败：{status.error}</span>
            <Button variant="outline" size="sm" onClick={status.reload} data-sync-action="retry-status">
              重试
            </Button>
          </div>
        ) : null}

        {status.phase === "ready" && status.status !== null ? (
          <>
            <ul className={css.facts} data-sync-status-facts="">
              <li className={css.fact}>
                <span className={css.factKey}>已创建</span>
                <span className={css.factValue}>{status.status.exists ? "是" : "否"}</span>
              </li>
              <li className={css.fact}>
                <span className={css.factKey}>已配置</span>
                <span className={css.factValue}>{status.status.configured ? "是" : "否"}</span>
              </li>
              <li className={css.fact}>
                <span className={css.factKey}>已启用</span>
                <span className={css.factValue}>{status.status.enabled ? "是" : "否"}</span>
              </li>
              <li className={css.fact}>
                <span className={css.factKey}>可达</span>
                <span className={css.factValue}>{status.status.reachable ? "是" : "否"}</span>
              </li>
              {status.status.url === undefined || status.status.url === "" ? null : (
                <li className={css.fact}>
                  <span className={css.factKey}>地址</span>
                  <span className={`${css.factValue} ${css.mono}`} data-sync-status-url="">
                    {status.status.url}
                  </span>
                </li>
              )}
              <li className={css.fact}>
                <span className={css.factKey}>已发现工具</span>
                <span className={css.factValue} data-sync-status-tools={String(tools.length)}>
                  {tools.length} 个
                </span>
              </li>
            </ul>

            {status.status.configured && !status.status.enabled ? (
              <p className={css.hintWarn} data-sync-status-warn="disabled">
                <IconWarningOutlineRegular size={13} aria-hidden="true" />
                <span>数据源已配置但未启用，保存地址与密钥后会自动启用。</span>
              </p>
            ) : null}
            {status.status.exists && !status.status.configured ? (
              <p className={css.hintWarn} data-sync-status-warn="unconfigured">
                <IconWarningOutlineRegular size={13} aria-hidden="true" />
                <span>数据源已创建但未配置：地址与 API Key 都填好并保存后才会启用。</span>
              </p>
            ) : null}
            {status.status.enabled && !status.status.reachable ? (
              <p className={css.hintWarn} data-sync-status-warn="unreachable">
                <IconWarningOutlineRegular size={13} aria-hidden="true" />
                <span>数据源已启用但探测不可达：项目 / 任务列表与同步都会失败，先检查地址与密钥。</span>
              </p>
            ) : null}

            {!status.status.exists ? (
              <p className={css.cardHint} data-sync-status-hint="missing">
                尚未创建 ScopeSentry 数据源。在下方填写 MCP 地址与 API Key 后点「保存并启用」，后端会创建并启用它。
              </p>
            ) : null}

            {status.status.exists ? (
              <div className={css.formRow}>
                <label className={css.field}>
                  <span className={css.fieldLabel}>MCP 地址</span>
                  <Input
                    value={urlDraft}
                    aria-label="MCP 地址"
                    disabled={saving}
                    onChange={(event) => setUrlDraft(event.currentTarget.value)}
                    data-sync-datasource-url=""
                  />
                </label>
                <label className={css.field}>
                  <span className={css.fieldLabel}>API Key（X-API-Key，留空保留原值）</span>
                  <Input
                    type="password"
                    value={apiKeyDraft}
                    aria-label="API Key"
                    placeholder="留空保留原值"
                    disabled={saving}
                    onChange={(event) => setApiKeyDraft(event.currentTarget.value)}
                    data-sync-datasource-key=""
                  />
                </label>
              </div>
            ) : null}

            {status.status.exists ? (
              <div className={css.optionRow}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving || urlDraft.trim() === ""}
                  onClick={submitDatasource}
                  data-sync-action="save-datasource"
                >
                  {saving ? "保存中…" : "保存并启用"}
                </Button>
                <span className={css.cardHint}>
                  {tools.length === 0 ? "保存成功后后端会立即探测工具列表。" : `后端已缓存 ${tools.length} 个工具。`}
                </span>
              </div>
            ) : null}

            {saveError === null ? null : (
              <p className={css.errorLine} role="alert" data-sync-status-error="">
                {saveError}
              </p>
            )}
          </>
        ) : null}
      </section>

      {/* ── H2 / H3 选择目标 ── */}
      {status.phase === "ready" && !ready ? (
        <div className={css.empty} data-sync-state="blocked">
          <span className={css.emptyTitle}>数据源就绪后才能选择项目 / 任务</span>
          <span className={css.emptyText}>
            需要同时满足「已创建」「已配置」「已启用」三项；按上方提示补齐地址与 API Key 后保存即可。
          </span>
        </div>
      ) : null}

      {ready ? (
        <section className={css.card} aria-label="选择同步目标" data-sync-card="select">
          <div className={css.cardHead}>
            <SegmentedControl
              id="sync-dimension"
              value={dimension}
              options={DIMENSION_OPTIONS}
              label="同步维度"
              disabled={syncing}
              onChange={changeDimension}
            />
            <span className={css.cardSpacer} />
            <span className={`${css.muted} ${css.mutedSmall}`}>
              已选 {selected.length}
            </span>
          </div>

          <div className={css.optionRow} data-sync-options="">
            <span className={css.optionLabel}>同步资产</span>
            {SS_ASSET_TYPES.map((item) => (
              <Checkbox
                key={item.key}
                checked={assetTypes[item.key]}
                label={item.label}
                disabled={syncing}
                onChange={(next) => setAssetTypes((prev) => ({ ...prev, [item.key]: next }))}
              />
            ))}
            {dimension === "project" ? (
              <Checkbox
                checked={createCompany}
                label="按项目建立企业并写入资产范围"
                disabled={syncing}
                onChange={setCreateCompany}
              />
            ) : null}
          </div>

          <div className={css.toolbar} role="toolbar" aria-label="资产同步筛选">
            <Input
              className={css.searchField}
              icon={<IconSearchOutlineRegular size={13} />}
              value={queryDraft}
              aria-label={dimension === "project" ? "搜索项目名" : "搜索任务名"}
              placeholder={dimension === "project" ? "搜索项目名" : "搜索任务名"}
              onChange={(event) => setQueryDraft(event.currentTarget.value)}
              data-sync-search=""
            />
            <Button
              variant="outline"
              size="sm"
              disabled={list.phase === "loading"}
              onClick={reloadList}
              title="重新读取当前维度的列表"
              data-sync-action="reload-list"
            >
              刷新列表
            </Button>
            <span className={css.toolbarSpacer} />
            <Button
              variant="primary"
              size="sm"
              disabled={syncing || selected.length === 0 || chosenTypes.length === 0}
              title={
                selected.length === 0
                  ? "先勾选至少一个目标"
                  : chosenTypes.length === 0
                    ? "至少选择一种资产类型"
                    : "打开确认框后才会真正写入"
              }
              onClick={askSync}
              icon={<IconDownloadOutlineRegular size={13} />}
              data-sync-action="start"
            >
              开始同步
            </Button>
          </div>

          <div className={css.summary} data-sync-summary="">
            <span className={css.summaryStrong}>
              {dimension === "project" ? "项目" : "任务"} · 第 {page} 页
            </span>
            <span>本页 {rows.length} 条</span>
            <span>资产类型 {chosenTypes.length} 种</span>
            {dimension === "task" ? <span>任务维度不建立企业</span> : null}
          </div>

          {syncError === null ? null : (
            <p className={css.errorLine} role="alert" data-sync-error="">
              {syncError}
            </p>
          )}

          {list.phase === "loading" ? (
            <div className={css.state} data-sync-list-state="loading">
              加载中…
            </div>
          ) : null}

          {list.phase === "offline" ? (
            <div className={css.stateError} role="alert" data-sync-list-state="offline">
              <span>读取列表失败：{list.error}</span>
              <Button variant="outline" size="sm" onClick={list.reload} data-sync-action="retry-list">
                重试
              </Button>
            </div>
          ) : null}

          {list.phase === "ready" && rows.length === 0 ? (
            <div className={css.empty} data-sync-list-state="empty">
              <span className={css.emptyTitle}>
                {search === "" ? `暂无${dimension === "project" ? "项目" : "任务"}` : "没有匹配的结果"}
              </span>
              <span className={css.emptyText}>
                {search === ""
                  ? "ScopeSentry 里这个维度上没有数据，或者数据源返回了空列表。"
                  : `搜索「${search}」在当前页没有命中，换关键词或清空搜索后再看。`}
              </span>
            </div>
          ) : null}

          {list.phase === "ready" && rows.length > 0 ? (
            <div className={css.tableWrap}>
              <table className={css.table} data-sync-rows="">
                <thead>
                  <tr>
                    <th scope="col" className={css.colCheck}>
                      <Checkbox
                        checked={allSelected}
                        onChange={toggleAll}
                        label={allSelected ? "取消全选本页" : "全选本页"}
                        disabled={syncing}
                      />
                    </th>
                    <th scope="col">{dimension === "project" ? "项目名" : "任务名"}</th>
                    {dimension === "project" ? (
                      <>
                        <th scope="col">标签</th>
                        <th scope="col" className={css.colNum}>
                          资产数
                        </th>
                      </>
                    ) : (
                      <>
                        <th scope="col">进度</th>
                        <th scope="col">时间</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dimension === "project"
                    ? list.projects.map((row) => {
                        const key = ssTargetKey(dimension, row);
                        const active = selected.includes(key);
                        return (
                          <tr
                            key={row.id}
                            className={active ? `${css.row} ${css.rowActive}` : css.row}
                            aria-selected={active}
                            onClick={() => toggleRow(key)}
                            data-sync-row={key}
                          >
                            <td className={css.colCheck} onClick={(event) => event.stopPropagation()}>
                              <Checkbox
                                checked={active}
                                label={`选择 ${row.name}`}
                                disabled={syncing}
                                onChange={() => toggleRow(key)}
                              />
                            </td>
                            <td className={css.cellName} title={row.name}>
                              {row.name}
                            </td>
                            <td>{row.tag === undefined || row.tag === "" ? <span className={css.muted}>—</span> : <Tag tone="neutral">{row.tag}</Tag>}</td>
                            <td className={css.colNum}>{row.AssetCount ?? 0}</td>
                          </tr>
                        );
                      })
                    : list.tasks.map((row) => {
                        const key = ssTargetKey(dimension, row);
                        const active = selected.includes(key);
                        return (
                          <tr
                            key={`${row.id}-${row.name}`}
                            className={active ? `${css.row} ${css.rowActive}` : css.row}
                            aria-selected={active}
                            onClick={() => toggleRow(key)}
                            data-sync-row={key}
                          >
                            <td className={css.colCheck} onClick={(event) => event.stopPropagation()}>
                              <Checkbox
                                checked={active}
                                label={`选择 ${row.name}`}
                                disabled={syncing}
                                onChange={() => toggleRow(key)}
                              />
                            </td>
                            <td className={css.cellName} title={row.name}>
                              {row.name}
                            </td>
                            <td>
                              {row.progress === undefined ? (
                                <span className={css.muted}>—</span>
                              ) : (
                                <Tag tone={row.progress === 100 ? "success" : "outline"}>{`${row.progress}%`}</Tag>
                              )}
                            </td>
                            <td className={css.muted}>{formatTime(row.endTime || row.creatTime)}</td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          ) : null}

          {list.phase === "ready" ? (
            <div className={css.pager} data-sync-pager="">
              <span>
                第 {page} 页{pageCount > page ? ` / 至少 ${pageCount} 页` : ""}
              </span>
              <span>本页 {rows.length} 条（后端不返回总数）</span>
              <span className={css.pagerRight}>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="上一页"
                  title={page <= 1 ? "已经是第一页" : "上一页"}
                  disabled={page <= 1 || list.phase !== "ready"}
                  onClick={() => {
                    setSelected([]);
                    setPage(Math.max(1, page - 1));
                  }}
                  icon={<IconChevronLeftOutlineRegular size={13} />}
                  data-sync-action="prev-page"
                />
                <span>{page}</span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="下一页"
                  title={rows.length < SS_PAGE_SIZE ? "本页不足一页，下一页通常是空的" : "下一页"}
                  disabled={rows.length < SS_PAGE_SIZE || list.phase !== "ready"}
                  onClick={() => {
                    setSelected([]);
                    setPage(page + 1);
                  }}
                  icon={<IconChevronRightOutlineRegular size={13} />}
                  data-sync-action="next-page"
                />
              </span>
            </div>
          ) : null}

          {tagEntries.length === 0 ? null : (
            <p className={css.cardHint} data-sync-tags="">
              数据源报告的标签计数：
              {tagEntries.map(([name, count]) => `${name} ${count}`).join(" · ")}
            </p>
          )}
        </section>
      ) : null}

      {/* ── H4 同步结果 ── */}
      {result === null ? null : <SyncResult result={result} />}

      <Modal
        open={confirmOpen}
        onClose={cancelSync}
        title="确认开始同步"
        closeLabel="关闭"
        tone="warning"
        description={
          `将把 ${selected.length} 个${dimension === "project" ? "项目" : "任务"}的` +
          `${chosenTypes.map((key) => SS_ASSET_TYPES.find((item) => item.key === key)?.label ?? key).join(" / ")}` +
          `资产写入本地资产库（会新增或更新同名资产）。`
        }
        footer={
          <>
            <Button variant="outline" size="sm" onClick={cancelSync} disabled={syncing} data-sync-confirm-cancel="">
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={confirmSync} disabled={syncing} data-sync-confirm-ok="">
              {syncing ? "同步中…" : "确认同步"}
            </Button>
          </>
        }
      >
        <div className={css.confirmBody}>
          <p className={css.confirmWarn}>
            <IconWarningOutlineRegular size={14} aria-hidden="true" />
            <span>同步会写入真实资产库：子域名 / 服务 / App / IP 中同名的条目会被更新，不存在的会被新增，后端没有回滚接口。</span>
          </p>
          <p style={{ margin: 0 }}>影响范围（{selected.length} 个{targetNoun}）：</p>
          <ul className={css.confirmList} data-sync-confirm-targets="">
            {selectedNames.slice(0, MESSAGE_LIMIT).map((name, index) => (
              <li key={`${index}-${name}`}>{name}</li>
            ))}
            {selectedNames.length > MESSAGE_LIMIT ? <li>…共 {selectedNames.length} 个</li> : null}
          </ul>
          {dimension === "project" && createCompany ? (
            <p style={{ margin: 0 }}>
              同时会按项目建立 / 更新企业，并把项目根域名写入企业资产范围。
            </p>
          ) : null}
          {syncError === null ? null : (
            <p className={css.errorLine} role="alert" data-sync-confirm-error="">
              {syncError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
