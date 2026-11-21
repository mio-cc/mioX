"use client";

/**
 * 任务级模型视图（会话视图 tab「模型」，对照表 P1:B16、B17、B30）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/legacy-detail.tsx（绑定与解析）、
 * task-workspace-dsh.tsx:3393（累计 token）。
 * DSH 依据：DSH 无任务级模型页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 *
 * D2 版式：PageHead → 「当前生效」三角色卡（行：角色 tile + 模型名 + 来源，右侧状态点）→
 * 「模型绑定」卡（每个配置一行：序号锚 + 名称/模型 + 开关；底部生效模型选择行）→
 * 「Token 用量」指标格 + 按模型明细表。数据与写入行为不变。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { Task } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import {
  Badge,
  Card,
  Dot,
  Empty,
  IconButton,
  kit,
  Meta,
  Metrics,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconLayersOutlineRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import { bindTaskProfiles } from "@/v2/data/task-create";
import { resolutionSourceLabel, useTaskLlmResolution, useTaskTokens } from "@/v2/data/task-llm";

import css from "./TaskModelView.module.css";

/** 三个角色在界面上的顺序与标题。 */
const ROLES = [
  { key: "mainagent", label: "主 Agent", glyph: "主" },
  { key: "planner", label: "Planner", glyph: "P" },
  { key: "worker", label: "Worker", glyph: "W" },
] as const;

/** 「不指定生效模型」的选项值。 */
const NO_ACTIVE = "none";

/**
 * 数字加千分位。
 * @param value - 原始数值。
 * @returns 千分位文本。
 */
function num(value: number): string {
  return value.toLocaleString("zh-CN");
}

/**
 * 失败切换状态的人话（types.ts:36 的三个已知值；未知值原样显示）。
 * @param state - 后端 llm_failover_state。
 * @returns 展示文案。
 */
function failoverLabel(state: string): string {
  if (state === "default") return "未触发，按默认模型运行";
  if (state === "ready") return "已就绪，失败时按绑定顺序切换";
  if (state === "chain_exhausted") return "绑定链已用尽";
  return state;
}

/**
 * 失败切换状态的语气：只有用尽才是警告。
 * @param state - 后端 llm_failover_state。
 * @returns Notice 色调。
 */
function failoverTone(state: string): "neutral" | "danger" {
  return state === "chain_exhausted" ? "danger" : "neutral";
}

/**
 * 大数缩写（指标格用）：12,345 → 12.3K，1,234,567 → 1.23M。
 * @param value - 原始数值。
 * @returns 缩写文本。
 */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return num(value);
}

/**
 * 渲染任务级模型视图。
 * @param props.task - 当前选中的任务。
 * @returns 模型视图。
 */
