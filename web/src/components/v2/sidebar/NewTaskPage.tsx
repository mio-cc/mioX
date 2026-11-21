"use client";

/**
 * 新会话启动页：一个目标 → 直接开跑。
 *
 * D7（用户反馈「新会话的输入框逻辑和会话里的不一样，有点奇怪」）：输入卡与会话
 * 输入框完全同构——同一张卡（`Composer.module.css` 的 .composer / .row / .chip /
 * .primary）、同一套按键：Enter 发送、Shift+Enter 换行、输入法组合中不发送、
 * 按住 Enter 不连发；工具条左侧是权限档与「计划」开关（与会话里同一控件
 * `PlanModeToggle`，Shift+Tab 切换），右侧是模型选择与发送圆钮。原来的
 * 「标准 / 规划 / 团队」下拉拆成：计划 = 输入框里的计划开关；团队协作 = 卡片上方
 * 的上下文开关。工作目录同在上下文行。
 *
 * 写入顺序不变：createTask → 首条消息 sendTaskChatMessage → 模式 / 权限 / 模型绑定；
 * 失败时如实说明已创建到哪一步。
 */
import * as React from "react";

import { ComposerEditor, type ComposerEditorHandle } from "@/components/v2/composer/ComposerEditor";
import composerCss from "@/components/v2/composer/Composer.module.css";
import { ModelPicker } from "@/components/v2/composer/ModelPicker";
import { PlanModeToggle } from "@/components/v2/composer/PlanModeToggle";
import { toast } from "@/components/v2/settings/Toast";
import { profilesToOptions } from "@/v2/data/llm-map";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import {
  createTask,
  sendTaskChatMessage,
  setTaskPermissionLevel,
  setTaskPlanMode,
} from "@/v2/data/task-actions";
import { useTaskTemplates } from "@/v2/data/task-categories";
import { bindTaskProfiles } from "@/v2/data/task-create";
import { setTaskTeamMode } from "@/v2/data/task-mode";
import { reasoningEffortLabel } from "@/v2/data/llm-map";
import { setTurnEffort } from "@/v2/data/turn-effort";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconSendOutlineRegular,
  IconUsersOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { Modal } from "@/vendor/dsh/primitives/Modal";

import { MioxMark } from "./MioxMark";
import { NativeDirPicker } from "./NativeDirPicker";
import css from "./NewTaskPage.module.css";

const DEFAULT_DIR = "默认工作区";

/** 与会话输入框同一份权限档（`Composer.tsx` PERMISSIONS）。 */
const PERMISSIONS = [
  { id: "auto", label: "自动", desc: "规则 + LLM 裁决（默认）" },
  { id: "read-only", label: "仅可查看", desc: "状态变更工具全部拒绝" },
  { id: "workspace-write", label: "工作区内修改", desc: "工作区可写，全局副作用工具拒绝" },
  { id: "danger-full", label: "完全权限", desc: "不拦截（不可逆操作仍要人工确认）" },
] as const;

const PLACEHOLDER = "描述要测试的目标与范围，例如：对 example.com 做一次授权范围内的外部攻击面梳理";
const PLAN_PLACEHOLDER = "描述要评估的目标，先侦察并给出计划，批准后再执行";

export interface NewTaskPageProps {
  /** 创建成功后收到新任务 id；调用方随即离开本页进入该任务。 */
  readonly onCreated: (id: string) => void;
}

