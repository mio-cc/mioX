"use client";

/**
 * 任务内发现（会话视图 tab「发现」，对照表 P1:C17）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/findings-tab.tsx:43-138（行：标题、
 * 严重度、继承只读行、状态下拉、时间、证据展开、详情入口）、:190-222（列表与空态）。
 * DSH 依据：DSH 无任务内发现页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：数据走 `v2/data/task-findings.ts` 的 `useTaskFindingsPage`（`api.findingsPage`，api.ts:637）；
 * 改状态走同一模块的 `setFindingStatus`（`api.setFindingStatus`，api.ts:760）。
 *
 * D2 版式：PageHead（刷新 + 到发现库）→ 状态 FilterBar（全部 + 9 种处置状态；当前项显示条数）→
 * 列表卡（每条发现一行：严重度点 + 标题 + 严重度/只读徽标 + 摘要与时间；行尾状态选择 + 打开详情）→
 * 卡底分页条。空态/加载/错误用 Empty / Skeleton / Notice。
 *
 * U1（.tmp/d6-ia-inventory.md §4.6、§5 的 ①④）：`?view=findings` 让中间发现视图可深链；
 * 右·发现「在发现视图打开」带 `?hl=<findingId>`，本视图读到后滚动到该行、以 DSH alias
 * token 的柔和底色高亮 2 秒再撤销，并把 hl 从地址上摘掉。头部「在发现库查看全部」跳
 * 全局发现库并预置本任务筛选（`?page=findings&ftask=`，与 Shell 的 `?task=` 互不干扰）。
 */
import { type ReactNode, useEffect, useState } from "react";

import type { Finding, FindingStatus, Task } from "@/lib/types";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import {
  Badge,
  Card,
  Dot,
  Empty,
  FilterBar,
  IconButton,
  type KitTone,
  Meta,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconShieldOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  findingStatusLabel,
  formatFindingTime,
  severityLabel,
  STATUS_FILTER_ORDER,
} from "@/v2/data/findings-page";
import {
  findingReadOnly,
  findingWriteId,
  setFindingStatus,
  TASK_FINDINGS_PAGE_SIZE,
  useTaskFindingsPage,
} from "@/v2/data/task-findings";
import { CONVERSATION_VIEW_EVENT } from "@/v2/data/conversation-view-url";

import css from "./TaskFindingsView.module.css";

/** 状态筛选取值：`all` 或后端的 9 种处置状态。 */
type StatusFilter = "all" | FindingStatus;

/** 状态筛选项（全部 + 后端 9 种，顺序照 STATUS_FILTER_ORDER）。 */
const STATUS_FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  ...STATUS_FILTER_ORDER.map((status) => ({ value: status as StatusFilter, label: findingStatusLabel(status) })),
];

/** 行内改状态的选项（9 种处置状态，不含「全部」）。 */
const STATUS_WRITE_OPTIONS: readonly { value: FindingStatus; label: string }[] = STATUS_FILTER_ORDER.map(
  (status) => ({ value: status, label: findingStatusLabel(status) }),
);

/**
 * 严重等级对应的语义色调（点与徽标共用）。
 * @param severity - 后端严重等级。
 * @returns kit 色调。
 */
function severityTone(severity: string): KitTone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  return "neutral";
}

/**
 * 打开某个漏洞的详情（真实 SPA 导航：改地址后通知 Shell 重新读取 `?page=`）。
 * 写法照抄 `components/v2/task-views/ReportView.tsx` 的 `openFindingDetail`。
 * @param id - 漏洞 id。
 */
