"use client";

/**
 * First-run task surface: one purposeful draft, a light context row, and
 * progressively disclosed task settings. Creation stays on the real v2 adapters.
 */
import * as React from "react";

import { ModelPicker } from "@/components/v2/composer/ModelPicker";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import { bindTaskProfiles, useTaskCategories } from "@/v2/data/task-create";
import { createTask, setTaskPlanMode } from "@/v2/data/task-actions";
import { setTaskTeamMode } from "@/v2/data/task-mode";
import { useTaskTemplates } from "@/v2/data/task-categories";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import { profilesToOptions } from "@/v2/data/llm-map";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconChevronsUpDownOutlineRegular,
  IconCloseOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconSlidersTwoOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { DirPicker } from "./DirPicker";
import { MioxMark } from "./MioxMark";
import css from "./NewTaskPage.module.css";

const DEFAULT_DIR = "默认工作区";
const MODES = [
  { value: "standard", label: "标准模式", hint: "规划与执行均由 Agent 自主推进" },
  { value: "plan", label: "规划模式", hint: "先探索与规划，批准后再执行" },
  { value: "team", label: "团队协作", hint: "提供共享任务板，协调多个执行角色" },
] as const;

export interface NewTaskPageProps {
  /** Empty string opens the directory picker on entering this surface. */
  readonly initialWorkDir?: string;
  readonly pickDirOnOpen?: boolean;
  readonly onCancel: () => void;
  readonly onCreated: (id: string) => void;
}

