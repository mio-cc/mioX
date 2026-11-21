"use client";

/**
 * 自动化编辑器（新建 / 编辑共用，卡内展开）。
 *
 * 字段（.tmp/d5-goal-plan-schedule-design.md §3.3）：名称 · 投递到哪个任务 · 指令 ·
 * 运行时间（一次 / 每隔 / 每天 / 每周）· 安全档（只读巡检 / 沿用任务权限）。
 * 时间区块下方实时显示后端算出的「接下来 3 次」（POST /automations/preview），
 * 用户看到的就是调度器真正会用的时间，不在前端另算一套。
 */
import * as React from "react";

import {
  EditorActions,
  EditorGroup,
  Editor,
  Field,
  FieldGrid,
  FilterBar,
  Notice,
  TextArea,
  TextInput,
  UnitInput,
  kit,
} from "@/components/v2/design/Kit";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import type { Automation, AutomationInput, AutomationTiming, AutomationTimingKind, Task } from "@/lib/types";
import { formatWhen, previewAutomation } from "@/v2/data/automations";
import { Button } from "@/vendor/dsh/primitives/Button";

import css from "./AutomationsPage.module.css";

type Kind = AutomationTimingKind;

const KIND_OPTIONS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "every", label: "每隔" },
  { value: "once", label: "仅一次" },
  { value: "cron", label: "自定义" },
];

const EVERY_UNITS = [
  { value: "60", label: "分钟" },
  { value: "3600", label: "小时" },
  { value: "86400", label: "天" },
] as const;

const WEEKDAYS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

/** 本地 datetime-local 默认值：明天 09:00。 */
function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

/** ISO → datetime-local 值（本地时区）。 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return tomorrowNine();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 把每隔秒数拆成「数量 + 单位」。 */
function splitEvery(seconds: number): { amount: string; unit: string } {
  if (seconds > 0 && seconds % 86_400 === 0) return { amount: String(seconds / 86_400), unit: "86400" };
  if (seconds > 0 && seconds % 3_600 === 0) return { amount: String(seconds / 3_600), unit: "3600" };
  return { amount: String(Math.max(5, Math.round(seconds / 60) || 30)), unit: "60" };
}

/** 浏览器时区（Cron 段默认值；编辑器只在客户端交互后才渲染，无 SSR 差异）。 */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

export interface AutomationTemplate {
  title: string;
  prompt: string;
  kind: Kind;
  timing: AutomationTiming;
}
export interface AutomationEditorProps {
  /** 编辑时传入；新建时为 undefined。 */
  readonly automation?: Automation;
  /** 新建时的预填（模板）。 */
  readonly template?: AutomationTemplate;
  readonly tasks: readonly Task[];
  /** 新建时默认投递的任务。 */
  readonly defaultTaskId?: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (input: AutomationInput) => void;
}

/**
 * 渲染编辑器。
 * @returns 卡内编辑器。
 */
