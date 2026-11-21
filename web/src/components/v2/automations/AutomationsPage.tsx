"use client";

/**
 * 「自动化」页（侧栏一级页，`?page=automations`）：定时任务的列表、新建 / 编辑、
 * 启停、立即运行与运行记录。
 *
 * 参照（.tmp/d5-goal-plan-schedule-design.md §1、§3.3）：DSH 侧栏「自动化任务」页、
 * Codex 的 Scheduled 收件箱——一级入口、每行一条计划、行尾启停开关、运行记录可回看；
 * mioX 默认「投递到任务主会话 + 只读巡检」，每次运行记录新增发现数。
 */
import * as React from "react";

import {
  AddSlot,
  Badge,
  Card,
  Dot,
  Empty,
  FilterBar,
  IconButton,
  Meta,
  Notice,
  Page,
  PageHead,
  RowMenu,
  Section,
  Skeleton,
  Toolbar,
  ToolbarEnd,
  kit,
} from "@/components/v2/design/Kit";
import { toast } from "@/components/v2/settings/Toast";
import type { Automation, AutomationInput } from "@/lib/types";
import {
  createAutomation,
  deleteAutomation,
  describeTiming,
  formatRelative,
  formatWhen,
  runAutomationNow,
  setAutomationEnabled,
  statusTone,
  updateAutomation,
  useAutomationRuns,
  useAutomations,
} from "@/v2/data/automations";
import { useTasks } from "@/v2/data/tasks";
import { IconClockOutlineRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";

import { AutomationEditor, type AutomationTemplate } from "./AutomationEditor";
import css from "./AutomationsPage.module.css";

type Filter = "all" | "enabled" | "paused";

/** 起步模板：只预填表单，保存前不写任何东西。 */
const TEMPLATES: ReadonlyArray<AutomationTemplate & { blurb: string }> = [
  {
    title: "每日资产变化巡检",
    blurb: "每天早上复查范围内资产的新端口、新子域与证书变化",
    prompt: "复查本任务范围内的资产：是否出现新的开放端口、新子域或证书变化。只做只读探测，汇总与上次相比的变化，没有变化就简短说明。",
    kind: "daily",
    timing: { time: "09:00" },
  },
  {
    title: "每周发现复测",
    blurb: "每周一复测仍未修复的高危发现，记录是否已修复",
    prompt: "列出本任务仍处于待处理或已确认状态的高危、严重发现，逐条用只读方式核对是否仍可复现，汇总哪些已修复、哪些仍存在。",
    kind: "weekly",
    timing: { time: "10:00", weekdays: [1] },
  },
  {
    title: "定时进度汇报",
    blurb: "每隔几小时汇总一次任务进展与新发现",
    prompt: "汇总自上次汇报以来本任务的进展：新增发现、完成的意图、受阻的方向，以及下一步建议。只读，不发起新的扫描。",
    kind: "every",
    timing: { every_sec: 4 * 3600 },
  },
];

/** 运行记录（卡内展开）。 */
function RunsPanel({ automation }: { automation: Automation }): React.ReactNode {
  const state = useAutomationRuns(automation.id);
  if (state.phase === "loading") return <div className={css.runs}><Skeleton label="读取运行记录" /></div>;
  if (state.phase === "offline") {
    return (
      <div className={css.runs}>
        <Notice tone="danger" action={<Button size="sm" variant="outline" onClick={state.reload}>重试</Button>}>
          读取运行记录失败：{state.error}
        </Notice>
      </div>
    );
  }
  return (
    <div className={css.runs} data-automation-runs={state.runs.length}>
      <div className={css.runsHead}>
        <span>运行记录</span>
        <IconButton label="刷新运行记录" onClick={state.reload}>
          <IconRefreshOutlineRegular size={13} />
        </IconButton>
      </div>
      {state.runs.length === 0 ? (
        <p className={css.runsEmpty}>还没有运行过。到点后或点「立即运行」会在这里留下记录。</p>
      ) : (
        <ol className={css.runList}>
          {state.runs.map((run) => {
            const tone = statusTone(run.status);
            const started = run.started_at === null ? null : Date.parse(run.started_at);
            const finished = run.finished_at === null ? null : Date.parse(run.finished_at);
            const seconds = started !== null && finished !== null ? Math.max(0, Math.round((finished - started) / 1000)) : null;
            return (
              <li key={run.id} className={css.runRow} data-automation-run={run.status}>
                <Dot tone={tone.tone} pulse={run.status === "running"} />
                <span className={css.runTime}>{formatWhen(run.scheduled_at)}</span>
                <span className={css.runStatus}>{tone.label}</span>
                <span className={css.runSummary} title={run.error || run.summary}>
                  {run.error !== "" ? run.error : run.summary || "—"}
                </span>
                <span className={css.runFacts}>
                  {seconds === null ? null : <span>{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`}</span>}
                  {run.findings_delta > 0 ? <Badge tone="warning">+{run.findings_delta} 发现</Badge> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {state.hasMore ? (
        <button type="button" className={css.moreRuns} onClick={state.loadMore}>
          加载更早的记录
        </button>
      ) : null}
    </div>
  );
}

/** 「自动化」页。 */
export function AutomationsPage(): React.ReactNode {
  const state = useAutomations();
  const tasks = useTasks();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  /** "new" | automation id | null */
  const [editing, setEditing] = React.useState<string | null>(null);
  const [template, setTemplate] = React.useState<AutomationTemplate | undefined>(undefined);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Automation | null>(null);

  const taskList = tasks.tasks ?? [];

  // DX-S3 deep link：`?page=automations&automation=<id>` 定位（展开）该行——
  // 会话头时钟的入口靠它带上下文；组件只在挂载时读一次（照抄新建表单读 `?task=` 的口径，
  // `AutomationsPage.tsx` defaultTaskId）。SPA 到本页必然重新挂载。
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("automation");
    if (id !== null && id !== "") {
      setExpanded(id);
      setEditing(null);
      setTemplate(undefined);
    }
  }, []);

  const taskName = (id: string | null): string => {
    if (id === null) return "—";
    const task = taskList.find((row) => row.id === id);
    const name = task?.name?.trim() || task?.goal?.trim() || "";
    return name === "" ? `任务 #${id}` : `#${id} ${name}`;
  };

  const all = state.automations;
  const enabledCount = all.filter((row) => row.enabled).length;
  const visible = all.filter((row) => {
    if (filter === "enabled" && !row.enabled) return false;
    if (filter === "paused" && row.enabled) return false;
    const q = query.trim().toLowerCase();
    return q === "" || row.title.toLowerCase().includes(q) || row.prompt.toLowerCase().includes(q);
  });
  const nextUp = all
    .filter((row) => row.enabled && row.next_run_at !== null)
    .sort((a, b) => Date.parse(a.next_run_at ?? "") - Date.parse(b.next_run_at ?? ""))[0];

  const startNew = (preset?: AutomationTemplate): void => {
    setTemplate(preset);
    setFormError(null);
    setEditing("new");
    setExpanded(null);
  };

  const save = (input: AutomationInput, existing?: Automation): void => {
    setBusy(existing?.id ?? "new");
    setFormError(null);
    const write = existing === undefined ? createAutomation({ ...input, enabled: true }) : updateAutomation(existing, input);
    void write
      .then((row) => {
        toast(existing === undefined ? `已创建「${row.title}」，下次 ${formatWhen(row.next_run_at)}` : "已保存");
        setEditing(null);
        setTemplate(undefined);
        state.reload();
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        setFormError(message);
        if (message.includes("别处修改")) state.reload();
      })
      .finally(() => setBusy(null));
  };

  const toggle = (row: Automation, enabled: boolean): void => {
    setBusy(row.id);
    void setAutomationEnabled(row, enabled)
      .then((next) => toast(enabled ? `已恢复，下次 ${formatWhen(next.next_run_at)}` : "已暂停"))
      .catch((reason: unknown) => toast(`操作失败：${reason instanceof Error ? reason.message : String(reason)}`))
      .finally(() => {
        setBusy(null);
        state.reload();
      });
  };

  const runNow = (row: Automation): void => {
    setBusy(row.id);
    void runAutomationNow(row.id)
      .then((result) => {
        const label: Record<string, string> = {
          delivered: "已投递到任务主会话",
          queued: "任务主会话忙，已排队，空闲后投递",
          merged: "已有排队中的运行，已合并",
          skipped: "目标任务不可用，已跳过",
          agent: "已投递到 Agent 触发队列",
        };
        toast(label[result.outcome] ?? `已运行（${result.outcome}）`);
        setExpanded(row.id);
      })
      .catch((reason: unknown) => toast(`立即运行失败：${reason instanceof Error ? reason.message : String(reason)}`))
      .finally(() => {
        setBusy(null);
        state.reload();
      });
  };

  const confirmDelete = (): void => {
    if (pendingDelete === null) return;
    const row = pendingDelete;
    setBusy(row.id);
    void deleteAutomation(row.id)
      .then(() => toast(`已删除「${row.title}」`))
      .catch((reason: unknown) => toast(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`))
      .finally(() => {
        setBusy(null);
        setPendingDelete(null);
        state.reload();
      });
  };

  return (
    <Page width="wide" data={{ "data-automations-page": "" }}>
      <PageHead
        title="自动化"
        lead={
          state.phase !== "ready"
            ? "按计划把指令投递到任务主会话：定期巡检、复测、汇报。"
            : all.length === 0
              ? "按计划把指令投递到任务主会话：定期巡检、复测、汇报。默认只读，不会发起主动操作。"
              : `${all.length} 个自动化 · ${enabledCount} 个启用${nextUp === undefined ? "" : ` · 最近一次 ${formatWhen(nextUp.next_run_at)}（${formatRelative(nextUp.next_run_at)}）`}`
        }
        actions={
          <>
            <IconButton label="刷新" onClick={state.reload}>
              <IconRefreshOutlineRegular size={14} />
            </IconButton>
            <Button variant="primary" size="sm" disabled={editing === "new"} data-automation-new="" onClick={() => startNew()}>
              新建自动化
            </Button>
          </>
        }
      />

      {state.phase === "loading" ? <Skeleton label="读取自动化" /> : null}
      {state.phase === "offline" ? (
        <Notice tone="danger" action={<Button size="sm" variant="outline" onClick={state.reload}>重试</Button>}>
          读取自动化失败：{state.error}
        </Notice>
      ) : null}

      {editing === "new" ? (
        <Section title={template === undefined ? "新建自动化" : `新建：${template.title}`}>
          <Card>
            <AutomationEditor
              template={template}
              tasks={taskList}
              defaultTaskId={new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("task")}
              busy={busy === "new"}
              error={formError}
              onCancel={() => {
                setEditing(null);
                setTemplate(undefined);
              }}
              onSubmit={(input) => save(input)}
            />
          </Card>
        </Section>
      ) : null}

      {state.phase === "ready" && all.length === 0 && editing !== "new" ? (
        <Section title="从一个模板开始" hint="只会预填表单，保存前不会创建任何东西">
          <div className={css.templates} data-automation-templates={TEMPLATES.length}>
            {TEMPLATES.map((preset) => (
              <button key={preset.title} type="button" className={css.template} data-automation-template={preset.kind} onClick={() => startNew(preset)}>
                <span className={css.templateIcon} aria-hidden="true">
                  <IconClockOutlineRegular size={16} />
                </span>
                <span className={css.templateTitle}>{preset.title}</span>
                <span className={css.templateText}>{preset.blurb}</span>
                <span className={css.templateWhen}>{describeTiming(preset.kind, preset.timing)} · 只读巡检</span>
              </button>
            ))}
          </div>
          <AddSlot onClick={() => startNew()} data={{ "data-automation-blank": "" }}>
            从空白开始
          </AddSlot>
        </Section>
      ) : null}

      {state.phase === "ready" && all.length > 0 ? (
        <Section title="计划" count={visible.length}>
          <Toolbar>
            <FilterBar
              id="automation-filter"
              label="筛选"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "全部", count: all.length },
                { value: "enabled", label: "已启用", count: enabledCount },
                { value: "paused", label: "已暂停", count: all.length - enabledCount },
              ]}
            />
            <ToolbarEnd>
              <input
                className={`${kit.input} ${css.search}`}
                value={query}
                placeholder="搜索名称或指令"
                aria-label="搜索自动化"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </ToolbarEnd>
          </Toolbar>

          {visible.length === 0 ? (
            <Card>
              <Empty inCard title="没有匹配的自动化" text="换个筛选或搜索词。" />
            </Card>
          ) : (
            <Card>
              {visible.map((row) => {
                const tone = statusTone(row.running ? "running" : row.last_status);
                const isEditing = editing === row.id;
                const isOpen = expanded === row.id;
                return (
                  <div key={row.id} className={css.item} data-automation-id={row.id} data-automation-enabled={row.enabled ? "on" : "off"}>
                    <div className={css.row}>
                      <span className={row.enabled ? css.rowIcon : `${css.rowIcon} ${css.rowIconOff}`} aria-hidden="true">
                        <IconClockOutlineRegular size={15} />
                      </span>
                      <button
                        type="button"
                        className={css.rowMain}
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                      >
                        <span className={row.enabled ? css.rowTitle : `${css.rowTitle} ${css.rowTitleOff}`}>{row.title}</span>
                        <Meta
                          items={[
                            describeTiming(row.timing_kind, row.timing),
                            taskName(row.task_id),
                            row.safety === "readonly" ? "只读巡检" : "沿用任务权限",
                          ]}
                        />
                      </button>
                      <span className={css.rowNext} title={row.next_run_at ?? undefined}>
                        {row.enabled ? (
                          row.next_run_at === null ? (
                            <span className={css.muted}>无下次运行</span>
                          ) : (
                            <>
                              <span className={css.nextLabel}>下次</span>
                              <span className={css.nextTime}>{formatWhen(row.next_run_at)}</span>
                            </>
                          )
                        ) : (
                          <span className={css.muted}>已暂停</span>
                        )}
                      </span>
                      <span className={css.rowStatus} data-automation-status={row.running ? "running" : row.last_status || "never"}>
                        <Dot tone={tone.tone} pulse={row.running} />
                        <span>{row.last_run_at === null && !row.running ? "未运行" : tone.label}</span>
                      </span>
                      <Switch
                        checked={row.enabled}
                        label={row.enabled ? `暂停「${row.title}」` : `启用「${row.title}」`}
                        disabled={busy === row.id}
                        onChange={(next: boolean) => toggle(row, next)}
                      />
                      <RowMenu
                        label={`「${row.title}」的更多操作`}
                        data={{ "data-automation-more": row.id }}
                        items={[
                          { label: "立即运行", onSelect: () => runNow(row), disabled: busy === row.id || row.running, data: { "data-automation-run-now": row.id } },
                          { label: isOpen ? "收起运行记录" : "运行记录", onSelect: () => setExpanded(isOpen ? null : row.id) },
                          {
                            label: "编辑",
                            onSelect: () => {
                              setFormError(null);
                              setEditing(row.id);
                              setExpanded(null);
                            },
                            data: { "data-automation-edit": row.id },
                          },
                          { label: "删除", danger: true, separatorBefore: true, onSelect: () => setPendingDelete(row), data: { "data-automation-delete": row.id } },
                        ]}
                      />
                    </div>
                    {isEditing ? (
                      <div className={css.inlineEditor}>
                        <AutomationEditor
                          automation={row}
                          tasks={taskList}
                          busy={busy === row.id}
                          error={formError}
                          onCancel={() => setEditing(null)}
                          onSubmit={(input) => save(input, row)}
                        />
                      </div>
                    ) : null}
                    {isOpen && !isEditing ? (
                      <div className={css.detail}>
                        <p className={css.prompt}>{row.prompt}</p>
                        <RunsPanel automation={row} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          )}
        </Section>
      ) : null}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        closeLabel="关闭"
        title="删除这个自动化？"
        description="删除后不会再按计划投递，运行记录也会一并删除。已经投递到任务里的消息不受影响。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="primary" className={css.dangerButton} disabled={busy !== null} data-automation-delete-confirm="" onClick={confirmDelete}>
              删除
            </Button>
          </>
        }
      >
        {pendingDelete === null ? null : (
          <div className={css.deleteSummary}>
            <span className={css.rowTitle}>{pendingDelete.title}</span>
            <span className={css.muted}>{describeTiming(pendingDelete.timing_kind, pendingDelete.timing)} · {taskName(pendingDelete.task_id)}</span>
          </div>
        )}
      </Modal>
    </Page>
  );
}
