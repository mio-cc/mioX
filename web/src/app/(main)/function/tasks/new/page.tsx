"use client";

// New-task hero (DSH EmptyHero / HeroShell shape): one centered headline plus a
// single input card. Type the objective, press Enter, the agent starts. No
// multi-step wizard, no legacy fields.
//
// Static-export friendly: client component only, no Server Actions and no
// useSearchParams (which would need a Suspense boundary under NEXT_EXPORT=1).

import * as React from "react";

import { useRouter } from "next/navigation";

import { Check, ChevronDown, Cpu, Folder, FolderOpen, Layers, Plus } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";

import { DirPicker } from "./dir-picker";
import type { LLMProfile, TaskCategory } from "@/lib/types";

import styles from "./new-task.module.css";

/** One row of a chip popover (model / category). */
type ChipOption = {
  /** "" is the neutral row (default model / uncategorized). */
  readonly id: string;
  readonly label: string;
  readonly meta?: string;
};

/** Brand mark shared with the sidebar (kept local so the hero owns no deps). */
function HeroMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12c3.2-5.3 7.1-8 11.8-8 2.4 0 4.1.8 5.2 2.4-1.4.4-2.6 1.1-3.6 2.1 1.5.2 2.8.8 3.8 1.8-2.2 1-3.7 2.8-4.6 5.2-1.2 3.2-3.6 5-7.2 5.5 1.3-1.6 2.2-3.4 2.7-5.3-2.2-.4-4.1-1.3-5.7-2.7-.9-.8-1.7-1.9-2.4-3Z"
        fill="currentColor"
      />
      <circle cx="16.2" cy="8.7" r=".9" fill="var(--ax-bg-canvas)" />
    </svg>
  );
}

/**
 * A chip button plus its custom popover listbox. Closed chrome stays a pill;
 * the menu floats under the trigger and owns arrow/Home/End/Enter/Escape keys,
 * outside-click dismissal and focus return.
 */