export function TaskModelView({ task, embedded = false }: { task: Task; embedded?: boolean }): ReactNode {
  const resolution = useTaskLlmResolution(task.id);
  const tokens = useTaskTokens(task.id);
  const profiles = useLlmProfiles();

  const [selected, setSelected] = useState<number[]>(task.llm_profile_ids ?? []);
  const [active, setActive] = useState<string>(
    task.active_llm_profile_id === undefined ? NO_ACTIVE : String(task.active_llm_profile_id),
  );
  const [saving, setSaving] = useState(false);

  // 换任务时用该任务自己的绑定重建表单，避免把上一个任务的选择带过来。
  useEffect(() => {
    setSelected(task.llm_profile_ids ?? []);
    setActive(task.active_llm_profile_id === undefined ? NO_ACTIVE : String(task.active_llm_profile_id));
  }, [task.id, task.llm_profile_ids, task.active_llm_profile_id]);

  const activeOptions = useMemo(
    () => [
      { value: NO_ACTIVE, label: "不指定（按绑定顺序）" },
      ...profiles.profiles
        .filter((item) => selected.includes(Number(item.id)))
        .map((item) => ({ value: item.id, label: item.name })),
    ],
    [profiles.profiles, selected],
  );

  const savedIds = task.llm_profile_ids ?? [];
  const savedActive = task.active_llm_profile_id === undefined ? NO_ACTIVE : String(task.active_llm_profile_id);
  const dirty =
    savedActive !== active ||
    savedIds.length !== selected.length ||
    savedIds.some((id, index) => selected[index] !== id);

  const toggle = (rawId: string): void => {
    const id = Number(rawId);
    if (Number.isNaN(id)) return;
    setSelected((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      setActive((current2) => (current2 !== NO_ACTIVE && !next.includes(Number(current2)) ? NO_ACTIVE : current2));
      return next;
    });
  };

  const save = (): void => {
    if (saving) return;
    setSaving(true);
    const activeId = active === NO_ACTIVE ? undefined : Number(active);
    bindTaskProfiles(task.id, selected, activeId)
      .then(() => {
        setSaving(false);
        toast("任务模型绑定已保存");
        resolution.reload();
      })
      .catch((reason: unknown) => {
        setSaving(false);
        toast(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const refreshAll = (): void => {
    resolution.reload();
    tokens.reload();
  };

  const total = tokens.phase === "ready" ? tokens.total : null;
  // input_tokens already includes cache reads (norma llm/anthropic.go:324-334, OpenAI
  // prompt_tokens), so the hit rate is cacheRead / input — not over input + cacheRead.
  const cacheRate =
    total === null || total.input_tokens === 0
      ? null
      : Math.min(total.cache_read_tokens, total.input_tokens) / total.input_tokens;

  const refreshButton = (
    <IconButton
      label="刷新"
      spinning={resolution.phase === "loading" || tokens.phase === "loading"}
      onClick={refreshAll}
    >
      <IconRefreshOutlineRegular size={14} />
    </IconButton>
  );

  // U2：嵌在「概览 ▸ 配置」里时只出三个 Section（外层 Page 由概览提供）。
  const sections = (
    <>
      <Section
        title="当前生效"
        data={{ "data-task-model-resolution": "" }}
        actions={embedded ? refreshButton : undefined}
      >
        <Card>
          {resolution.phase === "loading" && resolution.resolution === null ? <Skeleton label="读取生效模型" /> : null}
          {resolution.phase === "offline" ? (
            <div className={css.cardNotice}>
              <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={resolution.reload}>重试</Button>}>
                读取失败：{resolution.error}
              </Notice>
            </div>
          ) : null}
          {resolution.resolution !== null
            ? ROLES.map((role) => {
                const row = resolution.resolution?.[role.key];
                if (row === undefined) return null;
                const model = row.name === "" ? row.model : row.name;
                return (
                  <Row
                    key={role.key}
                    data={{ "data-role": role.key }}
                    lead={<span className={css.roleGlyph}>{role.glyph}</span>}
                    label={role.label}
                    description={
                      <Meta
                        items={[
                          <span key="m" className={kit.mono} title={row.model}>
                            {model}
                          </span>,
                          resolutionSourceLabel(row.source),
                          row.reason === undefined || row.reason === "" ? null : (
                            <span key="r" className={css.reason}>
                              {row.reason}
                            </span>
                          ),
                        ]}
                      />
                    }
                  >
                    <span className={css.status}>
                      <Dot tone={row.available ? "success" : "warning"} />
                      {row.available ? "可用" : "不可用"}
                    </span>
                  </Row>
                );
              })
            : null}
        </Card>
      </Section>

      <Section
        title="模型绑定"
        hint="按顺序做失败切换"
        data={{ "data-task-model-bindings": "" }}
        actions={
          <Button variant="primary" size="sm" disabled={saving || !dirty} data-task-model-save="" onClick={save}>
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        <Card>
          {profiles.phase === "loading" ? <Skeleton label="加载模型配置" /> : null}
          {profiles.phase === "offline" ? (
            <div className={css.cardNotice}>
              <Notice tone="danger">模型配置读取失败。</Notice>
            </div>
          ) : null}
          {profiles.phase === "ready" && profiles.profiles.length === 0 ? (
            <Empty
              inCard
              icon={<IconLayersOutlineRegular size={18} />}
              title="还没有配置模型"
              text="先在 设置 → 模型 里添加模型提供商，再回来绑定。"
            />
          ) : null}
          {profiles.phase === "ready" && profiles.profiles.length > 0 ? (
            <>
              {profiles.profiles.map((item) => {
                const order = selected.indexOf(Number(item.id));
                const on = order >= 0;
                return (
                  <Row
                    key={item.id}
                    data={{ "data-task-model-profile-row": item.id }}
                    lead={
                      <span className={on ? `${css.order} ${css.orderOn}` : css.order} aria-hidden="true">
                        {on ? order + 1 : "–"}
                      </span>
                    }
                    label={item.name}
                    labelAdornment={
                      String(item.id) === active ? <Badge tone="info">生效</Badge> : null
                    }
                    description={<span className={kit.mono}>{item.model}</span>}
                  >
                    <span className={css.switchSeat} data-task-model-profile={item.id} data-on={on ? "true" : "false"}>
                      <Switch checked={on} label={`绑定 ${item.name}`} onChange={() => toggle(item.id)} />
                    </span>
                  </Row>
                );
              })}
              <Row label="生效模型" description="只能从已绑定的模型里选；不指定时按绑定顺序。" wideControl>
                <SelectMenu ariaLabel="任务生效模型" value={active} options={activeOptions} onChange={setActive} />
              </Row>
            </>
          ) : null}
        </Card>
        {task.llm_failover_state !== undefined && task.llm_failover_state !== "" ? (
          <Notice
            tone={failoverTone(task.llm_failover_state)}
            data={{ "data-task-model-failover": task.llm_failover_state }}
          >
            失败切换：{failoverLabel(task.llm_failover_state)}
            {task.llm_failover_reason === undefined || task.llm_failover_reason === "" ? "" : `（${task.llm_failover_reason}）`}
          </Notice>
        ) : null}
      </Section>

      <Section title="Token 用量" data={{ "data-task-model-tokens": "" }}>
        {tokens.phase === "loading" && total === null ? (
          <Card>
            <Skeleton label="读取用量" />
          </Card>
        ) : null}
        {tokens.phase === "offline" ? (
          <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={tokens.reload}>重试</Button>}>
            读取失败：{tokens.error}
          </Notice>
        ) : null}
        {total !== null ? (
          <Metrics
            items={[
              { key: "in", label: "输入", value: compact(total.input_tokens), foot: num(total.input_tokens) },
              { key: "out", label: "输出", value: compact(total.output_tokens), foot: num(total.output_tokens) },
              {
                key: "cr",
                label: "缓存读",
                value: compact(total.cache_read_tokens),
                foot: cacheRate === null ? "—" : `命中 ${(cacheRate * 100).toFixed(0)}%`,
                muted: total.cache_read_tokens === 0,
              },
              {
                key: "cw",
                label: "缓存写",
                value: compact(total.cache_write_tokens),
                foot: num(total.cache_write_tokens),
                muted: total.cache_write_tokens === 0,
              },
            ]}
          />
        ) : null}
        {tokens.phase === "ready" && tokens.byModel.length === 0 ? (
          <Card>
            <Empty inCard title="还没有调用记录" text="任务调用模型后，这里按模型列出调用次数与 token。" />
          </Card>
        ) : null}
        {tokens.phase === "ready" && tokens.byModel.length > 0 ? (
          <Card>
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>调用</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>缓存读</th>
                    <th>缓存写</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.byModel.map((row) => (
                    <tr key={row.model}>
                      <td className={kit.mono} title={row.model}>
                        {row.model}
                      </td>
                      <td>{num(row.calls)}</td>
                      <td>{num(row.input_tokens)}</td>
                      <td>{num(row.output_tokens)}</td>
                      <td>{num(row.cache_read_tokens)}</td>
                      <td>{num(row.cache_write_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </Section>
    </>
  );

  if (embedded) return <div data-task-model="" className={css.embedded}>{sections}</div>;
  return (
    <Page data={{ "data-task-model": "" }}>
      <PageHead
        title="模型"
        lead="本任务三个角色当前解析到的模型、任务级绑定与失败切换顺序，以及累计 token 用量。"
        actions={refreshButton}
      />
      {sections}
    </Page>
  );
}
