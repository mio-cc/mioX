"use client";

/**
 * 新建任务弹窗（对照表 P1:A6–A11）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/new/page.tsx:420-534（模型/分类/目录/覆盖度/创建即跑）。
 * 建任务用 v2/data/task-actions.ts 的 createTask（转发 api.createTask 全部字段，api.ts:281-310）；
 * 分类读 api.taskCategories（:324），目录浏览读 api.fsDirs（:361），任务级模型在创建后再绑一次（:348）。
 *
 * C11 P1:A28：本文件加了「任务模板」选择行——模板来自 `GET /task-templates`（经
 * `v2/data/task-categories.ts` 的 `useTaskTemplates`，api.ts:339），选中后把模板的描述 / 目标 /
 * 预设分类复制进表单（旧页 `components/task-template-controls.tsx:400-420`、`:504-524` 的覆盖确认）。
 * 模板的任务级拦截规则（`intercept_rules`）不在本弹窗编辑，也不随模板应用：本弹窗没有规则编辑器，
 * `createTask` 的 `interceptRules` 目前恒为空——缺口写在 `.tmp/parity-overlay-c11.json`。
 */
import * as React from "react";

import { toast } from "@/components/v2/settings/Toast";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { bindTaskProfiles, useTaskCategories } from "@/v2/data/task-create";
import { useTaskTemplates } from "@/v2/data/task-categories";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import { createTask } from "@/v2/data/task-actions";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import css from "./NewTaskDialog.module.css";
import { DirPicker } from "./DirPicker";

/** 「不指定生效模型」的选项值。 */
const NO_ACTIVE = "none";

/**
 * 渲染新建任务弹窗。
 * @param props.open - 是否显示。
 * @param props.onClose - 取消。
 * @param props.onCreated - 创建成功后收到新任务 id。
 * @param props.pickDirOnOpen - 打开时直接弹出目录选择器（「从目录新建」入口用）。
 * @returns 弹窗，或关闭时为 null。
 */
