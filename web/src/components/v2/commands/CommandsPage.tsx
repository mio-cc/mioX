"use client";

/**
 * 命令记录页（对照表 P2:G1–P2:G3）：工具执行历史的分页列表、worker / tool / 只看错误三类筛选、
 * 点行看完整命令与输出，以及各工具调用统计（总数 / 错误数）。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/function/commands/page.tsx
 * - :84-103 列表（page/size/q/task 参数，翻页）；:106-118 统计（沿用 task/q，整结果集）；
 * - :127-199 页头与工具条（搜索框、任务 ID 输入、每页条数、统计按钮、范围与翻页）；
 * - :201-273 历史表（时间 / 任务 / Worker / 工具 / 输入 / 状态，行可点）；
 * - :275-333 统计弹窗（工具 / 调用次数 / 失败次数 / 占比条）；:335-389 详情（完整输入与输出）。
 * DSH 依据：DSH 无命令记录页，按「主区整页」扩展（总表 §4.1）；外壳、工具条与四态照抄
 * `components/v2/findings/FindingsDataPage.tsx:230-477`，弹窗照抄
 * `components/v2/companies/CompaniesPage.tsx:441-486` 的 `Modal` 写法。
 * 主区整页的 body 不带参数、自己通过 `v2/data/commands.ts` 取数（总表 §4.1 第 1 步）。
 *
 * 与卡片的对应：列表列 = worker / tool / 命令摘要 / 是否报错 / 时间（卡片第 1 条）；每页固定 50
 * （第 1 条）；筛选 = worker / tool / 只看错误，其中 worker 与 tool 的选项来自真实的统计快照，
 * 「只看错误」`is_error` 与 worker / tool 都是本地筛选（后端只认 task/q，api.ts:1407-1421），
 * 界面上的说明文字已写明这一点；详情读的是列表行自带的记录（P2:G3 依据表写的就是「列表行自带
 * 记录」，api.ts 里没有更细的详情接口）；统计表 = 各工具总数 / 错误数 + 合计（第 4 条）。
 * 列表、统计两个区块各自都有加载 / 失败 / 空 / 有数据四态（第 5 条）。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import type { CommandRecord } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconCopyOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  COMMANDS_PAGE_SIZE,
  COMMANDS_SEARCH_DEBOUNCE_MS,
  commandSummary,
  formatCommandTime,
  toolInputText,
  toolNames,
  useCommandRecords,
  useCommandStats,
} from "@/v2/data/commands";

import css from "./commands.module.css";

/** 统计表 / 工具下拉的「结果」口径：与列表同一个本地开关。 */
type ErrorOnly = "all" | "error" | "ok";

/**
 * 渲染命令记录页。
 * @returns 页头、筛选条、执行记录表、分页条，以及详情与统计两个弹窗。
 */