export function AutomationEditor({ automation, template, tasks, defaultTaskId = null, busy, error, onCancel, onSubmit }: AutomationEditorProps): React.ReactNode {
  const uid = React.useId();
  const initialKind: Kind = automation === undefined ? (template?.kind ?? "daily") : automation.timing_kind;
  const initialTiming: AutomationTiming = automation?.timing ?? template?.timing ?? {};
  const [title, setTitle] = React.useState(automation?.title ?? template?.title ?? "");
  const [prompt, setPrompt] = React.useState(automation?.prompt ?? template?.prompt ?? "");
  const [taskId, setTaskId] = React.useState<string>(automation?.task_id ?? defaultTaskId ?? tasks[0]?.id ?? "");
  const [kind, setKind] = React.useState<Kind>(initialKind);
  const [time, setTime] = React.useState(initialTiming.time ?? "09:00");
  const [weekdays, setWeekdays] = React.useState<number[]>(initialTiming.weekdays ?? [1]);
  const every = splitEvery(initialTiming.every_sec ?? 3_600);
  const [everyAmount, setEveryAmount] = React.useState(every.amount);
  const [everyUnit, setEveryUnit] = React.useState(every.unit);
  const [onceAt, setOnceAt] = React.useState(initialTiming.at === undefined ? tomorrowNine() : toLocalInput(initialTiming.at));
  // DX-S3 Cron：5 字段表达式 + 时区（timing {expr,tz}，与 .tmp/d5-backend-api.md §3 的
  // cron 语义一致；后端预览/创建原样收发）。
  const [cronExpr, setCronExpr] = React.useState(initialTiming.expr ?? "0 9 * * 1-5");
  const [cronTz, setCronTz] = React.useState(initialTiming.tz ?? browserTimeZone());
  const [safety, setSafety] = React.useState<"readonly" | "inherit">(automation?.safety ?? "readonly");
  const [preview, setPreview] = React.useState<{ runs: string[]; error: string | null; loading: boolean }>({ runs: [], error: null, loading: false });

  const timing = React.useMemo<AutomationTiming>(() => {
    if (kind === "daily") return { time };
    if (kind === "weekly") return { time, weekdays };
    if (kind === "every") return { every_sec: Math.round(Number(everyAmount) * Number(everyUnit)) };
    if (kind === "cron") return { expr: cronExpr.trim(), tz: cronTz.trim() };
    const at = new Date(onceAt);
    return { at: Number.isNaN(at.getTime()) ? "" : at.toISOString() };
  }, [kind, time, weekdays, everyAmount, everyUnit, onceAt, cronExpr, cronTz]);

  const localError = React.useMemo(() => {
    if (kind === "every") {
      const seconds = timing.every_sec ?? 0;
      if (!Number.isFinite(seconds) || seconds < 300) return "间隔至少 5 分钟。";
    }
    if (kind === "weekly" && weekdays.length === 0) return "至少选择一天。";
    if (kind === "once" && (timing.at === "" || Date.parse(timing.at ?? "") <= Date.now())) return "运行时间必须在未来。";
    if (kind === "cron") {
      const fields = cronExpr.trim().split(/\s+/).filter((field) => field !== "");
      if (fields.length !== 5) return "Cron 表达式需 5 个字段：分 时 日 月 周。";
      if (cronTz.trim() === "") return "时区不能为空。";
    }
    return null;
  }, [kind, timing, weekdays, cronExpr, cronTz]);

  // Server-side preview, debounced: the times shown are the scheduler's own.
  const timingKey = JSON.stringify([kind, timing]);
  React.useEffect(() => {
    if (localError !== null) {
      setPreview({ runs: [], error: null, loading: false });
      return undefined;
    }
    let alive = true;
    setPreview((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      previewAutomation(kind, timing, 3)
        .then((result) => {
          if (alive) setPreview({ runs: result.runs, error: null, loading: false });
        })
        .catch((reason: unknown) => {
          if (alive) setPreview({ runs: [], error: reason instanceof Error ? reason.message : String(reason), loading: false });
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // timingKey captures kind + timing by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timingKey, localError]);

  const taskOptions = tasks.map((task) => ({ value: task.id, label: `#${task.id} ${task.name?.trim() || task.goal?.trim() || "未命名任务"}`.slice(0, 48) }));
  const canSubmit = prompt.trim() !== "" && taskId !== "" && localError === null && !busy;

  return (
    <Editor inCard data={{ "data-automation-editor": automation?.id ?? "new" }}>
      <EditorGroup title="做什么">
        <FieldGrid>
          <Field label="名称" htmlFor={`${uid}-title`} optional hint="留空则取指令首行。">
            <TextInput
              id={`${uid}-title`}
              value={title}
              placeholder="例如：每日新增资产巡检"
              disabled={busy}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </Field>
          <Field label="投递到任务" htmlFor={`${uid}-task`} hint="作为一条消息发到该任务的主会话。">
            {taskOptions.length === 0 ? (
              <span className={css.fieldNote}>还没有任务，先新建一个会话。</span>
            ) : (
              <SelectMenu id={`${uid}-task`} value={taskId} options={taskOptions} onChange={setTaskId} disabled={busy} ariaLabel="投递到任务" />
            )}
          </Field>
          <Field label="指令" htmlFor={`${uid}-prompt`} span hint="每次到点时原样发给主 Agent。消息会标注来自自动化，不会被当作人工授权。">
            <TextArea
              id={`${uid}-prompt`}
              value={prompt}
              rows={4}
              placeholder="例如：复查任务范围内的资产是否有新开放端口或新子域，只做只读探测，汇总变化。"
              disabled={busy}
              data-automation-prompt=""
              onChange={(event) => setPrompt(event.currentTarget.value)}
            />
          </Field>
        </FieldGrid>
      </EditorGroup>

      <EditorGroup title="什么时候">
        <div className={css.timingRow}>
          <FilterBar id={`${uid}-kind`} label="运行频率" value={kind} options={KIND_OPTIONS} onChange={setKind} disabled={busy} />
          <div className={css.timingInputs}>
            {kind === "daily" || kind === "weekly" ? (
              <input
                type="time"
                className={`${kit.input} ${css.timeInput}`}
                value={time}
                aria-label="时间"
                disabled={busy}
                data-automation-time=""
                onChange={(event) => setTime(event.currentTarget.value)}
              />
            ) : null}
            {kind === "every" ? (
              <span className={css.everyRow}>
                <UnitInput unit="">
                  <input
                    type="number"
                    min={1}
                    className={`${kit.input} ${css.everyInput}`}
                    value={everyAmount}
                    aria-label="间隔数量"
                    disabled={busy}
                    onChange={(event) => setEveryAmount(event.currentTarget.value)}
                  />
                </UnitInput>
                <SelectMenu value={everyUnit} options={EVERY_UNITS} onChange={setEveryUnit} disabled={busy} ariaLabel="间隔单位" />
              </span>
            ) : null}
            {kind === "once" ? (
              <input
                type="datetime-local"
                className={`${kit.input} ${css.onceInput}`}
                value={onceAt}
                aria-label="运行时间"
                disabled={busy}
                onChange={(event) => setOnceAt(event.currentTarget.value)}
              />
            ) : null}
            {kind === "cron" ? (
              <span className={css.cronRow}>
                <input
                  type="text"
                  className={`${kit.input} ${kit.mono} ${css.cronExpr}`}
                  value={cronExpr}
                  aria-label="Cron 表达式"
                  placeholder="0 9 * * 1-5"
                  disabled={busy}
                  data-automation-cron-expr=""
                  onChange={(event) => setCronExpr(event.currentTarget.value)}
                />
                <input
                  type="text"
                  className={`${kit.input} ${css.cronTz}`}
                  value={cronTz}
                  aria-label="时区"
                  placeholder="Asia/Shanghai"
                  disabled={busy}
                  data-automation-cron-tz=""
                  onChange={(event) => setCronTz(event.currentTarget.value)}
                />
              </span>
            ) : null}
          </div>
        </div>
        {kind === "weekly" ? (
          <div className={css.weekdays} role="group" aria-label="星期">
            {WEEKDAYS.map((day) => {
              const on = weekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  className={on ? `${css.weekday} ${css.weekdayOn}` : css.weekday}
                  aria-pressed={on}
                  disabled={busy}
                  data-automation-weekday={day.value}
                  onClick={() =>
                    setWeekdays((current) => (on ? current.filter((value) => value !== day.value) : [...current, day.value]))
                  }
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {kind === "cron" ? (
          <p className={css.cronHint}>
            5 字段：分 时 日 月 周。例如 <code>0 9 * * 1-5</code> = 周一至周五 09:00（按所选时区）。「接下来」预览由调度器计算。
          </p>
        ) : null}
        <div className={css.preview} data-automation-preview={preview.runs.length}>
          {localError !== null ? (
            <span className={css.previewError}>{localError}</span>
          ) : preview.error !== null ? (
            <span className={css.previewError}>{preview.error}</span>
          ) : (
            <>
              <span className={css.previewLabel}>接下来</span>
              {preview.runs.length === 0 ? (
                <span className={css.previewTime}>{preview.loading ? "计算中…" : "—"}</span>
              ) : (
                preview.runs.map((run) => (
                  <span key={run} className={css.previewTime}>
                    {formatWhen(run)}
                  </span>
                ))
              )}
            </>
          )}
        </div>
      </EditorGroup>

      <EditorGroup title="以什么权限">
        <div className={css.safetyGrid} role="radiogroup" aria-label="安全档">
          {(
            [
              { value: "readonly", title: "只读巡检", text: "本轮以计划模式运行，扫描、写入等主动操作一律被拒绝。适合定期复查。", tag: "推荐" },
              { value: "inherit", title: "沿用任务权限", text: "按该任务当前的权限档执行，可能产生主动操作。仅用于你信任的流程。", tag: null },
            ] as const
          ).map((option) => {
            const on = safety === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? `${css.safetyCard} ${css.safetyCardOn}` : css.safetyCard}
                disabled={busy}
                data-automation-safety={option.value}
                onClick={() => setSafety(option.value)}
              >
                <span className={css.safetyHead}>
                  <span className={css.radio} aria-hidden="true" />
                  {option.title}
                  {option.tag === null ? null : <span className={css.safetyTag}>{option.tag}</span>}
                </span>
                <span className={css.safetyText}>{option.text}</span>
              </button>
            );
          })}
        </div>
      </EditorGroup>

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <EditorActions>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!canSubmit}
          data-automation-save=""
          onClick={() =>
            onSubmit({
              title: title.trim() === "" ? undefined : title.trim(),
              prompt: prompt.trim(),
              target_kind: "task",
              task_id: taskId,
              timing_kind: kind,
              timing,
              safety,
            })
          }
        >
          {busy ? "保存中…" : automation === undefined ? "创建自动化" : "保存"}
        </Button>
      </EditorActions>
    </Editor>
  );
}
