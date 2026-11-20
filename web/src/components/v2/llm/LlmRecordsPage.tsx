"use client";

/**
 * LLM 录制整页（对照表 P2:I1–P2:I5）：录制开关、记录列表（时间 / 任务 / Worker / Profile /
 * 模型 / 延迟 / token / 状态 + 分页）、筛选（任务 / 模型 / Session ID / 只看失败）、
 * 点行查看请求与响应正文（归一化视图 + HTTP 原文切换 + 复制，超长可滚动）、
 * 按任务删除全部记录（二次确认）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/llm-records/page.tsx:328-346（录制开关）、
 * :268-374（工具条：Session 搜索 / Model / 任务下拉 / 每页条数 / 范围与翻页）、
 * :376-456（表格列与空态）、:458-552（内联详情：头部信息 + Request / Response 两栏 + 原文开关 +
 * 复制）、:555-577（删除任务对话的确认框）、:51-77（时间 / 延迟 / token 文案与 JSON 排版）、
 * :80-118（复制按钮）。
 * DSH 依据：DSH 无 LLM 录制页，按「主区整页」扩展（总表 §4.1）；
 * 外壳照 `components/v2/logs/LogsPage.tsx:100-206`（页头 + 工具条 + 四态），
 * 表格照 `components/v2/workspace/WorkspacePage.tsx:284-356`，
 * 二次确认照总表 §5.5 与 `components/v2/data-pages/AssetDeleteDialog.tsx`。
 * 主区整页的 body 不带参数、自己通过 `v2/data/llm-records.ts` 取数。
 * 对照表行：P2:I1 P2:I2 P2:I3 P2:I4 P2:I5
 *
 * 后端没有：LLM 记录统计接口、模型候选列表接口、status 过滤参数（见适配器文件头），
 * 所以不画汇总数字、模型下拉只列当前页真实出现过的模型、「只看失败」在前端过滤并如实说明。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import type { LLMRecordDetail, LLMRecordItem } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCopyOutlineRegular,
  IconListPenOutlineRegular,
  IconRefreshOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  deleteLlmRecordsOfTask,
  LLM_MODEL_ALL,
  LLM_RECORDS_PAGE_SIZE,
  LLM_RECORDS_PAGE_SIZES,
  llmRecordBodies,
  llmRecordFailed,
  llmRecordHasRaw,
  llmRecordModels,
  prettyJsonText,
  useLlmRecordDetail,
  useLlmRecords,
  useLlmRecordTasks,
  useLlmRecordToggle,
  type LlmRecordsQuery,
} from "@/v2/data/llm-records";

import css from "./llm-records.module.css";

/** 「全部任务」在下拉里的取值；后端不吃这个值，适配器把它翻成「不传 task」。 */
const TASK_ALL = "";

/**
 * 列表时间文案，照旧页 llm-records/page.tsx:51-59 的 `MM-DD HH:mm:ss`。
 * @param ts - 后端时间戳。
 * @returns 本地化的短时间，解析失败时原样返回。
 */
function formatTime(ts: string): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return ts;
  return at.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 延迟文案，照旧页 llm-records/page.tsx:61-64。
 * @param ms - 毫秒。
 * @returns `<1000` 时 `123ms`，否则 `1.2s`。
 */
function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * token 文案，照旧页 llm-records/page.tsx:66-69。
 * @param n - token 数。
 * @returns 1000 以上用一位小数的 `1.2k`。
 */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * 把正文写进剪贴板：先走 `navigator.clipboard`，非安全上下文（http 局域网）回退到
 * 隐藏 textarea + execCommand，照旧页 llm-records/page.tsx:85-100。
 * @param text - 要复制的正文。
 * @returns 是否成功。
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
}

/** 状态标签：后端只有 ok / error（llmrec.go:296-303）。 */
function StatusTag({ record }: { record: LLMRecordItem }): ReactNode {
  return llmRecordFailed(record) ? <Tag tone="danger">Error</Tag> : <Tag tone="success">OK</Tag>;
}

/**
 * 正文栏：标题 + 复制按钮 + 可滚动的等宽正文（旧页 llm-records/page.tsx:511-549）。
 * @param props.title - 栏标题。
 * @param props.text - 正文原样（调用方已排版）。
 * @param props.failed - 是否为失败记录的响应（用危险色显示）。
 * @returns 一栏正文。
 */