/** 全页新会话入口：一个目标 → 直接开跑。 */
export function NewTaskPage({ onCreated }: NewTaskPageProps): React.ReactNode {
  const [description, setDescription] = React.useState("");
  const [workDir, setWorkDir] = React.useState(DEFAULT_DIR);
  const [rawDirReference, setRawDirReference] = React.useState(false);
  const [dirOpen, setDirOpen] = React.useState(false);
  const [planMode, setPlanMode] = React.useState(false);
  const [teamMode, setTeamMode] = React.useState(false);
  const [permission, setPermission] = React.useState<string>("auto");
  const [permissionOpen, setPermissionOpen] = React.useState(false);
  const [confirmFull, setConfirmFull] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [activeProfileId, setActiveProfileId] = React.useState<string>("none");
  // 推理等级（"" = Default）：与会话输入框同一套——随首条消息发送，并记到新任务上，
  // 进入会话后输入框继续沿用（v2/data/turn-effort.ts）。
  const [effortChoice, setEffortChoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const editorRef = React.useRef<ComposerEditorHandle>(null);
  const createdTask = React.useRef<string | null>(null);
  const inFlight = React.useRef(false);

  const profiles = useLlmProfiles();
  const models = React.useMemo(() => profilesToOptions(profiles.profiles), [profiles.profiles]);
  const templates = useTaskTemplates();
  // 触发器上的强度：所选档位；Default 时显示所选模型配置自身的 reasoning_effort。
  const effortLabel = React.useMemo(() => {
    if (effortChoice !== "") return reasoningEffortLabel(effortChoice);
    const chosen =
      activeProfileId === "none"
        ? (profiles.profiles.find((row) => row.is_default === true) ?? profiles.profiles[0])
        : profiles.profiles.find((row) => row.id === activeProfileId);
    return chosen === undefined ? null : reasoningEffortLabel(chosen.reasoning_effort ?? "");
  }, [activeProfileId, effortChoice, profiles.profiles]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const submit = async (): Promise<void> => {
    const text = description.trim();
    if (text === "" || busy || inFlight.current || createdTask.current !== null) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let createdTaskId: string | null = null;
    let requestSucceeded = false;
    const profileIds = activeProfileId === "none" ? [] : [Number(activeProfileId)];
    try {
      const task = await createTask({
        description: text,
        goal: text,
        llmProfileIds: profileIds.length > 0 ? profileIds : undefined,
        workDir: rawDirReference && workDir.trim() !== "" ? workDir.trim() : undefined,
        // 不再 seed 开跑：第一条内容作为聊天消息真实发送，正文首行是用户消息。
        seedFirstIntent: false,
      });
      createdTaskId = task.id;
      createdTask.current = task.id;
      // 模式与权限先于首条消息生效，这样第一轮就按所选档位运行。
      if (planMode) await setTaskPlanMode(task.id, true);
      if (teamMode) await setTaskTeamMode(task.id, true);
      if (permission !== "auto") await setTaskPermissionLevel(task.id, permission);
      // 首条消息：进入对话的正文流（202 异步运行），模型回应随后经 SSE 到达。
      if (effortChoice !== "") setTurnEffort(task.id, effortChoice);
      await sendTaskChatMessage(task.id, text, effortChoice);
      if (activeProfileId !== "none") {
        try {
          await bindTaskProfiles(task.id, profileIds, Number(activeProfileId));
        } catch {
          toast("任务已创建，但生效模型设置失败；可在任务模型页重设。");
        }
      }
      requestSucceeded = true;
      onCreated(task.id);
    } catch (reason: unknown) {
      const reasonText = reason instanceof Error ? reason.message : String(reason);
      setError(
        createdTaskId === null
          ? `创建未完成：${reasonText}`
          : `任务 #${createdTaskId} 已创建，但首条消息未送出。请在任务里直接重发：${reasonText}`,
      );
      setBusy(false);
    } finally {
      if (!requestSucceeded) inFlight.current = false;
    }
  };

  const retryAction = (): void => {
    if (createdTask.current !== null) {
      onCreated(createdTask.current);
      return;
    }
    void submit();
  };
  const retryLabel = createdTask.current === null ? "重试" : "进入已创建任务";

  /** 同会话输入框（`Composer.tsx` handleEditorKeyDown）：Enter 发送、Shift+Enter 换行、IME 安全。 */
  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const native = event.nativeEvent;
    const composing = native.isComposing || native.keyCode === 229 || (editorRef.current?.recentlyComposing() ?? false);
    if (
      native.altKey ||
      native.getModifierState("AltGraph") ||
      (native.ctrlKey && native.metaKey) ||
      (native.shiftKey && (native.ctrlKey || native.metaKey))
    ) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      if (event.shiftKey) {
        if (composing) return;
        event.preventDefault();
        editorRef.current?.insertLineBreak();
        return;
      }
      if (composing) return;
      event.preventDefault();
      if (event.repeat) return;
      void submit();
      return;
    }
    if (composing) return;
    if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) setPlanMode((value) => !value);
    }
  };

  /** 工具条按下不抢走草稿焦点（同会话输入框）。 */
  const keepEditorFocus = (event: React.MouseEvent): void => {
    event.preventDefault();
    editorRef.current?.focus();
  };

  const permissionLabel = PERMISSIONS.find((entry) => entry.id === permission)?.label ?? "自动";
  const dirLabel = rawDirReference ? workDir.split(/[\\/]/).filter(Boolean).at(-1) || workDir : DEFAULT_DIR;
  const starters = templates.phase === "ready" ? templates.templates.slice(0, 4) : [];

  return (
    <section className={css.stage} data-new-session-page="" aria-label="新会话启动">
      <div className={css.content}>
        <div className={css.headline}>
          <div className={css.mark} aria-hidden="true">
            <MioxMark size={34} />
          </div>
          <h1>从一个目标开始</h1>
        </div>
        <p className={css.lead}>描述目标与授权范围，mioX 会组织 Agent 侦察、验证并整理发现。</p>

        <div className={css.contextRow}>
          <button
            type="button"
            className={css.context}
            title={rawDirReference ? workDir : "选择工作目录"}
            aria-label="选择工作目录"
            data-new-session-dir=""
            onClick={() => setDirOpen(true)}
          >
            <IconFolderOpenOutlineRegular size={14} />
            <span>{dirLabel}</span>
            <IconChevronDownOutlineRegular size={10} />
          </button>
          <span className={css.contextSep} aria-hidden="true" />
          <button
            type="button"
            className={teamMode ? `${css.context} ${css.contextOn}` : css.context}
            aria-pressed={teamMode}
            title="团队协作：提供共享任务板，协调多个执行角色"
            data-new-session-team={teamMode ? "on" : "off"}
            onClick={() => setTeamMode((value) => !value)}
          >
            <IconUsersOutlineRegular size={14} />
            <span>团队协作</span>
            {teamMode ? <IconCheckOutlineRegular size={12} /> : null}
          </button>
        </div>

        <div
          className={composerCss.composer}
          data-new-session-composer=""
          data-plan-mode={planMode ? "" : undefined}
          onMouseDown={(event) => {
            if (event.button !== 0 || event.defaultPrevented) return;
            const target = event.target as HTMLElement;
            if (target.closest("button, input, [contenteditable], [role='menu']") !== null) return;
            event.preventDefault();
            editorRef.current?.focus();
          }}
        >
          <ComposerEditor
            handleRef={editorRef}
            editable={!busy}
            placeholder={planMode ? PLAN_PLACEHOLDER : PLACEHOLDER}
            showPlaceholder={description === ""}
            onDraftChange={(text) => {
              setDescription(text);
              setError(null);
            }}
            onKeyDown={onEditorKeyDown}
            onPaste={(event) => {
              if (event.clipboardData.files.length > 0) {
                event.preventDefault();
                toast("新会话创建后才能添加附件");
                return;
              }
              const text = event.clipboardData.getData("text/plain");
              if (text !== "") {
                event.preventDefault();
                editorRef.current?.insertPlainText(text);
              }
            }}
          />

          <div className={composerCss.row}>
            <div className={composerCss.tools}>
              <div className={composerCss.modes}>
                <Menu
                  open={permissionOpen}
                  side="bottom"
                  anchor={
                    <button
                      type="button"
                      className={composerCss.chip}
                      aria-haspopup="menu"
                      aria-expanded={permissionOpen}
                      data-new-session-permission={permission}
                      onMouseDown={keepEditorFocus}
                      onClick={() => setPermissionOpen((value) => !value)}
                    >
                      {permissionLabel} <IconChevronDownOutlineRegular size={10} />
                    </button>
                  }
                  items={PERMISSIONS.map((entry) => ({
                    id: entry.id,
                    label: (
                      <span className={css.menuTwoLine}>
                        <span>{entry.label}</span>
                        <span className={css.menuDesc}>{entry.desc}</span>
                      </span>
                    ),
                  }))}
                  selectedId={permission}
                  selection="check"
                  onSelect={(id) => {
                    setPermissionOpen(false);
                    if (id === "danger-full") {
                      setAcknowledged(false);
                      setConfirmFull(true);
                      return;
                    }
                    setPermission(id);
                  }}
                  onClose={() => setPermissionOpen(false)}
                />
                <PlanModeToggle
                  on={planMode}
                  busy={false}
                  nextTurn={false}
                  disabled={busy}
                  onMouseDown={keepEditorFocus}
                  onToggle={() => setPlanMode((value) => !value)}
                />
              </div>
            </div>

            <div className={composerCss.trailing}>
              <div className={composerCss.standardControls}>
                <ModelPicker
                  models={models}
                  phase={profiles.phase}
                  value={activeProfileId === "none" ? undefined : activeProfileId}
                  onChange={(id) => {
                    const numeric = Number(id);
                    if (Number.isNaN(numeric)) return;
                    setActiveProfileId(id);
                  }}
                  effort={effortLabel}
                  effortChoice={effortChoice}
                  onEffortChange={setEffortChoice}
                />
              </div>
              <button
                type="button"
                className={composerCss.primary}
                disabled={description.trim() === "" || busy}
                aria-label={busy ? "正在创建会话" : "创建并开跑"}
                aria-busy={busy ? true : undefined}
                title={busy ? "正在创建…" : "创建并开跑（Enter）"}
                data-sending={busy ? "" : undefined}
                data-newtask-submit=""
                onMouseDown={keepEditorFocus}
                onClick={() => void submit()}
              >
                {busy ? (
                  <svg className={composerCss.sendingSpinner} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
                    <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <IconSendOutlineRegular size={15} />
                )}
              </button>
            </div>
          </div>
        </div>

        {error === null ? (
          <p className={css.hint}>
            <kbd>Enter</kbd> 创建并开跑 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行 · <kbd>Shift</kbd>+<kbd>Tab</kbd> 计划模式
          </p>
        ) : (
          <div className={css.error} role="alert">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={retryAction}>
              {retryLabel}
            </Button>
          </div>
        )}

        {starters.length > 0 ? (
          <div className={css.starters} data-new-session-templates={starters.length}>
            <div className={css.startersHead}>从模板开始</div>
            <div className={css.starterGrid}>
              {starters.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={css.starter}
                  data-new-session-template={template.id}
                  onClick={() => {
                    const text = template.goal.trim() === "" ? template.description : template.goal;
                    editorRef.current?.insertPlainText(text);
                    editorRef.current?.focus();
                  }}
                >
                  <span className={css.starterName}>{template.name}</span>
                  <span className={css.starterDesc}>{template.description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <NativeDirPicker
        open={dirOpen}
        initial={rawDirReference ? workDir : ""}
        onClose={() => setDirOpen(false)}
        onPick={(path) => {
          setWorkDir(path);
          setRawDirReference(true);
        }}
      />

      <Modal
        open={confirmFull}
        onClose={() => setConfirmFull(false)}
        closeLabel="关闭"
        title="确认启用完全权限？"
        description="启用完全权限后，这个任务将减少确认步骤，可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmFull(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!acknowledged}
              onClick={() => {
                setPermission("danger-full");
                setConfirmFull(false);
              }}
            >
              启用完全权限
            </Button>
          </>
        }
      >
        <label className={composerCss.ackRow}>
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          我已了解风险，并愿意继续
        </label>
      </Modal>
    </section>
  );
}
