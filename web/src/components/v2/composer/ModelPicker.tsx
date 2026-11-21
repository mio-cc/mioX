"use client";

/**
 * Model picker, mirroring `ui-model-selection/ModelSelect.tsx`:
 * the root menu is the 【模型 / 推理等级】row pair; each row drills into its own
 * list. The model list groups by provider, shows search above four entries and
 * checks the current choice; the effort list is the model's reasoning levels.
 */
import * as React from "react";

import type { ModelOption } from "@/v2/data/llm-map";
import {
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconSearchOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import css from "./ModelPicker.module.css";

/** The menu's levels, unchanged from the original picker; "default" = follow the profile. */
const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Render the model menu.
 * @param props.models - options built from the configured profiles.
 * @param props.phase - adapter phase, so an empty menu can explain itself.
 * @param props.value - controlled model id (profile id string); omit to keep the
 *   picker's own default-first state, as the conversation composer does when the
 *   task's effective profile is not yet resolved.
 * @param props.onChange - model selection callback; the controlled caller binds it
 *   to its own task/profile state, the picker itself stores nothing for it.
 * @param props.effort - the EFFECTIVE strength label shown after the trigger's model
 *   name (e.g. 「zai-glm-5-3 · 最大」): the menu choice when one is set, otherwise
 *   the profile's stored `reasoning_effort`. Omit/null hides the segment.
 * @param props.effortChoice - controlled menu choice ("" = Default / follow the profile).
 * @param props.onEffortChange - called with the new choice ("" for Default); the
 *   composer stores it per task and sends it with every chat turn.
 * @param props.enableEffort - whether the root pane offers the 推理等级 row; hide it
 *   on surfaces where the backend has no per-task effort (task creation).
 */
export function ModelPicker({
  models,
  phase = "ready",
  value,
  onChange,
  effort,
  effortChoice = "",
  onEffortChange,
  enableEffort = true,
}: {
  models: readonly ModelOption[];
  phase?: "loading" | "ready" | "offline";
  value?: string;
  onChange?: (id: string) => void;
  effort?: string | null;
  effortChoice?: string;
  onEffortChange?: (value: string) => void;
  enableEffort?: boolean;
}): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const [pane, setPane] = React.useState<"root" | "models" | "effort">("root");
  const [query, setQuery] = React.useState("");
  const [ownModelId, setOwnModelId] = React.useState(models[0]?.id ?? "");
  const modelId = value ?? ownModelId;
  const choose = (id: string): void => {
    setOwnModelId(id);
    onChange?.(id);
  };
  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const model = models.find((m) => m.id === modelId) ?? models[0];
  const efforts = model !== undefined && model.efforts.length > 0 ? EFFORTS : [];
  // The menu keeps its original vocabulary ("default" ↔ the stored "" choice).
  const menuEffort = effortChoice === "" ? "default" : effortChoice;
  let triggerLabel = model === undefined ? "未配置模型" : model.name;
  if (phase === "loading") triggerLabel = "读取模型…";
  /** 「模型名 · 强度」：强度段只在该值真的取到时才渲染（不写占位假值）。 */
  const effortSegment = effort !== undefined && effort !== null && effort !== "" ? ` · ${effort}` : "";

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (open && pane === "models" && models.length > 4) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, pane, models.length]);

  const toggle = (): void => {
    setOpen((v) => !v);
    setPane("root");
    setQuery("");
  };

  const groups = React.useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const m of models) {
      if (query.trim() !== "" && !m.name.toLowerCase().includes(query.trim().toLowerCase())) continue;
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()];
  }, [query, models]);

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={effortSegment === "" ? triggerLabel : `模型 ${triggerLabel}，思考强度 ${effort ?? ""}`}
        title={
          effortSegment === ""
            ? undefined
            : effortChoice === ""
              ? `${triggerLabel} · ${effort ?? ""}（跟随模型配置的推理等级）`
              : `${triggerLabel} · ${effort ?? ""}（本任务选择的推理等级，随每条消息发送）`
        }
        data-effort-choice={effortChoice}
        onClick={toggle}
      >
        <span className={css.triggerLabel}>{triggerLabel}</span>
        {effortSegment === "" ? null : <span className={css.effort}>{effortSegment}</span>}
        <IconChevronRightOutlineRegular size={10} className={`${css.chevron} ${open ? css.chevronOpen : ""}`} />
      </button>

      {open ? (
        <div className={css.panel} role="menu">
          {pane !== "root" ? (
            <button
              type="button"
              className={css.back}
              onClick={() => {
                setPane("root");
                setQuery("");
              }}
            >
              <IconChevronLeftOutlineRegular size={12} />
              <span>{pane === "models" ? "模型" : "推理等级"}</span>
            </button>
          ) : null}

          {pane === "root" ? (
            <>
              <button type="button" className={css.row} onClick={() => setPane("models")}>
                <span className={css.rowLabel}>模型</span>
                <span className={css.rowValue}>{model === undefined ? "未配置模型" : model.name}</span>
                <IconChevronRightOutlineRegular size={12} className={css.rowChevron} />
              </button>
              {enableEffort ? (
                <button type="button" className={css.row} onClick={() => setPane("effort")}>
                  <span className={css.rowLabel}>推理等级</span>
                  <span className={css.rowValue}>{menuEffort === "default" ? "Default" : menuEffort}</span>
                  <IconChevronRightOutlineRegular size={12} className={css.rowChevron} />
                </button>
              ) : null}
            </>
          ) : null}

          {pane === "models" ? (
            <>
              {models.length > 4 ? (
                <div className={css.search}>
                  <IconSearchOutlineRegular size={13} />
                  <input
                    ref={searchRef}
                    className={css.searchInput}
                    placeholder="搜索模型…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              ) : null}
              <div className={css.list}>
                {groups.map(([provider, models]) => (
                  <div key={provider} className={css.group}>
                    <div className={css.groupTitle}>{provider}</div>
                    {models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={css.item}
                        onClick={() => {
                          choose(m.id);
                          onEffortChange?.("");
                          setPane("root");
                        }}
                      >
                        <span className={css.itemLabel}>{m.name}</span>
                        {m.id === modelId ? <IconCheckOutlineRegular size={13} className={css.check} /> : null}
                      </button>
                    ))}
                  </div>
                ))}
                {groups.length === 0 ? <div className={css.empty}>没有匹配的模型。</div> : null}
              </div>
            </>
          ) : null}

          {pane === "effort" ? (
            <div className={css.list}>
              {efforts.length === 0 ? (
                <div className={css.empty}>当前模型未提供推理等级。</div>
              ) : (
                efforts.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={css.item}
                    data-effort-option={e}
                    onClick={() => {
                      onEffortChange?.(e === "default" ? "" : e);
                      setPane("root");
                    }}
                  >
                    <span className={css.itemLabel}>{e === "default" ? "Default（提供方默认）" : e}</span>
                    {e === menuEffort ? <IconCheckOutlineRegular size={13} className={css.check} /> : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
