"use client";

/**
 * 任务级模型视图（会话视图 tab「模型」，对照表 P1:B16、B17、B30）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/legacy-detail.tsx（绑定与解析）、
 * task-workspace-dsh.tsx:3393（累计 token）。
 * DSH 依据：DSH 无任务级模型页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { Task } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import { bindTaskProfiles } from "@/v2/data/task-create";
import { resolutionSourceLabel, useTaskLlmResolution, useTaskTokens } from "@/v2/data/task-llm";

import css from "./TaskModelView.module.css";

/** 三个角色在界面上的顺序与标题。 */
const ROLES = [
  { key: "mainagent", label: "主 Agent" },
  { key: "planner", label: "Planner" },
  { key: "worker", label: "Worker" },
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
 * 渲染任务级模型视图。
 * @param props.task - 当前选中的任务。
 * @returns 模型视图。
 */
export function TaskModelView({ task }: { task: Task }): ReactNode {
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

  return (
    <div className={css.wrap} data-task-model="">
      <section className={css.section} data-task-model-resolution="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>当前生效</span>
          <Button variant="outline" size="sm" onClick={resolution.reload}>
            刷新
          </Button>
        </div>
        {resolution.phase === "loading" ? <div className={css.state}>读取生效模型…</div> : null}
        {resolution.phase === "offline" ? (
          <div className={css.stateError} role="alert">
            读取失败：{resolution.error}
          </div>
        ) : null}
        {resolution.phase === "ready" && resolution.resolution !== null ? (
          <div className={css.roles}>
            {ROLES.map((role) => {
              const row = resolution.resolution?.[role.key];
              if (row === undefined) return null;
              return (
                <div key={role.key} className={css.roleRow} data-role={role.key}>
                  <span className={css.roleName}>{role.label}</span>
                  <span className={css.roleModel} title={row.model}>
                    {row.name === "" ? row.model : row.name}
                  </span>
                  <Tag tone={row.available ? "success" : "warning"}>{row.available ? "可用" : "不可用"}</Tag>
                  <span className={css.roleSource}>{resolutionSourceLabel(row.source)}</span>
                  {row.reason === undefined || row.reason === "" ? null : (
                    <span className={css.roleReason}>{row.reason}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className={css.section} data-task-model-bindings="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>绑定的模型（按顺序做失败切换）</span>
          <Button variant="primary" size="sm" disabled={saving} data-task-model-save="" onClick={save}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
        {profiles.phase === "loading" ? <div className={css.state}>加载模型配置…</div> : null}
        {profiles.phase === "offline" ? <div className={css.stateError}>模型配置读取失败。</div> : null}
        {profiles.phase === "ready" && profiles.profiles.length === 0 ? (
          <p className={css.empty}>还没有配置模型。先在设置里添加模型提供商。</p>
        ) : null}
        {profiles.phase === "ready" && profiles.profiles.length > 0 ? (
          <>
            <div className={css.checkList}>
              {profiles.profiles.map((item) => (
                <label key={item.id} className={css.checkRow}>
                  <input
                    type="checkbox"
                    checked={selected.includes(Number(item.id))}
                    data-task-model-profile={item.id}
                    onChange={() => toggle(item.id)}
                  />
                  <span className={css.checkText}>
                    {item.name}
                    <span className={css.checkSub}> · {item.model}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className={css.inlineRow}>
              <span className={css.fieldLabel}>生效模型</span>
              <SelectMenu ariaLabel="任务生效模型" value={active} options={activeOptions} onChange={setActive} />
              <span className={css.hint}>只能从已勾选的模型里选。</span>
            </div>
          </>
        ) : null}
        {task.llm_failover_state !== undefined && task.llm_failover_state !== "" ? (
          <p className={css.hint} data-task-model-failover={task.llm_failover_state}>
            失败切换状态：{task.llm_failover_state}
            {task.llm_failover_reason === undefined || task.llm_failover_reason === "" ? "" : `（${task.llm_failover_reason}）`}
          </p>
        ) : null}
      </section>

      <section className={css.section} data-task-model-tokens="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>token 用量</span>
          <Button variant="outline" size="sm" onClick={tokens.reload}>
            刷新
          </Button>
        </div>
        {tokens.phase === "loading" ? <div className={css.state}>读取用量…</div> : null}
        {tokens.phase === "offline" ? (
          <div className={css.stateError} role="alert">
            读取失败：{tokens.error}
          </div>
        ) : null}
        {tokens.phase === "ready" && tokens.total !== null ? (
          <div className={css.tokenTotal}>
            <span>输入 {num(tokens.total.input_tokens)}</span>
            <span>输出 {num(tokens.total.output_tokens)}</span>
            <span>缓存读 {num(tokens.total.cache_read_tokens)}</span>
            <span>缓存写 {num(tokens.total.cache_write_tokens)}</span>
          </div>
        ) : null}
        {tokens.phase === "ready" && tokens.byModel.length === 0 ? (
          <p className={css.empty}>还没有按模型的调用记录。</p>
        ) : null}
        {tokens.phase === "ready" && tokens.byModel.length > 0 ? (
          <table className={css.table}>
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
                  <td className={css.modelCell}>{row.model}</td>
                  <td>{num(row.calls)}</td>
                  <td>{num(row.input_tokens)}</td>
                  <td>{num(row.output_tokens)}</td>
                  <td>{num(row.cache_read_tokens)}</td>
                  <td>{num(row.cache_write_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