function ChipMenu({
  createLabel,
  onCreate,
  icon,
  caption,
  value,
  options,
  onSelect,
  disabled = false,
  disabledHint,
  testId,
}: {
  readonly icon: React.ReactNode;
  readonly caption: string;
  readonly value: string;
  readonly options: readonly ChipOption[];
  readonly onSelect: (id: string) => void;
  readonly disabled?: boolean;
  readonly disabledHint?: string;
  readonly testId?: string;
  /** Label for the inline create row; omit to hide it entirely. */
  readonly createLabel?: string;
  /** Create a new entry from the menu footer and select it. */
  readonly onCreate?: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  // Inline create: the category list is empty on a fresh install, and a picker
  // that can never open is a dead control. The footer row creates on the spot.
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [createError, setCreateError] = React.useState("");
  const submitCreate = React.useCallback(async () => {
    const name = draft.trim();
    if (name === "" || saving || !onCreate) return;
    setSaving(true);
    setCreateError("");
    try {
      await onCreate(name);
      setDraft("");
      setCreating(false);
    } catch (error) {
      setCreateError((error as Error).message || "创建失败");
    } finally {
      setSaving(false);
    }
  }, [draft, onCreate, saving]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const selected = options[selectedIndex];

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => listRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
        setDraft("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const close = React.useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onSelect(option.id);
    close(true);
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex((index) => {
        if (event.key === "Home") return 0;
        if (event.key === "End") return options.length - 1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (index + delta + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  const menuId = testId ? `${testId}-menu` : undefined;
  const optionId = (index: number) => (testId ? `${testId}-option-${index}` : undefined);

  return (
    <div className={styles.chipWrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.chip}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${caption}，当前 ${selected?.label ?? "未选择"}`}
        title={disabled ? disabledHint : `${caption}：${selected?.label ?? ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        data-testid={testId}
      >
        <span className={styles.chipIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.chipCaption}>{caption}</span>
        <span className={styles.chipValue}>{selected?.label ?? "未选择"}</span>
        <ChevronDown size={12} aria-hidden="true" className={styles.chipChevron} />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={menuId}
          role="listbox"
          aria-label={caption}
          aria-activedescendant={optionId(activeIndex)}
          tabIndex={0}
          className={styles.menu}
          onKeyDown={handleListKeyDown}
          data-testid={menuId}
        >
          {options.map((option, index) => {
            const isSelected = option.id === value;
            return (
              <button
                key={`${option.id || "none"}-${option.label}`}
                id={optionId(index)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                data-active={index === activeIndex ? "true" : "false"}
                className={styles.menuOption}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <span className={styles.menuOptionMain}>
                  <span className={styles.menuOptionLabel}>{option.label}</span>
                  {option.meta ? <span className={styles.menuOptionMeta}>{option.meta}</span> : null}
                </span>
                {isSelected ? <Check size={13} aria-hidden="true" className={styles.menuCheck} /> : null}
              </button>
            );
          })}
          {onCreate ? (
            <div className={styles.menuFooter}>
              {creating ? (
                <div className={styles.menuCreateRow}>
                  <input
                    className={styles.menuCreateInput}
                    value={draft}
                    autoFocus
                    placeholder={createLabel ?? "新建"}
                    aria-label={createLabel ?? "新建"}
                    disabled={saving}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitCreate();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setCreating(false);
                        setDraft("");
                        setCreateError("");
                      }
                    }}
                    data-testid={testId ? `${testId}-create-input` : undefined}
                  />
                  <button
                    type="button"
                    className={styles.menuCreateConfirm}
                    disabled={saving || draft.trim() === ""}
                    onClick={() => void submitCreate()}
                    data-testid={testId ? `${testId}-create-confirm` : undefined}
                  >
                    {saving ? "…" : "确定"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.menuCreateTrigger}
                  onClick={() => setCreating(true)}
                  data-testid={testId ? `${testId}-create` : undefined}
                >
                  <Plus size={13} aria-hidden="true" />
                  {createLabel ?? "新建"}
                </button>
              )}
              {createError ? <span className={styles.menuCreateError}>{createError}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function NewTaskPage() {
  const router = useRouter();

  const [goal, setGoal] = React.useState("");
  const [profileId, setProfileId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [coverageEnabled, setCoverageEnabled] = React.useState(true);
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [categories, setCategories] = React.useState<TaskCategory[]>([]);
  const [profilesFailed, setProfilesFailed] = React.useState(false);
  const [categoriesFailed, setCategoriesFailed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState<"" | "create" | "run">("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const loadProfiles = React.useCallback(() => {
    setProfilesFailed(false);
    api
      .llmProfiles()
      .then(setProfiles)
      .catch(() => {
        setProfiles([]);
        setProfilesFailed(true);
      });
  }, []);

  const loadCategories = React.useCallback(() => {
    setCategoriesFailed(false);
    api
      .taskCategories()
      .then(setCategories)
      .catch(() => {
        setCategories([]);
        setCategoriesFailed(true);
      });
  }, []);

  React.useEffect(() => {
    loadProfiles();
    loadCategories();
  }, [loadProfiles, loadCategories]);

  // The hero composer owns the first keystroke, like DSH's new-session screen.
  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-grow up to 200px, then scroll inside the draft area.
  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, 200);
    node.style.height = `${Math.max(next, 52)}px`;
    node.style.overflowY = node.scrollHeight > 200 ? "auto" : "hidden";
  }, [goal]);

  // 工作目录（参照 DSH：新建会话时选一个文件夹）。空=后端默认 data/tasks/<id>。
  const [workDir, setWorkDir] = React.useState("");
  const [dirOpen, setDirOpen] = React.useState(false);

  const trimmed = goal.trim();
  const busy = submitting !== "";
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = React.useCallback(
    async (run: boolean) => {
      const text = goal.trim();
      if (text === "" || submitting !== "") return;
      setSubmitting(run ? "run" : "create");
      try {
        const task = await api.createTask({
          description: text,
          goal: text,
          llmProfileIds: profileId === "" ? [] : [Number(profileId)],
          categoryId: categoryId === "" ? undefined : Number(categoryId),
          seedFirstIntent: run,
          coverageEnabled,
          workDir: workDir.trim(),
        });
        // 输入框里的这句话就是与模型对话的第一条消息（参照 DSH：新建会话时输入即首条消息）。
        // 任务已经建好，首条消息失败不回滚，只提示手动重发。
        try {
          await api.chat(text, String(task.id));
        } catch (error) {
          toast.error("任务已创建，但首条消息发送失败：" + (error as Error).message);
        }
        toast.success(run ? "任务已创建，agent 开始执行" : "任务已创建");
        router.push(`/function/tasks/detail?id=${encodeURIComponent(task.id)}`);
      } catch (error) {
        toast.error("创建失败：" + (error as Error).message);
        // Keep the draft: a failed create must not cost the typed objective.
        setSubmitting("");
        textareaRef.current?.focus();
      }
    },
    [categoryId, coverageEnabled, goal, profileId, router, submitting, workDir],
  );

  const modelOptions: ChipOption[] = React.useMemo(() => {
    const rows: ChipOption[] = [{ id: "", label: "默认配置", meta: "跟随全局激活模型" }];
    for (const profile of profiles) {
      rows.push({
        id: profile.id,
        label: profile.name || `配置 #${profile.id}`,
        meta: [profile.model, profile.is_default ? "默认" : ""].filter(Boolean).join(" · "),
      });
    }
    return rows;
  }, [profiles]);

  const categoryOptions: ChipOption[] = React.useMemo(() => {
    const rows: ChipOption[] = [{ id: "", label: "未分类" }];
    for (const category of categories) {
      rows.push({ id: String(category.id), label: category.name, meta: `${category.task_count} 个任务` });
    }
    return rows;
  }, [categories]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // Never swallow the IME commit key (Chinese/Japanese input).
    if (event.nativeEvent.isComposing) return;
    if (event.shiftKey) return;
    event.preventDefault();
    void submit(!event.metaKey && !event.ctrlKey);
  };

  return (
    <div className={styles.root} data-testid="newtask-root">
      <DirPicker
        open={dirOpen}
        initial={workDir}
        onClose={() => setDirOpen(false)}
        onPick={setWorkDir}
      />
      <div className={styles.stack}>
        <div className={styles.headline}>
          <HeroMark />
          <span className={styles.titleGroup}>
            <h1 className={styles.title}>新建任务</h1>
            <span className={styles.badge}>HARNESS</span>
          </span>
        </div>
        <p className={styles.subtitle}>写清目标与范围就能开跑：agent 自行规划、执行、验证并汇报进度。</p>

        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(true);
          }}
          data-testid="newtask-card"
        >
          <label className={styles.draft}>
            <span className={styles.srOnly}>任务目标与范围</span>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              rows={1}
              value={goal}
              placeholder="拿到 acme.com 后台管理权限，范围 acme.com 及 4 个子域"
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="任务目标与范围"
              data-testid="newtask-input"
            />
          </label>

          <div className={styles.chipRow}>
            <ChipMenu
              icon={<Cpu size={13} />}
              caption="模型"
              value={profileId}
              options={modelOptions}
              onSelect={setProfileId}
              disabled={profilesFailed}
              disabledHint="模型配置加载失败，创建时使用默认配置"
              testId="newtask-model"
            />
            <ChipMenu
              icon={<Folder size={13} />}
              caption="分类"
              value={categoryId}
              options={categoryOptions}
              onSelect={setCategoryId}
              disabled={categoriesFailed}
              disabledHint={
                categoriesFailed ? "分类加载失败，创建时归入未分类" : "还没有分类，可在菜单里直接新建"
              }
              testId="newtask-category"
              createLabel="新建分类"
              onCreate={async (name) => {
                const created = await api.createTaskCategory(name);
                setCategories((current) => [...current, created]);
                setCategoryId(String(created.id));
              }}
            />
            <button
              type="button"
              className={styles.toggleChip}
              onClick={() => setDirOpen(true)}
              title={workDir || "默认：任务自己的目录"}
              data-testid="newtask-workdir"
            >
              <FolderOpen size={13} aria-hidden="true" className={styles.chipIcon} />
              <span className={styles.chipCaption}>目录</span>
              <span className={styles.toggleState}>
                {workDir ? workDir.split(/[\\/]/).filter(Boolean).pop() || workDir : "默认"}
              </span>
            </button>
            <button
              type="button"
              className={styles.toggleChip}
              aria-pressed={coverageEnabled}
              onClick={() => setCoverageEnabled((value) => !value)}
              title="资产覆盖度：开启后自动累积测试范围并统计未覆盖资产"
              data-testid="newtask-coverage"
            >
              <Layers size={13} aria-hidden="true" className={styles.chipIcon} />
              <span className={styles.chipCaption}>覆盖度</span>
              <span className={styles.toggleState}>{coverageEnabled ? "开" : "关"}</span>
            </button>
          </div>

          <div className={styles.actions}>
            <span className={styles.hint}>
              <kbd className={styles.kbd}>Enter</kbd> 创建并开跑
              <span className={styles.hintDivider} aria-hidden="true">
                ·
              </span>
              <kbd className={styles.kbd}>Shift</kbd>
              <span className={styles.hintPlus}>+</span>
              <kbd className={styles.kbd}>Enter</kbd> 换行
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void submit(false)}
              disabled={!canSubmit}
              // A disabled primary action must say why, otherwise it reads as broken.
              title={!canSubmit ? (busy ? "正在创建，请稍候" : "先填写测试目标才能创建") : "只创建任务，不下发种子意图"}
              aria-describedby={!canSubmit ? "newtask-why-disabled" : undefined}
              data-testid="newtask-create"
            >
              {submitting === "create" ? <span className={styles.spinner} aria-hidden="true" /> : null}
              {submitting === "create" ? "创建中" : "仅创建"}
            </button>
            <button
              type="submit"
              className={styles.primary}
              disabled={!canSubmit}
              title={!canSubmit ? (busy ? "正在创建，请稍候" : "先填写测试目标才能创建") : "创建并立即下发种子意图"}
              aria-describedby={!canSubmit ? "newtask-why-disabled" : undefined}
              data-testid="newtask-create-run"
            >
              {submitting === "run" ? <span className={styles.spinner} aria-hidden="true" /> : null}
              {submitting === "run" ? "创建中" : "创建并开跑"}
            </button>
            {!canSubmit ? (
              <span id="newtask-why-disabled" className={styles.disabledReason}>
                {busy ? "正在创建…" : "填写测试目标后即可创建"}
              </span>
            ) : null}
          </div>
        </form>

        <p className={styles.footnote}>
          创建后进入任务工作台；「创建并开跑」会立即下发种子意图，worker 不必等首轮 planner。
        </p>
      </div>
    </div>
  );
}
