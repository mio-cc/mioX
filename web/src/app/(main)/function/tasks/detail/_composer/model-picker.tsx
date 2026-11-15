"use client";

/**
 * Composer model seat: the chip trigger plus its custom popover (never a native
 * select). Extracted from task-workspace-dsh so the harness composer's data
 * shaping (profile chain → grouped rows) stays next to the control that renders
 * it. Styling rides the workspace's CSS module: the chips are the same material
 * as the rest of the composer bar.
 */

import * as React from "react";

import Link from "next/link";

import { Check, ChevronDown, ChevronRight } from "lucide-react";

import type { LLMProfile, Task } from "@/lib/types";

import styles from "../task-workspace-dsh.module.css";

/** GET /api/llm — the global fallback a task without its own chain calls. */
export type GlobalLLM = {
  readonly configured: boolean;
  readonly provider: string;
  readonly model: string;
  readonly reasoning_effort?: string;
};

/** One row of the composer model popover. */
export type ModelOption = {
  readonly key: string;
  readonly kind: "profile" | "global";
  readonly profileId?: number;
  readonly label: string;
  readonly meta: string;
  readonly active: boolean;
};

export type ModelGroup = { readonly title: string; readonly rows: ModelOption[] };

const EFFORT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
};

/** Effort value → chip copy; "" (field not sent) reads as the provider default. */
export function effortText(value?: string): string {
  if (!value) return "默认";
  return EFFORT_LABELS[value] ?? value;
}

function profileLabel(profile: LLMProfile): string {
  const name = profile.name?.trim();
  if (name) return name;
  return profile.model?.trim() || `配置 #${profile.id}`;
}

/**
 * Grouped model list: the task's own chain first, every other profile next, and
 * the global fallback last. Selecting the global row clears the chain
 * (`PUT /tasks/{id}/llm` with an empty list), which the backend documents as
 * "restore the global fallback".
 */
export function buildModelGroups(task: Task | null, profiles: LLMProfile[], global: GlobalLLM | null): ModelGroup[] {
  const chain = task?.llm_profile_ids ?? [];
  const activeId = task?.active_llm_profile_id;
  const inChain: ModelOption[] = [];
  const others: ModelOption[] = [];
  for (const profile of profiles) {
    const id = Number(profile.id);
    const row: ModelOption = {
      key: `profile:${id}`,
      kind: "profile",
      profileId: id,
      label: profileLabel(profile),
      meta: [profile.model, profile.format].filter(Boolean).join(" · "),
      active: id === activeId,
    };
    (chain.includes(id) ? inChain : others).push(row);
  }
  const groups: ModelGroup[] = [];
  if (inChain.length > 0) groups.push({ title: "任务模型链", rows: inChain });
  if (others.length > 0) groups.push({ title: inChain.length > 0 ? "其他配置" : "LLM 配置", rows: others });
  groups.push({
    title: "全局默认",
    rows: [
      {
        key: "global",
        kind: "global",
        label: global?.model?.trim() || "跟随全局设置",
        meta: global?.configured ? `${global.provider} · 已配置` : "全局未配置模型",
        active: activeId === undefined || activeId === null || activeId === 0,
      },
    ],
  });
  return groups;
}

/** Effort choices in the drilled pane; "" = follow the provider/model default. */
const EFFORT_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "默认" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
  { value: "max", label: "最高" },
];

/**
 * Model seat: one chip showing `model · effort`, opening a two-level menu whose
 * root is the Model / Effort row pair (each drilling into its own list).
 *
 * Structure follows the reference harness (ModelSelect): the effort level is not
 * a separate control in the composer bar - it is the second row of this menu, and
 * the trigger shows both values. Focus moves into the pane on open; arrows walk
 * rows, Enter picks, Escape backs out of a drilled pane and then closes.
 */