export function CommandsPage(): ReactNode {
  /** 已提交给后端的搜索词（防抖后）。 */
  const [query, setQuery] = useState("");
  /** 搜索框里的原始输入。 */
  const [queryDraft, setQueryDraft] = useState("");
  const debounced = useDebouncedValue(queryDraft.trim(), COMMANDS_SEARCH_DEBOUNCE_MS);

  const [worker, setWorker] = useState("all");
  const [tool, setTool] = useState("all");
  const [errorOnly, setErrorOnly] = useState<ErrorOnly>("all");
  /** 0 起的页游标，与 api.ts:1407 的 page 参数一致。 */
  const [page, setPage] = useState(0);

  /** 统计快照同时供工具下拉的选项与统计弹窗使用（都是同一批真实数据）。 */
  const stats = useCommandStats({ task: "", query });
  const state = useCommandRecords({ page, task: "", query });

  /** 正在看详情的记录；null 表示详情弹窗关闭。 */
  const [detail, setDetail] = useState<CommandRecord | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  /**
   * 修改筛选条件：后端参数变化时回到第一页（与旧页 :79-81 一致）。
   * @param next - 新的搜索词。
   */
  const applyQuery = useCallback((next: string): void => {
    setQuery(next);
    setPage(0);
  }, []);

  // 防抖值落定后才提交给请求，避免每个键击都打一次后端；搜索词变化时回到第一页。
  useEffect(() => {
    if (debounced === query) return;
    applyQuery(debounced);
  }, [debounced, query, applyQuery]);

  const changeWorker = useCallback((next: string): void => {
    setWorker(next);
    setPage(0);
  }, []);

  const changeTool = useCallback((next: string): void => {
    setTool(next);
    setPage(0);
  }, []);

  const changeErrorOnly = useCallback((next: ErrorOnly): void => {
    setErrorOnly(next);
    setPage(0);
  }, []);

  const reloadAll = useCallback((): void => {
    state.reload();
    stats.reload();
  }, [state, stats]);

  /** 本地筛选：worker / tool / 是否报错都作用在已取到的这一页行上。 */
  const rows = useMemo(
    () =>
      state.items.filter((row) => {
        if (worker !== "all" && row.worker !== worker) return false;
        if (tool !== "all" && row.tool !== tool) return false;
        if (errorOnly === "error" && !row.is_error) return false;
        if (errorOnly === "ok" && row.is_error) return false;
        return true;
      }),
    [state.items, worker, tool, errorOnly],
  );

  const workerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of state.items) names.add(row.worker);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [state.items]);

  const toolOptions = useMemo(() => toolNames(stats.stats), [stats.stats]);

  const statsRows = useMemo(() => {
    const all = stats.stats ?? [];
    return errorOnly === "error" ? all.filter((row) => row.errors > 0) : all;
  }, [stats.stats, errorOnly]);

  const statsTotals = useMemo(() => {
    const rowsNow = stats.stats ?? [];
    return {
      total: rowsNow.reduce((sum, row) => sum + row.total, 0),
      errors: rowsNow.reduce((sum, row) => sum + row.errors, 0),
    };
  }, [stats.stats]);

  const pageCount = Math.max(1, Math.ceil(state.total / COMMANDS_PAGE_SIZE));
  const rangeStart = state.total === 0 ? 0 : page * COMMANDS_PAGE_SIZE + 1;
  const rangeEnd = page * COMMANDS_PAGE_SIZE + state.items.length;
  const filtered = worker !== "all" || tool !== "all" || errorOnly !== "all";

  const openDetail = useCallback((row: CommandRecord): void => {
    setDetail(row);
  }, []);

  const closeDetail = useCallback((): void => {
    setDetail(null);
  }, []);

  const openStats = useCallback((): void => {
    setStatsOpen(true);
  }, []);

  const closeStats = useCallback((): void => {
    setStatsOpen(false);
  }, []);

  /** 复制记录 id（本地动作，不调后端）。 */
  const copyId = useCallback((id: number): void => {
    navigator.clipboard
      .writeText(String(id))
      .then(() => toast("已复制记录编号"))
      .catch(() => toast("复制失败"));
  }, []);

  return (
    <div data-data-page="commands" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>命令记录</h1>
          <p className={css.lead}>跨任务的工具执行历史：worker、工具、命令与是否报错，点行看完整输入与输出。</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="命令记录动作">
          <Button
            variant="outline"
            size="sm"
            disabled={state.phase === "loading" && stats.phase === "loading"}
            onClick={reloadAll}
            title="重新读取列表与统计"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-commands-action="refresh"
          >
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openStats}
            data-commands-action="stats"
            data-commands-count={stats.phase === "ready" ? String(statsTotals.total) : ""}
          >
            统计
          </Button>
        </div>
      </header>

      <div className={css.toolbar} role="toolbar" aria-label="命令记录筛选">
        <label className={css.search}>
          <IconSearchOutlineRegular size={13} className={css.searchIcon} />
          <input
            type="search"
            className={css.searchInput}
            value={queryDraft}
            placeholder="搜索工具或参数"
            aria-label="搜索命令记录"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQueryDraft(event.currentTarget.value)}
            data-commands-filter="query"
          />
        </label>
        <span className={css.filter}>
          <span>Worker</span>
          <SelectMenu
            value={worker}
            ariaLabel="按 worker 筛选"
            options={[
              { value: "all", label: "全部" },
              ...workerOptions.map((name) => ({ value: name, label: name === "" ? "（空）" : name })),
            ]}
            onChange={(next) => changeWorker(next)}
          />
        </span>
        <span className={css.filter}>
          <span>工具</span>
          <SelectMenu
            value={tool}
            ariaLabel="按工具筛选"
            options={[
              { value: "all", label: "全部" },
              ...toolOptions.map((name) => ({ value: name, label: name === "" ? "（空）" : name })),
            ]}
            onChange={(next) => changeTool(next)}
          />
        </span>
        <span className={css.filter}>
          <span>结果</span>
          <SelectMenu
            value={errorOnly}
            ariaLabel="按是否报错筛选"
            options={[
              { value: "all", label: "全部" },
              { value: "error", label: "只看失败" },
              { value: "ok", label: "只看成功" },
            ]}
            onChange={(next) => changeErrorOnly(next as ErrorOnly)}
          />
        </span>
        <span className={css.count} data-commands-count-label={state.phase === "ready" ? String(state.total) : ""}>
          {state.phase === "ready" ? `${state.total} 条` : state.phase === "loading" ? "读取中…" : "读取失败"}
        </span>
      </div>

      {state.phase === "loading" ? (
        <div className={css.state} data-commands-state="loading">
          加载中…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-commands-state="offline">
          <span>读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-commands-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && rows.length === 0 ? (
        <div className={css.empty} data-commands-state="empty">
          <span className={css.emptyTitle}>{filtered ? "没有匹配的记录" : "还没有工具执行记录"}</span>
          <span className={css.emptyText}>
            {filtered
              ? "worker / 工具 / 结果是在当前这一页里做本地筛选（后端只支持任务与关键词筛选），换一页或清空筛选再看。"
              : "Agent 执行 Bash 这类工具后，记录会出现在这里。"}
          </span>
        </div>
      ) : null}

      {state.phase === "ready" && rows.length > 0 ? (
        <div className={css.tableWrap}>
          <table className={css.table} data-commands-rows="">
            <thead>
              <tr>
                <th scope="col" className={css.colTime}>
                  时间
                </th>
                <th scope="col" className={css.colWorker}>
                  Worker
                </th>
                <th scope="col" className={css.colTool}>
                  工具
                </th>
                <th scope="col">命令</th>
                <th scope="col" className={css.colState}>
                  结果
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const text = toolInputText(row.command);
                const summary = commandSummary(text);
                return (
                  <tr
                    key={row.id}
                    className={css.row}
                    tabIndex={0}
                    aria-label={`打开命令详情：${row.tool || "未知工具"}`}
                    data-data-page-row=""
                    data-commands-row={row.id}
                    data-commands-error={row.is_error ? "1" : "0"}
                    onClick={() => openDetail(row)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openDetail(row);
                    }}
                  >
                    <td className={css.colTime}>{formatCommandTime(row.created_at)}</td>
                    <td className={css.colWorker}>
                      <span className={css.mono}>{row.worker === "" ? "—" : row.worker}</span>
                    </td>
                    <td className={css.colTool}>
                      <Tag tone="neutral">{row.tool === "" ? "—" : row.tool}</Tag>
                    </td>
                    <td className={css.cellMain}>
                      {summary === "" ? (
                        <span className={`${css.summary} ${css.summaryEmpty}`}>（空输入）</span>
                      ) : (
                        <span className={css.summary} title={summary}>
                          {summary}
                        </span>
                      )}
                    </td>
                    <td className={css.colState}>
                      <Tag tone={row.is_error ? "danger" : "success"}>{row.is_error ? "失败" : "成功"}</Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <footer className={css.pager} data-commands-pager="">
          <span data-commands-page-info="">
            第 {page + 1} / {pageCount} 页 · {rangeStart}–{rangeEnd} / 共 {state.total} 条
            {filtered ? ` · 本页筛出 ${rows.length} 条` : ""}
          </span>
          <span className={css.pagerActions}>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage(Math.max(0, page - 1))}
              data-commands-page="prev"
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
              data-commands-page="next"
            >
              下一页
            </Button>
          </span>
        </footer>
      ) : null}

      <Modal
        open={detail !== null}
        onClose={closeDetail}
        title="命令详情"
        closeLabel="关闭"
        description={detail === null ? undefined : formatCommandTime(detail.created_at)}
        className={css.detailModal}
        footer={
          <Button variant="outline" size="sm" onClick={closeDetail} data-commands-detail-close="">
            关闭
          </Button>
        }
      >
        {detail === null ? null : (
          <div className={css.detail} data-commands-detail={detail.id}>
            <div className={css.metaRow}>
              <Tag tone="outline" className={css.mono}>{`#${detail.exploration_id}`}</Tag>
              <Tag tone="outline" className={css.mono}>{detail.worker === "" ? "—" : detail.worker}</Tag>
              <Tag tone="neutral" className={css.mono}>{detail.tool === "" ? "—" : detail.tool}</Tag>
              <Tag tone={detail.is_error ? "danger" : "success"}>{detail.is_error ? "失败" : "成功"}</Tag>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyId(detail.id)}
                icon={<IconCopyOutlineRegular size={13} />}
                title="复制记录编号"
                aria-label="复制记录编号"
                data-commands-action="copy-id"
              >
                复制编号
              </Button>
            </div>

            <section className={css.panel}>
              <div className={css.panelHead}>
                <span className={css.panelTitle}>命令 / 输入</span>
              </div>
              <div className={css.panelBody}>
                {detail.command === "" ? (
                  <p className={css.muted}>（空输入）</p>
                ) : (
                  <pre className={css.code} data-commands-detail-input="">
                    {toolInputText(detail.command)}
                  </pre>
                )}
              </div>
            </section>

            <section className={css.panel}>
              <div className={css.panelHead}>
                <span className={css.panelTitle}>输出</span>
              </div>
              <div className={css.panelBody}>
                {detail.output === "" ? (
                  <p className={css.muted}>（无输出）</p>
                ) : (
                  <pre
                    className={detail.is_error ? `${css.code} ${css.codeError}` : css.code}
                    data-commands-detail-output=""
                  >
                    {detail.output}
                  </pre>
                )}
              </div>
            </section>
          </div>
        )}
      </Modal>

      <Modal
        open={statsOpen}
        onClose={closeStats}
        title="工具调用统计"
        closeLabel="关闭"
        description={query === "" ? "全部工具执行记录（跨页合计）" : `当前搜索「${query}」下的全部记录（跨页合计）`}
        className={css.modalWide}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={stats.reload} disabled={stats.phase === "loading"}>
              重新读取
            </Button>
            <Button variant="primary" size="sm" onClick={closeStats} data-commands-stats-close="">
              关闭
            </Button>
          </>
        }
      >
        {stats.phase === "loading" ? (
          <div className={css.state} data-commands-stats-state="loading">
            加载中…
          </div>
        ) : null}

        {stats.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-commands-stats-state="offline">
            <span>读取失败：{stats.error}</span>
            <Button variant="outline" size="sm" onClick={stats.reload} data-commands-action="stats-retry">
              重试
            </Button>
          </div>
        ) : null}

        {stats.phase === "ready" && statsRows.length === 0 ? (
          <div className={css.empty} data-commands-stats-state="empty">
            <span className={css.emptyTitle}>{errorOnly === "error" ? "没有失败的工具调用" : "暂无统计数据"}</span>
            <span className={css.emptyText}>
              {errorOnly === "error" ? "当前结果集里每个工具的错误数都是 0。" : "Agent 调用工具后，这里会按工具汇总调用次数。"}
            </span>
          </div>
        ) : null}

        {stats.phase === "ready" && statsRows.length > 0 ? (
          <div data-commands-stats="ready">
            <div className={css.statsToolbar}>
              <span className={css.statsCount} data-commands-stats-total="">
                {statsRows.length} 个工具 · 共 {statsTotals.total} 次调用 · 失败 {statsTotals.errors} 次
              </span>
              <span className={css.filter}>
                <SelectMenu
                  value={errorOnly}
                  ariaLabel="统计表按是否报错筛选"
                  options={[
                    { value: "all", label: "全部工具" },
                    { value: "error", label: "只看有失败" },
                  ]}
                  onChange={(next) => changeErrorOnly(next as ErrorOnly)}
                />
              </span>
            </div>
            <div className={css.statsScroll}>
              <table className={css.statsTable} data-commands-stats-rows="">
                <thead>
                  <tr>
                    <th scope="col">工具</th>
                    <th scope="col" className={css.statsNum}>
                      调用
                    </th>
                    <th scope="col" className={css.statsNum}>
                      失败
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statsRows.map((row) => (
                    <tr key={row.tool} data-commands-stat={row.tool}>
                      <td>
                        <span className={css.mono}>{row.tool === "" ? "（空）" : row.tool}</span>
                      </td>
                      <td className={css.statsNum}>{row.total}</td>
                      <td className={row.errors > 0 ? `${css.statsNum} ${css.statsErrorNum}` : css.statsNum}>
                        {row.errors}
                      </td>
                    </tr>
                  ))}
                  <tr className={css.statsTotalRow} data-commands-stats-total-row="">
                    <td>合计</td>
                    <td className={css.statsNum}>{statsTotals.total}</td>
                    <td className={css.statsNum}>{statsTotals.errors}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