function BodyPane({ title, text, failed }: { title: string; text: string; failed: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback((): void => {
    if (text === "") return;
    void writeClipboard(text).then((ok) => {
      if (!ok) {
        toast("复制失败：浏览器拒绝了剪贴板访问");
        return;
      }
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <div className={css.bodyPane}>
      <div className={css.bodyBar}>
        <span>{title}</span>
        <span className={css.bodyBarSpacer} />
        <Button
          variant="ghost"
          size="sm"
          disabled={text === ""}
          title={copied ? "已复制" : "复制正文"}
          aria-label={`${title} 复制正文`}
          onClick={copy}
          icon={<IconCopyOutlineRegular size={13} />}
          data-llm-records-copy={title}
        >
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <pre className={failed ? `${css.code} ${css.codeFailed}` : css.code} data-llm-records-body={title}>
        {text === "" ? "（空）" : text}
      </pre>
    </div>
  );
}

/**
 * 一条记录的详情块（旧页 llm-records/page.tsx:458-552）。
 * @param props.id - 记录 id。
 * @param props.record - 列表里的行（先用它显示头部信息，详情到货后再用详情覆盖）。
 * @param props.onClose - 关闭详情。
 * @returns 头部 + 归一化 / 原文视图切换 + 请求与响应两栏。
 */
function RecordDetail({
  id,
  record,
  onClose,
}: {
  id: number;
  record: LLMRecordItem;
  onClose: () => void;
}): ReactNode {
  const state = useLlmRecordDetail(id);
  const detail: LLMRecordDetail | null = state.detail;
  /** 是否切换到 HTTP 原文视图（旧页 :144）。 */
  const [rawView, setRawView] = useState(false);

  const hasRaw = llmRecordHasRaw(detail);
  // 开关保持用户选择，但切到一条无原文的旧记录时回落到归一化视图，而不是显示空白（旧页 :146-148）。
  const showRaw = rawView && hasRaw;
  const header = detail ?? record;
  const bodies = llmRecordBodies(detail, showRaw ? "raw" : "normalized");
  const requestText = prettyJsonText(bodies.request);
  const responseText = showRaw ? bodies.response : prettyJsonText(bodies.response);

  return (
    <section className={css.detailBox} aria-label="记录详情" data-llm-record-detail={id}>
      <div className={css.detailHead}>
        <Tag tone="outline">#{header.id}</Tag>
        <Tag tone="outline">{header.profile_name === "" ? "无 profile" : header.profile_name}</Tag>
        <Tag tone="outline">{header.model === "" ? "无模型" : header.model}</Tag>
        {header.task_id === "" ? null : <Tag tone="outline">任务 #{header.task_id}</Tag>}
        {header.worker === "" ? null : <Tag tone="neutral">{header.worker}</Tag>}
        <span className={css.timeCell}>{formatTime(header.ts)}</span>
        <span className={header.latency_ms > 30000 ? css.slow : css.muted}>
          {formatLatency(header.latency_ms)}
        </span>
        <StatusTag record={header} />
        <span className={css.detailSpacer} />
        <Button
          variant={showRaw ? "primary" : "outline"}
          size="sm"
          disabled={!hasRaw}
          title={hasRaw ? "查看与 provider 实际收发的 HTTP 原文" : "该记录没有保存 HTTP 原文（录制原始报文功能上线前的记录）"}
          aria-pressed={showRaw}
          onClick={() => setRawView((value) => !value)}
          data-llm-records-raw-toggle=""
        >
          原文
        </Button>
        <Button variant="outline" size="sm" onClick={onClose} data-llm-records-detail-close="">
          关闭详情
        </Button>
      </div>

      {hasRaw ? null : (
        <p className={css.detailNote}>这条记录没有 HTTP 原文（原始报文录制上线前的记录），只能看归一化后的请求与响应。</p>
      )}

      {llmRecordFailed(header) && header.error !== undefined && header.error !== "" ? (
        <p className={`${css.errorLine} ${css.errorLineDetail}`} role="alert">
          失败原因：{header.error}
        </p>
      ) : null}

      {state.phase === "loading" ? <div className={css.state}>加载记录正文…</div> : null}
      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>读取正文失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload}>
            重试
          </Button>
        </div>
      ) : null}
      {state.phase === "ready" ? (
        <div className={css.split}>
          <BodyPane title={showRaw ? "Request · 原文" : "Request"} text={requestText} failed={false} />
          <BodyPane
            title={showRaw ? "Response · 原文（SSE）" : "Response"}
            text={responseText}
            failed={llmRecordFailed(header)}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * 渲染 LLM 录制页。
 * @returns 页头（录制开关 + 刷新 + 删除任务记录）、筛选工具条、记录表、详情块、删除确认框。
 */
export function LlmRecordsPage(): ReactNode {
  const toggle = useLlmRecordToggle();
  const tasks = useLlmRecordTasks();

  const [page, setPage] = useState(0);
  const [size, setSize] = useState(LLM_RECORDS_PAGE_SIZE);
  const [sessionInput, setSessionInput] = useState("");
  const session = useDebouncedValue(sessionInput.trim(), 250);
  const [model, setModel] = useState(LLM_MODEL_ALL);
  const [task, setTask] = useState(TASK_ALL);
  const [onlyFailed, setOnlyFailed] = useState(false);

  /** 当前展开详情的记录 id；null 表示收起（旧页 :139 的 selected）。 */
  const [selectedId, setSelectedId] = useState<number | null>(null);

  /** 待删除记录的任务；null 表示确认框关闭。 */
  const [deleteTask, setDeleteTask] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  // 筛选条件变化时回到第一页（旧页 :195-197）：只在筛选值变化时触发，不额外多跑一次请求。
  // 手写比较而不用 useEffect，避免首帧重复请求。
  const filterKey = `${session}\u0000${model}\u0000${task}\u0000${size}`;
  const lastFilterKey = useRef(filterKey);
  if (lastFilterKey.current !== filterKey) {
    lastFilterKey.current = filterKey;
    if (page !== 0) setPage(0);
  }

  const query: LlmRecordsQuery = { page, size, model: model === LLM_MODEL_ALL ? "" : model, session, task, onlyFailed };
  const state = useLlmRecords(query);

  // 模型下拉的候选只来自当前页真实出现过的记录（后端没有模型列表接口）。
  const modelItems = useMemo(() => (state.phase === "ready" ? state.rows : []), [state.phase, state.rows]);
  const modelOptions = useMemo(() => {
    const seen = llmRecordModels(modelItems);
    const options = [{ value: LLM_MODEL_ALL, label: "全部模型" }];
    if (model !== LLM_MODEL_ALL && !seen.includes(model)) options.push({ value: model, label: model });
    for (const name of seen) options.push({ value: name, label: name });
    return options;
  }, [modelItems, model]);

  const taskOptions = useMemo(() => {
    const options = [{ value: TASK_ALL, label: "全部任务" }];
    for (const item of tasks.tasks) options.push({ value: item.task_id, label: `#${item.task_id}（${item.count} 条）` });
    return options;
  }, [tasks.tasks]);

  const sizeOptions = useMemo(
    () => LLM_RECORDS_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` })),
    [],
  );

  const pageCount = Math.max(1, Math.ceil(state.total / size));
  const rangeStart = state.total === 0 ? 0 : page * size + 1;
  const rangeEnd = page * size + state.rawCount;
  const selected = state.rows.find((row) => row.id === selectedId) ?? null;

  const onToggleRecording = useCallback(
    (next: boolean): void => {
      setToggleBusy(true);
      setToggleError(null);
      void toggle
        .setEnabled(next)
        .then((message) => {
          if (message === null) toast(next ? "已开启 LLM 录制" : "已关闭 LLM 录制");
          else setToggleError(`保存录制开关失败：${message}`);
        })
        .finally(() => setToggleBusy(false));
    },
    [toggle],
  );

  const askDelete = useCallback((): void => {
    if (task === TASK_ALL) return;
    setDeleteError(null);
    setDeleteTask(task);
  }, [task]);

  const cancelDelete = useCallback((): void => {
    if (deleting) return;
    setDeleteTask(null);
  }, [deleting]);

  const confirmDelete = useCallback((): void => {
    if (deleteTask === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    deleteLlmRecordsOfTask(deleteTask)
      .then((result) => {
        setDeleting(false);
        setDeleteTask(null);
        setSelectedId(null);
        toast(`已删除 ${result.deleted} 条记录`);
        setTask(TASK_ALL);
        setPage(0);
        state.reload();
        tasks.reload();
      })
      .catch((reason: unknown) => {
        setDeleting(false);
        setDeleteError(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [deleteTask, deleting, state, tasks]);

  const refreshAll = useCallback((): void => {
    state.reload();
    tasks.reload();
    toggle.reload();
  }, [state, tasks, toggle]);

  return (
    <div data-data-page="llm-records" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>LLM 录制</h1>
          <p className={css.lead}>
            后端逐次记录的 LLM 调用：时间、模型、profile、token、延迟、状态，点任意一行查看完整的请求与响应正文。
          </p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="LLM 录制动作" data-llm-records-toolbar="">
          <div className={css.toggleGroup}>
            <Switch
              checked={toggle.phase === "ready" ? toggle.enabled : false}
              disabled={toggle.phase !== "ready" || toggleBusy}
              label="开启 LLM 录制"
              title="关闭时后端不记录任何 LLM 调用（settings.llm_record）"
              onChange={onToggleRecording}
            />
            <span className={css.toggleLabel}>
              {toggle.phase === "loading"
                ? "读取开关…"
                : toggle.phase === "offline"
                  ? "开关读取失败"
                  : toggle.enabled
                    ? "录制中"
                    : "已关闭"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={state.phase === "loading"}
            title="重新读取记录、任务与录制开关"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-llm-records-action="refresh"
          >
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={askDelete}
            disabled={task === TASK_ALL || deleting}
            title={task === TASK_ALL ? "先在下方筛选里选择一个任务" : "删除该任务的全部 LLM 记录"}
            data-llm-records-action="delete-task"
          >
            删除该任务记录
          </Button>
        </div>
      </header>

      {toggle.phase === "offline" ? (
        <p className={css.errorLine} role="alert">
          读取录制开关失败：{toggle.error}
          <Button variant="ghost" size="sm" onClick={toggle.reload}>
            重试
          </Button>
        </p>
      ) : null}
      {toggleError === null ? null : (
        <p className={css.errorLine} role="alert">
          {toggleError}
        </p>
      )}

      <div className={css.filterBar} role="toolbar" aria-label="LLM 录制筛选" data-llm-records-filters="">
        <div className={css.filterField}>
          <span className={css.filterLabel}>任务</span>
          <SelectMenu
            value={task}
            options={taskOptions}
            ariaLabel="按任务筛选"
            onChange={(value) => {
              setTask(value);
              setSelectedId(null);
            }}
          />
        </div>
        <div className={css.filterField}>
          <span className={css.filterLabel}>模型</span>
          <SelectMenu
            value={model}
            options={modelOptions}
            ariaLabel="按模型筛选"
            onChange={(value) => {
              setModel(value);
              setSelectedId(null);
            }}
          />
        </div>
        <div className={`${css.filterField} ${css.sessionField}`}>
          <Input
            value={sessionInput}
            aria-label="按 Session ID 搜索"
            placeholder="Session ID（模糊匹配）"
            onChange={(event) => setSessionInput(event.currentTarget.value)}
            data-llm-records-session=""
          />
        </div>
        <div className={css.toggleGroup}>
          <Switch
            checked={onlyFailed}
            label="只看失败"
            title="后端没有 status 过滤参数，这一项按当前页记录的 status 在前端过滤"
            onChange={(next) => {
              setOnlyFailed(next);
              setSelectedId(null);
            }}
          />
          <span className={css.toggleLabel}>只看失败</span>
        </div>
      </div>

      {tasks.phase === "offline" ? (
        <p className={css.errorLine} role="alert">
          读取任务下拉数据失败：{tasks.error}（「任务」筛选暂时只有「全部任务」）
          <Button variant="ghost" size="sm" onClick={tasks.reload}>
            重试
          </Button>
        </p>
      ) : null}

      <div className={css.summary} data-llm-records-summary="">
        <span className={css.summaryStrong}>
          匹配 {state.total} 条
        </span>
        <span>
          本页 {rangeStart}–{rangeEnd}
        </span>
        {onlyFailed ? <span>仅显示失败的 {state.rows.length} 条（当前页）</span> : null}
      </div>

      {state.phase === "loading" ? (
        <div className={css.state} data-llm-records-state="loading">
          加载录制记录…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-llm-records-state="offline">
          <span>读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-llm-records-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && state.rows.length === 0 ? (
        <div className={css.empty} data-llm-records-state="empty">
          <IconListPenOutlineRegular size={20} />
          <span className={css.emptyTitle}>
            {state.rawCount === 0 ? "暂无 LLM 调用记录" : "当前页没有失败的记录"}
          </span>
          <span className={css.emptyText}>
            {state.rawCount === 0
              ? "录制开关关闭时后端不记录任何调用；打开右上角开关后，新的 LLM 调用会出现在这里。"
              : "「只看失败」按当前页记录的 status 在前端过滤，这一页里没有失败记录，可以翻页或关掉这一项。"}
          </span>
        </div>
      ) : null}

      {state.phase === "ready" && state.rows.length > 0 ? (
        <div className={css.tableWrap}>
          <table className={css.table} data-llm-records-rows="">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">任务</th>
                <th scope="col">Worker</th>
                <th scope="col">Profile</th>
                <th scope="col">模型</th>
                <th scope="col">延迟</th>
                <th scope="col">Token（入/出）</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selectedId ? `${css.row} ${css.rowActive}` : css.row}
                  aria-selected={row.id === selectedId}
                  onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}
                  data-llm-records-row={row.id}
                >
                  <td className={css.timeCell}>{formatTime(row.ts)}</td>
                  <td className={css.mono}>{row.task_id === "" ? "—" : `#${row.task_id}`}</td>
                  <td>{row.worker === "" ? "—" : row.worker}</td>
                  <td>{row.profile_name === "" ? "—" : row.profile_name}</td>
                  <td className={css.mono}>{row.model === "" ? "—" : row.model}</td>
                  <td className={row.latency_ms > 30000 ? css.slow : css.nums}>{formatLatency(row.latency_ms)}</td>
                  <td className={css.nums}>
                    {formatTokens(row.input_tokens)} / {formatTokens(row.output_tokens)}
                  </td>
                  <td>
                    <StatusTag record={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.phase === "ready" && state.total > 0 ? (
        <div className={css.pager} data-llm-records-pager="">
          <SelectMenu
            value={String(size)}
            options={sizeOptions}
            ariaLabel="每页条数"
            onChange={(value) => {
              const next = Number.parseInt(value, 10);
              if (Number.isFinite(next) && next > 0) setSize(next);
            }}
          />
          <span>
            {rangeStart}–{rangeEnd} / {state.total}
          </span>
          <span className={css.pagerRight}>
            <Button
              variant="outline"
              size="sm"
              aria-label="上一页"
              title={page <= 0 ? "已经是第一页" : "上一页"}
              disabled={page <= 0}
              onClick={() => setPage(Math.max(0, page - 1))}
              icon={<IconChevronLeftOutlineRegular size={13} />}
            />
            <span>
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label="下一页"
              title={page + 1 >= pageCount ? "已经是最后一页" : "下一页"}
              disabled={page + 1 >= pageCount}
              onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
              icon={<IconChevronRightOutlineRegular size={13} />}
            />
          </span>
        </div>
      ) : null}

      {selected === null ? null : (
        <RecordDetail id={selected.id} record={selected} onClose={() => setSelectedId(null)} />
      )}

      <Modal
        open={deleteTask !== null}
        onClose={cancelDelete}
        title="确认删除任务记录"
        closeLabel="关闭"
        tone="warning"
        description={
          deleteTask === null
            ? undefined
            : `将永久删除任务 #${deleteTask} 的全部 LLM 调用记录（含请求 / 响应正文与 HTTP 原文），此操作不可撤销。`
        }
        footer={
          <>
            <Button variant="outline" size="sm" onClick={cancelDelete} disabled={deleting} data-llm-records-delete-cancel="">
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={confirmDelete} disabled={deleting} data-llm-records-delete-confirm="">
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={css.confirmBody}>
          <p style={{ margin: 0 }}>该任务在这张表里的全部记录会一并删除，删掉的记录无法恢复。</p>
          {deleteError === null ? null : (
            <p className={css.errorLine} role="alert" data-llm-records-delete-error="">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