function openFindingDetail(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  url.searchParams.set("finding", id);
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * 「在发现库查看全部」：跳全局发现库并预置本任务筛选（U1）。
 * `ftask` 是发现库自己的任务筛选深链（FindingsDataPage 读，默认 all）；
 * 不能用 `task`，那会被 Shell 当成选中任务参数（Shell.tsx:1323）。
 * 写法与 `openFindingDetail` 同一条 `?page=` 导航（pushState + popstate）。
 * @param taskId - 当前任务 id。
 */
function openFindingsLibrary(taskId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  url.searchParams.set("ftask", taskId);
  url.searchParams.delete("finding");
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * 一行的标题：优先漏洞名称，否则漏洞类型（旧页 findings-tab.tsx:25-29）。
 * @param finding - 后端发现行。
 * @returns 显示名。
 */
function rowTitle(finding: Finding): string {
  const name = finding.name?.trim() ?? "";
  if (name !== "") return name;
  const vulnclass = finding.vulnclass?.trim() ?? "";
  return vulnclass === "" ? "未分类" : vulnclass;
}

/**
 * 渲染任务内发现视图。
 * @param props.task - 当前选中的任务。
 * @returns 发现列表（含状态筛选、行内改状态、详情入口、分页与四种状态）。
 */
export function TaskFindingsView({ task }: { task: Task }): ReactNode {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const state = useTaskFindingsPage(task.id, page, status);
  /** U1：`?hl=` 带来的一次性定位（右·发现「在发现视图打开」），高亮目标发现 id。 */
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // 换任务或换筛选时回到第一页，避免停在一个不存在的页码上。
  useEffect(() => {
    setPage(1);
  }, [task.id, status]);

  // U1：读一次性的 `?hl=`（右·发现「在发现视图打开」传来的定位），用完即把它从地址上
  // 摘掉。挂载时读一次；而且也订阅跳转事件与 popstate——点「在发现视图打开」时本视图
  // 可能已经是当前视图（不会重挂载），hl 的出现只能从事件里追到。
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const readHl = (): void => {
      const url = new URL(window.location.href);
      const hl = url.searchParams.get("hl");
      if (hl === null || hl.trim() === "") return;
      setHighlightId(hl.trim());
      url.searchParams.delete("hl");
      window.history.replaceState(window.history.state, "", url.toString());
    };
    readHl();
    window.addEventListener(CONVERSATION_VIEW_EVENT, readHl);
    window.addEventListener("popstate", readHl);
    return () => {
      window.removeEventListener(CONVERSATION_VIEW_EVENT, readHl);
      window.removeEventListener("popstate", readHl);
    };
  }, []);

  // U1：该行就绪后滚到可视区，并用 DSH alias token 的柔和底色高亮 2 秒。
  // 右栏发来的 hl 可能是 findings 表行 id，也可能是探测节点 id（FindingsPane 的行 id
  // 是节点 id），三个 id 体系都比对一遍，匹配哪行就高亮哪行。
  useEffect(() => {
    if (highlightId === null || state.phase !== "ready") return undefined;
    const row = state.items.find(
      (item) =>
        findingWriteId(item) === highlightId ||
        (item.finding_id ?? "") === highlightId ||
        String(item.id) === highlightId,
    );
    if (row === undefined) return undefined;
    const id = findingWriteId(row);
    const node = document.querySelector(`[data-task-finding="${id}"]`);
    if (!(node instanceof HTMLElement)) return undefined;
    node.scrollIntoView({ block: "center" });
    node.setAttribute("data-task-hl", "");
    node.style.transition = "background-color 240ms ease-out";
    // 柔和的业务色底子：与 Kit 行 hover 同一色系，10% 混入层底。
    node.style.backgroundColor =
      "color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-layer-1))";
    const timer = window.setTimeout((): void => {
      node.removeAttribute("data-task-hl");
      node.style.backgroundColor = "";
      node.style.transition = "";
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [highlightId, state.items, state.phase]);

  const pageCount = Math.max(1, Math.ceil(state.total / TASK_FINDINGS_PAGE_SIZE));

  // 行内改状态：一次只允许一行在写。
  const [savingId, setSavingId] = useState<string | null>(null);
  const [writeFailure, setWriteFailure] = useState<string | null>(null);

  /**
   * 改一行的处理状态；成功后 toast 并刷新列表，失败时把后端原因写在页面上。
   * @param row - 被改的发现行。
   * @param next - 目标处置状态。
   */
  const changeStatus = (row: Finding, next: FindingStatus): void => {
    if (findingReadOnly(row) || next === row.status || savingId !== null) return;
    const id = findingWriteId(row);
    setSavingId(id);
    setWriteFailure(null);
    setFindingStatus(id, next)
      .then(() => {
        setSavingId(null);
        toast(`已标记为「${findingStatusLabel(next)}」`);
        state.reload();
      })
      .catch((reason: unknown) => {
        setSavingId(null);
        setWriteFailure(`修改处理状态失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const countText = state.phase === "ready" ? `${state.total} 条` : state.phase === "loading" ? "读取中…" : "读取失败";
  const first = (page - 1) * TASK_FINDINGS_PAGE_SIZE + 1;
  const last = Math.min(state.total, page * TASK_FINDINGS_PAGE_SIZE);

  return (
    <Page data={{ "data-task-findings": "" }}>
      <PageHead
        title="发现"
        lead="本任务及直接关联任务确认的漏洞。可以就地标记处置状态；继承自关联任务的条目只读。"
        actions={
          <>
            {/* U1：中→左跳转（.tmp/d6-ia-inventory.md §4.6），安静的链接，不打断本视图。 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openFindingsLibrary(task.id)}
              data-task-findings-library=""
            >
              在发现库查看全部 →
            </Button>
            <IconButton
              label="刷新"
              spinning={state.phase === "loading"}
              onClick={state.reload}
              data-task-findings-refresh=""
            >
              <IconRefreshOutlineRegular size={14} />
            </IconButton>
          </>
        }
      />

      <Section
        title="发现列表"
        count={<span data-task-findings-count="">{countText}</span>}
        data={{ "data-task-findings-filter": "" }}
      >
        <FilterBar<StatusFilter>
          id="task-findings-status"
          label="按处理状态筛选"
          value={status}
          className={css.filters}
          options={STATUS_FILTER_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            count: option.value === status && state.phase === "ready" ? state.total : undefined,
          }))}
          onChange={setStatus}
        />

        {writeFailure === null ? null : (
          <Notice
            tone="danger"
            data={{ "data-task-findings-write-error": "" }}
            action={
              <Button variant="ghost" size="sm" onClick={() => setWriteFailure(null)}>
                知道了
              </Button>
            }
          >
            {writeFailure}
          </Notice>
        )}

        {state.phase === "loading" ? (
          <Card data={{ "data-task-findings-state": "loading" }}>
            <Skeleton label="加载发现" />
          </Card>
        ) : null}

        {state.phase === "offline" ? (
          <Notice
            tone="danger"
            data={{ "data-task-findings-state": "offline" }}
            action={
              <Button variant="ghost" size="sm" onClick={state.reload} data-task-findings-action="retry">
                重试
              </Button>
            }
          >
            发现读取失败：{state.error}
          </Notice>
        ) : null}

        {state.phase === "ready" && state.items.length === 0 ? (
          <Card>
            <Empty
              inCard
              icon={<IconShieldOutlineRegular size={18} />}
              data={{ "data-task-findings-state": "empty" }}
              title={status === "all" ? "暂无发现" : `没有「${findingStatusLabel(status)}」的发现`}
              text={
                status === "all"
                  ? "本任务及直接关联任务暂无确认发现。agent 确认漏洞后，会按时间倒序出现在这里。"
                  : "本任务没有这个状态的发现，换个状态看看。"
              }
              action={
                status === "all" ? undefined : (
                  <Button variant="ghost" size="sm" onClick={() => setStatus("all")}>
                    查看全部
                  </Button>
                )
              }
            />
          </Card>
        ) : null}

        {state.phase === "ready" && state.items.length > 0 ? (
          <Card className={css.list} data={{ "data-task-findings-rows": "" }}>
            {state.items.map((row) => {
              const id = findingWriteId(row);
              const readOnly = findingReadOnly(row);
              const writing = savingId === id;
              const tone = severityTone(row.severity);
              return (
                <Row
                  key={row.finding_id ?? row.id}
                  data={{ "data-task-finding": id, "data-status": row.status }}
                  top={row.summary !== ""}
                  lead={
                    <span className={css.dotSeat}>
                      <Dot tone={tone} />
                    </span>
                  }
                  label={<span title={rowTitle(row)}>{rowTitle(row)}</span>}
                  labelAdornment={
                    <>
                      <Badge tone={tone}>{severityLabel(row.severity)}</Badge>
                      {readOnly ? <Badge title="继承自关联任务，只读">继承 · 只读</Badge> : null}
                    </>
                  }
                  description={
                    <span className={css.desc}>
                      {row.summary === "" ? null : <span className={css.summary}>{row.summary}</span>}
                      <Meta
                        items={[
                          row.vulnclass !== undefined && row.vulnclass !== "" && row.vulnclass !== rowTitle(row)
                            ? row.vulnclass
                            : null,
                          formatFindingTime(row.ts),
                          writing ? (
                            <span key="saving" className={css.saving}>
                              保存中…
                            </span>
                          ) : null,
                        ]}
                      />
                    </span>
                  }
                >
                  {readOnly ? (
                    <span className={css.readOnlyStatus}>{findingStatusLabel(row.status)}</span>
                  ) : (
                    <SelectMenu
                      ariaLabel={`处理状态：${rowTitle(row)}`}
                      value={row.status}
                      disabled={savingId !== null}
                      onChange={(value) => changeStatus(row, value as FindingStatus)}
                      options={STATUS_WRITE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    />
                  )}
                  <IconButton label="打开详情" onClick={() => openFindingDetail(id)} data-task-finding-open={id}>
                    <IconRightUpOutlineRegular size={14} />
                  </IconButton>
                </Row>
              );
            })}
            <footer className={css.pager} data-task-findings-pager="">
              <span className={css.pageInfo} data-task-findings-page-info="">
                {first}–{last} · 共 {state.total} 条 · 第 {page} / {pageCount} 页
              </span>
              <IconButton
                label="上一页"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                data-task-findings-page="prev"
              >
                <IconChevronLeftOutlineRegular size={14} />
              </IconButton>
              <IconButton
                label="下一页"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                data-task-findings-page="next"
              >
                <IconChevronRightOutlineRegular size={14} />
              </IconButton>
            </footer>
          </Card>
        ) : null}
      </Section>
    </Page>
  );
}