export function ModelSelect({
  groups,
  pending,
  openSignal,
  onRefresh,
  onSelect,
  effort,
  inheritedEffort,
  onEffortChange,
}: {
  readonly groups: ModelGroup[];
  readonly pending: boolean;
  readonly openSignal: number;
  readonly onRefresh: () => void;
  readonly onSelect: (option: ModelOption) => void;
  /** Current per-turn thinking level ("" = follow the model default). */
  readonly effort: string;
  /** The profile's own level, shown when no override is set (DSH shows the effective value). */
  readonly inheritedEffort?: string;
  readonly onEffortChange: (next: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pane, setPane] = React.useState<"root" | "model" | "effort">("root");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const rows = React.useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const activeRow = rows.find((row) => row.active);
  const focusOnOpenRef = React.useRef(true);

  // The /model slash command opens this same menu without a pointer.
  React.useEffect(() => {
    if (openSignal <= 0) return;
    setOpen(true);
    setPane("model");
    onRefresh();
  }, [openSignal, onRefresh]);

  React.useEffect(() => {
    if (!open) {
      focusOnOpenRef.current = true;
      setPane("root");
      return;
    }
    if (!focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current[0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, pane]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setPane("root");
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (pane !== "root") {
        setPane("root");
        return;
      }
      close(true);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    let next = 0;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (current < 0) next = event.key === "ArrowUp" ? items.length - 1 : 0;
    else next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const choose = (option: ModelOption) => {
    close(true);
    if (option.active) return;
    onSelect(option);
  };

  const modelLabel = activeRow?.label ?? "未配置模型";
  const effortLabel = effortText(effort || inheritedEffort);
  itemRefs.current = [];
  let itemIndex = 0;
  const registerItem = (node: HTMLButtonElement | null) => {
    itemRefs.current[itemIndex] = node;
    itemIndex += 1;
  };

  return (
    <div className={styles.modelRoot} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.modelSeat}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "composer-model-menu" : undefined}
        aria-label={`模型与思考档位：${modelLabel}，${effortLabel}`}
        title={`${modelLabel} · 思考${effortLabel}（点击切换）`}
        onClick={() => {
          if (open) {
            close(false);
            return;
          }
          setOpen(true);
          setPane("root");
          onRefresh();
        }}
        data-action="model"
        data-testid="composer-model-trigger"
        data-model-active={activeRow?.key ?? ""}
      >
        <span className={styles.modelSeatLabel}>{modelLabel}</span>
        <span className={styles.modelSeatEffort}>{effortLabel}</span>
        {pending ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} aria-hidden="true" className={styles.chipChevron} data-open={open ? "true" : "false"} />
        )}
      </button>
      {open ? (
        <div
          id="composer-model-menu"
          className={styles.modelMenu}
          role="menu"
          aria-label="模型与思考档位"
          data-testid="composer-model-menu"
          data-pane={pane}
        >
          {pane === "root" ? (
            <div className={styles.modelCells}>
              <button
                ref={registerItem}
                type="button"
                role="menuitem"
                className={styles.modelCell}
                onClick={() => setPane("model")}
                data-testid="composer-model-cell"
              >
                <span className={styles.modelCellLabel}>模型</span>
                <span className={styles.modelCellValue}>{modelLabel}</span>
                <ChevronRight size={12} aria-hidden="true" className={styles.modelCellChevron} />
              </button>
              <button
                ref={registerItem}
                type="button"
                role="menuitem"
                className={styles.modelCell}
                onClick={() => setPane("effort")}
                data-testid="composer-effort-cell"
              >
                <span className={styles.modelCellLabel}>思考</span>
                <span className={styles.modelCellValue}>{effortLabel}</span>
                <ChevronRight size={12} aria-hidden="true" className={styles.modelCellChevron} />
              </button>
            </div>
          ) : null}

          {pane === "model" ? (
            <>
              {groups.map((group) => (
                <div key={group.title} className={styles.modelGroup} role="group" aria-label={group.title}>
                  <div className={styles.modelGroupTitle}>{group.title}</div>
                  {group.rows.map((row) => (
                    <button
                      key={row.key}
                      ref={registerItem}
                      type="button"
                      role="menuitemradio"
                      aria-checked={row.active}
                      className={styles.modelOption}
                      data-active={row.active ? "true" : "false"}
                      data-model-key={row.key}
                      data-action="model-option"
                      data-testid="composer-model-option"
                      disabled={pending}
                      onClick={() => choose(row)}
                    >
                      <span className={styles.modelOptionCopy}>
                        <span className={styles.modelOptionLabel}>{row.label}</span>
                        {row.meta ? <span className={styles.modelOptionMeta}>{row.meta}</span> : null}
                      </span>
                      {row.active ? <Check size={12} aria-hidden="true" className={styles.modelCheck} /> : null}
                    </button>
                  ))}
                </div>
              ))}
              <Link className={styles.modelManage} href="/system/llm" data-testid="composer-model-manage">
                管理 LLM 配置
              </Link>
            </>
          ) : null}

          {pane === "effort" ? (
            <div className={styles.modelGroup} role="group" aria-label="思考档位">
              <div className={styles.modelGroupTitle}>思考档位（本轮）</div>
              {EFFORT_CHOICES.map((choice) => (
                <button
                  key={choice.value || "default"}
                  ref={registerItem}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.value === effort}
                  className={styles.modelOption}
                  data-active={choice.value === effort ? "true" : "false"}
                  data-effort={choice.value}
                  data-testid="composer-effort-option"
                  onClick={() => {
                    onEffortChange(choice.value);
                    setPane("root");
                  }}
                >
                  <span className={styles.modelOptionCopy}>
                    <span className={styles.modelOptionLabel}>{choice.label}</span>
                    {choice.value === "" ? (
                      <span className={styles.modelOptionMeta}>跟随模型配置</span>
                    ) : null}
                  </span>
                  {choice.value === effort ? <Check size={12} aria-hidden="true" className={styles.modelCheck} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