export function NewTaskDialog({
  open,
  onClose,
  onCreated,
  pickDirOnOpen = false,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  pickDirOnOpen?: boolean;
}): React.ReactNode {
  const [description, setDescription] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("none");
  const [profileIds, setProfileIds] = React.useState<number[]>([]);
  const [activeProfileId, setActiveProfileId] = React.useState(NO_ACTIVE);
  const [workDir, setWorkDir] = React.useState("");
  const [coverageEnabled, setCoverageEnabled] = React.useState(true);
  const [startImmediately, setStartImmediately] = React.useState(true);
  const [dirOpen, setDirOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** C11 P1:A28：选中的模板 id（`null` = 不用模板）；应用后可以清空，回到手填。 */
  const [templateId, setTemplateId] = React.useState<string>("none");
  /** 已有描述或目标时选模板要先确认覆盖（旧页 task-template-controls.tsx:504-524 同口径）。 */
  const [pendingTemplate, setPendingTemplate] = React.useState<number | null>(null);

  const profiles = useLlmProfiles();
  const categories = useTaskCategories();
  const templates = useTaskTemplates();

  React.useEffect(() => {
    if (!open) return;
    setDescription("");
    setGoal("");
    setCategoryId("none");
    setProfileIds([]);
    setActiveProfileId(NO_ACTIVE);
    setWorkDir("");
    setCoverageEnabled(true);
    setStartImmediately(true);
    setDirOpen(pickDirOnOpen);
    setError(null);
    setBusy(false);
    setTemplateId("none");
    setPendingTemplate(null);
  }, [open, pickDirOnOpen]);

  if (!open) return null;

  const categoryOptions = [
    { value: "none", label: "未分类" },
    ...categories.categories.map((item) => ({ value: String(item.id), label: item.name })),
  ];
  const templateOptions = [
    { value: "none", label: templates.templates.length === 0 ? "暂无任务模板" : "不使用模板" },
    ...templates.templates.map((item) => ({ value: String(item.id), label: item.name })),
  ];

  // 应用模板 = 把模板的描述 / 目标 / 预设分类复制进表单（复制语义，不与模板保持关联）。
  const applyTemplate = (id: number): void => {
    const template = templates.templates.find((item) => item.id === id);
    if (template === undefined) {
      setError("模板已不存在，请刷新后重试");
      return;
    }
    setDescription(template.description);
    setGoal(template.goal);
    setCategoryId(template.category_id === undefined || template.category_id === null ? "none" : String(template.category_id));
    setTemplateId(String(template.id));
    setPendingTemplate(null);
  };

  const chooseTemplate = (value: string): void => {
    if (value === "none") {
      setTemplateId("none");
      return;
    }
    const id = Number(value);
    if (Number.isNaN(id)) return;
    // 已经填了描述或目标，且与模板内容不同 → 先确认覆盖（不在不提示的情况下冲掉用户输入）。
    const template = templates.templates.find((item) => item.id === id);
    const hasContent = description.trim() !== "" || goal.trim() !== "";
    if (template !== undefined && hasContent && (description !== template.description || goal !== template.goal)) {
      setPendingTemplate(id);
      return;
    }
    applyTemplate(id);
  };
  const checkedProfiles = profiles.profiles.filter((item) => profileIds.includes(Number(item.id)));
  const activeOptions = [
    { value: NO_ACTIVE, label: "不指定" },
    ...checkedProfiles.map((item) => ({ value: item.id, label: item.name })),
  ];

  const toggleProfile = (rawId: string): void => {
    const id = Number(rawId);
    if (Number.isNaN(id)) return;
    setProfileIds((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      // 取消勾选后若它正是「生效」模型，回落到不指定。
      setActiveProfileId((active) => (active !== NO_ACTIVE && !next.includes(Number(active)) ? NO_ACTIVE : active));
      return next;
    });
  };

  const submit = (): void => {
    if (description.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    const activeId = activeProfileId === NO_ACTIVE ? undefined : Number(activeProfileId);
    createTask({
      description: description.trim(),
      goal: goal.trim() === "" ? description.trim() : goal.trim(),
      categoryId: categoryId === "none" ? undefined : Number(categoryId),
      llmProfileIds: profileIds.length > 0 ? profileIds : undefined,
      workDir: workDir === "" ? undefined : workDir,
      coverageEnabled,
      seedFirstIntent: startImmediately,
    })
      .then(async (task) => {
        if (activeId !== undefined) {
          try {
            await bindTaskProfiles(task.id, profileIds, activeId);
          } catch (reason: unknown) {
            // 任务已经建好了：失败只提示，不撤销创建。
            toast(`任务已创建，但生效模型设置失败：${reason instanceof Error ? reason.message : String(reason)}`);
          }
        }
        onCreated(task.id);
        onClose();
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="新会话" closeLabel="关闭">
        <div className={css.form}>
          <div className={css.inlineRow}>
            <span className={css.label}>任务模板</span>
            <SelectMenu
              ariaLabel="任务模板"
              value={templateId}
              options={templateOptions}
              disabled={templates.phase !== "ready" || templates.templates.length === 0}
              onChange={chooseTemplate}
            />
            {templates.phase === "loading" ? <span className={css.hint}>读取模板…</span> : null}
            {templates.phase === "offline" ? <span className={css.hint}>模板读取失败：{templates.error}</span> : null}
          </div>

          <label className={css.field}>
            <span className={css.label}>描述</span>
            <textarea
              className={css.textarea}
              rows={3}
              autoFocus
              value={description}
              placeholder="你想让 agent 做什么"
              data-newtask-description=""
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
          </label>

          <label className={css.field}>
            <span className={css.label}>目标（可选）</span>
            <input
              className={css.input}
              value={goal}
              placeholder="留空则用描述"
              data-newtask-goal=""
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>

          <div className={css.field}>
            <span className={css.label}>模型（可多选，留空用全局默认）</span>
            {profiles.phase === "loading" ? <span className={css.hint}>加载模型配置…</span> : null}
            {profiles.phase === "offline" ? <span className={css.hint}>模型配置读取失败，创建时使用默认配置。</span> : null}
            {profiles.phase === "ready" && profiles.profiles.length === 0 ? (
              <span className={css.hint}>还没有配置模型。</span>
            ) : null}
            {profiles.phase === "ready" && profiles.profiles.length > 0 ? (
              <div className={css.checkList} data-newtask-profiles="">
                {profiles.profiles.map((item) => (
                  <label key={item.id} className={css.checkRow}>
                    <input
                      type="checkbox"
                      checked={profileIds.includes(Number(item.id))}
                      data-newtask-profile={item.id}
                      onChange={() => toggleProfile(item.id)}
                    />
                    <span className={css.checkText}>
                      {item.name}
                      <span className={css.checkSub}> · {item.model}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {checkedProfiles.length > 1 ? (
              <div className={css.inlineRow}>
                <span className={css.label}>生效模型</span>
                <SelectMenu
                  ariaLabel="任务生效模型"
                  value={activeProfileId}
                  options={activeOptions}
                  onChange={setActiveProfileId}
                />
              </div>
            ) : null}
          </div>

          <div className={css.inlineRow}>
            <span className={css.label}>分类</span>
            <SelectMenu
              ariaLabel="任务分类"
              value={categoryId}
              options={categoryOptions}
              onChange={setCategoryId}
            />
          </div>

          <div className={css.inlineRow}>
            <span className={css.label}>工作目录</span>
            <input
              className={css.input}
              value={workDir}
              readOnly
              placeholder="默认：任务自己的目录"
              aria-label="工作目录"
              data-newtask-workdir=""
            />
            <Button variant="outline" size="sm" data-newtask-workdir-pick="" onClick={() => setDirOpen(true)}>
              选择…
            </Button>
            {workDir === "" ? null : (
              <Button variant="outline" size="sm" data-newtask-workdir-clear="" onClick={() => setWorkDir("")}>
                清除
              </Button>
            )}
          </div>

          <div className={css.inlineRow}>
            <Switch
              checked={coverageEnabled}
              onChange={setCoverageEnabled}
              label="覆盖度：开启后自动累积测试范围并统计未覆盖资产"
            />
            <span className={css.label}>覆盖度</span>
          </div>

          <div className={css.inlineRow}>
            <Switch
              checked={startImmediately}
              onChange={setStartImmediately}
              label="创建后立即开始：下发第一条意图并开跑"
            />
            <span className={css.label}>创建后立即开始</span>
          </div>

          {error === null ? null : (
            <p className={css.error} role="alert">
              {error}
            </p>
          )}

          <div className={css.actions}>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={description.trim() === "" || busy}
              data-newtask-submit=""
            >
              {busy ? "创建中…" : startImmediately ? "创建并开跑" : "仅创建"}
            </Button>
          </div>
        </div>
      </Modal>

      <DirPicker
        open={dirOpen}
        initial={workDir}
        onClose={() => setDirOpen(false)}
        onPick={setWorkDir}
      />

      <Modal
        open={pendingTemplate !== null}
        onClose={() => setPendingTemplate(null)}
        closeLabel="关闭"
        title="用模板覆盖当前内容？"
        description="当前已填写的描述、目标和分类会被所选模板的内容替换。"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingTemplate(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingTemplate !== null) applyTemplate(pendingTemplate);
              }}
            >
              覆盖并使用
            </Button>
          </>
        }
      >
        <div className={css.hint}>
          要使用的模板：
          {templates.templates.find((item) => item.id === pendingTemplate)?.name ?? "—"}
        </div>
      </Modal>
    </>
  );
}