function ArrowUp({ size = 18 }: { size?: number }): React.ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 15.5v-11M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Full-page new-session entry, deliberately not a second modal administration form. */
export function NewTaskPage({ initialWorkDir = DEFAULT_DIR, pickDirOnOpen = false, onCancel, onCreated }: NewTaskPageProps): React.ReactNode {
  const [description, setDescription] = React.useState("");
  const [workDir, setWorkDir] = React.useState(initialWorkDir);
  const [rawDirReference, setRawDirReference] = React.useState(initialWorkDir !== DEFAULT_DIR);
  const [dirOpen, setDirOpen] = React.useState(pickDirOnOpen);
  const [mode, setMode] = React.useState("standard");
  const [advanced, setAdvanced] = React.useState(false);
  const [goal, setGoal] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("none");
  const [profileIds, setProfileIds] = React.useState<number[]>([]);
  const [activeProfileId, setActiveProfileId] = React.useState("none");
  const [coverageEnabled, setCoverageEnabled] = React.useState(true);
  const [startImmediately, setStartImmediately] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = React.useState<number | null>(null);
  const editorRef = React.useRef<HTMLTextAreaElement>(null);

  const profiles = useLlmProfiles();
  const models = React.useMemo(() => profilesToOptions(profiles.profiles), [profiles.profiles]);
  const categories = useTaskCategories();
  const templates = useTaskTemplates();
  const appliedTemplate = React.useRef("");
  const readyProfiles = profiles.profiles;
  const checkedProfiles = readyProfiles.filter((item) => profileIds.includes(Number(item.id)));
  const activeOptions = [
    { value: "none", label: "跟随全局默认" },
    ...checkedProfiles.map((item) => ({ value: item.id, label: item.name })),
  ];
  const categoryOptions = [
    { value: "none", label: "不分类" },
    ...categories.categories.map((item) => ({ value: String(item.id), label: item.name })),
  ];
  const templateOptions = [
    { value: "none", label: "选择任务模板（可选）" },
    ...templates.templates.map((item) => ({ value: String(item.id), label: item.name })),
  ];

  React.useEffect(() => {
    if (pickDirOnOpen) return;
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [pickDirOnOpen]);

  const templateSource = pendingTemplate === null ? undefined : templates.templates.find((item) => item.id === pendingTemplate);
  const applyTemplate = (): void => {
    if (templateSource === undefined) return;
    setDescription(templateSource.description);
    setGoal(templateSource.goal);
    setCategoryId(templateSource.category_id === undefined || templateSource.category_id === null ? "none" : String(templateSource.category_id));
    appliedTemplate.current = String(templateSource.id);
    setPendingTemplate(null);
  };
  const chooseTemplate = (value: string): void => {
    if (value === "none") {
      appliedTemplate.current = "";
      return;
    }
    const template = templates.templates.find((item) => String(item.id) === value);
    if (template === undefined) return;
    const hasContent = description.trim() !== "" || goal.trim() !== "";
    if (hasContent && (description !== template.description || goal !== template.goal)) {
      setPendingTemplate(template.id);
      return;
    }
    setDescription(template.description);
    setGoal(template.goal);
    setCategoryId(template.category_id === undefined || template.category_id === null ? "none" : String(template.category_id));
    appliedTemplate.current = value;
  };
  const toggleProfile = (id: string, checked: boolean): void => {
    setProfileIds((current) => {
      const numeric = Number(id);
      const next = checked ? [...current, numeric] : current.filter((value) => value !== numeric);
      setActiveProfileId((active) => (active === id && !checked ? "none" : active));
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    const text = description.trim();
    if (text === "" || busy) return;
    setBusy(true);
    setError(null);
    let createdTaskId: string | null = null;
    try {
      const task = await createTask({
        description: text,
        goal: goal.trim() === "" ? text : goal.trim(),
        categoryId: categoryId === "none" ? undefined : Number(categoryId),
        llmProfileIds: profileIds.length > 0 ? profileIds : undefined,
        workDir: rawDirReference && workDir.trim() !== "" ? workDir.trim() : undefined,
        coverageEnabled,
        seedFirstIntent: startImmediately,
      });
      createdTaskId = task.id;
      // Task creation is a write. Preserve existing server-side defaults until
      // the user deliberately chooses a different execution mode in this page.
      if (mode !== "standard") {
        await (mode === "plan" ? setTaskPlanMode(task.id, true) : setTaskTeamMode(task.id, true));
      }
      if (activeProfileId !== "none") {
        try {
          await bindTaskProfiles(task.id, profileIds, Number(activeProfileId));
        } catch (reason: unknown) {
          toast(`任务已创建，但生效模型设置失败：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }
      onCreated(task.id);
    } catch (reason: unknown) {
      const reasonText = reason instanceof Error ? reason.message : String(reason);
      setError(createdTaskId === null ? `创建未完成：${reasonText}` : `任务 #${createdTaskId} 已创建，但模式设置未完成。请在任务页检查后重试该模式：${reasonText}`);
      setBusy(false);
    }
  };
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  return (
    <section className={css.stage} data-new-session-page="" aria-label="新会话启动">
      <header className={css.topbar}>
        <span className={css.topTitle}>新会话</span>
        <Button size="sm" aria-label="关闭新会话" title="关闭" icon={<IconCloseOutlineRegular size={14} />} disabled={busy} onClick={onCancel} />
      </header>

      <div className={css.content}>
        <div className={css.mark} aria-hidden="true"><MioxMark size={34} /></div>
        <h1>从一个目标开始</h1>
        <p className={css.lead}>描述你想完成的事，mioX 将组织 Agent 探索、执行并给出结果。</p>

        <div className={css.contextRow}>
          <button type="button" className={css.context} title={rawDirReference ? workDir : DEFAULT_DIR} aria-label="选择工作目录" onClick={() => setDirOpen(true)}>
            <IconFolderOpenOutlineRegular size={16} />
            <span>{rawDirReference ? workDir.split(/[\\/]/).filter(Boolean).at(-1) || workDir : DEFAULT_DIR}</span>
            <IconChevronsUpDownOutlineRegular size={11} />
          </button>
          <SelectMenu ariaLabel="任务模式" value={mode} options={MODES.map(({ value, label }) => ({ value, label }))} onChange={setMode} />
        </div>
        <p className={css.modeHint}>{MODES.find((item) => item.value === mode)?.hint}</p>

        <div className={`${css.composer} ${advanced ? css.composerAdvanced : ""}`} data-new-session-composer="">
          <textarea
            ref={editorRef}
            className={css.editor}
            value={description}
            rows={3}
            disabled={busy}
            placeholder="告诉 Agent，你想完成什么…"
            aria-label="任务目标"
            data-newtask-description=""
            onChange={(event) => { setDescription(event.target.value); setError(null); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitRef.current();
              }
            }}
          />
          <div className={css.composerFooter}>
            <div className={css.secondaryActions}>
              <Button size="sm" variant={advanced ? "toolbar" : "ghost"} icon={<IconSlidersTwoOutlineRegular size={14} />} aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
                更多选项
              </Button>
              {!startImmediately ? <span className={css.startHint}>仅创建，不自动运行</span> : null}
            </div>
            <div className={css.modelSeat}><ModelPicker models={models} phase={profiles.phase} /></div>
            <button
              type="button"
              className={css.submit}
              disabled={description.trim() === "" || busy}
              aria-label={busy ? "正在创建会话" : startImmediately ? "创建并开跑" : "创建会话"}
              title={busy ? "正在创建…" : startImmediately ? "创建并开跑 · Ctrl/⌘ Enter" : "创建会话 · Ctrl/⌘ Enter"}
              data-newtask-submit=""
              data-newtask-start={startImmediately ? "true" : "false"}
              onClick={() => { void submit(); }}
            >
              <ArrowUp />
            </button>
          </div>
          {advanced ? (
            <div className={css.advanced} data-new-session-advanced="">
              <div className={css.advancedGrid}>
                <label className={css.field}>
                  <span>具体成功标准 <em>可选</em></span>
                  <input value={goal} data-newtask-goal="" placeholder="留空则与任务描述相同" onChange={(event) => setGoal(event.target.value)} />
                </label>
                <label className={css.field}>
                  <span>任务分类 <em>可选</em></span>
                  <SelectMenu ariaLabel="任务分类" value={categoryId} options={categoryOptions} onChange={setCategoryId} />
                </label>
              </div>
              {templates.phase === "ready" && templates.templates.length > 0 ? (
                <label className={css.templateField}>
                  <span>用模板填入任务内容</span>
                  <SelectMenu key={appliedTemplate.current} ariaLabel="任务模板" value={appliedTemplate.current || "none"} options={templateOptions} onChange={chooseTemplate} />
                </label>
              ) : null}
              <label className={css.field}>
                <span>工作目录 <em>可选</em></span>
                <input value={rawDirReference ? workDir : ""} readOnly placeholder="默认：任务自己的目录" aria-label="工作目录" data-newtask-workdir="" onFocus={() => setDirOpen(true)} />
              </label>
              {readyProfiles.length > 0 ? (
                <fieldset className={css.profileField}>
                  <legend>任务模型 <em>不选则使用全局默认</em></legend>
                  <p className={css.profileHint}>可多选候选模型；选择「生效模型」后会单独完成绑定。</p>
                  {readyProfiles.map((item) => (
                    <div className={css.profileRow} key={item.id}>
                      <label>
                        <input type="checkbox" data-newtask-profile={item.id} checked={profileIds.includes(Number(item.id))} onChange={(event) => toggleProfile(item.id, event.target.checked)} />
                        <span>{item.name}<small>{item.model}</small></span>
                      </label>
                    </div>
                  ))}
                  {checkedProfiles.length > 0 ? <SelectMenu ariaLabel="任务生效模型" value={activeProfileId} options={activeOptions} onChange={setActiveProfileId} /> : null}
                </fieldset>
              ) : null}
              <div className={css.switchRow}>
                <div><strong>记录资产覆盖度</strong><small>在任务中持续维护探索范围与未覆盖资产。</small></div>
                <Switch checked={coverageEnabled} onChange={setCoverageEnabled} label="记录资产覆盖度" />
              </div>
              <div className={css.switchRow}>
                <div><strong>创建后立即开始</strong><small>关闭时仅建立任务，可随时在会话中继续。</small></div>
                <Switch checked={startImmediately} onChange={setStartImmediately} label="创建后立即开始" />
              </div>
            </div>
          ) : null}
        </div>
        {error === null ? <p className={css.hint}>Enter 换行 · ⌘ / Ctrl + Enter 开始</p> : (
          <div className={css.error} role="alert"><span>{error}</span><Button size="sm" onClick={() => { void submit(); }}>重试</Button></div>
        )}
      </div>
      <DirPicker open={dirOpen} initial={rawDirReference ? workDir : ""} onClose={() => setDirOpen(false)} onPick={(path) => { setWorkDir(path); setRawDirReference(true); }} />
            <Modal open={pendingTemplate !== null} onClose={() => setPendingTemplate(null)} closeLabel="关闭" title="用模板覆盖当前内容？" description="已填写的任务描述、成功标准和分类会被模板替换。" footer={<><Button variant="outline" onClick={() => setPendingTemplate(null)}>取消</Button><Button variant="primary" onClick={applyTemplate}>应用模板</Button></>}>
        <p className={css.templateConfirm}>{templateSource?.name ?? "所选模板"}</p>
      </Modal>
    </section>
  );
}
