"use client";

/**
 * Model picker, mirroring `ui-model-selection/ModelSelect.tsx`:
 * the root menu is the 【模型 / 推理等级】row pair; each row drills into its own
 * list. The model list groups by provider, shows search above four entries and
 * checks the current choice; the effort list is the model's reasoning levels.
 */
import * as React from "react";
import {
  IconChevronRightOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconSearchOutlineRegular,
  IconCheckOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { ModelOption } from "@/v2/data/llm-map";
import css from "./ModelPicker.module.css";

const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Render the model menu.
 * @param props.models - options built from the configured profiles.
 * @param props.phase - adapter phase, so an empty menu can explain itself.
 */
export function ModelPicker({
  models,
  phase = "ready",
}: {
  models: readonly ModelOption[];
  phase?: "loading" | "ready" | "offline";
}): React.ReactNode {

  const [open, setOpen] = React.useState(false);
  const [pane, setPane] = React.useState<"root" | "models" | "effort">("root");
  const [query, setQuery] = React.useState("");
  const [modelId, setModelId] = React.useState(models[0]?.id ?? "");
  const [effort, setEffort] = React.useState<string>("default");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const model = models.find((m) => m.id === modelId) ?? models[0];
  const efforts = model === undefined ? [] : model.efforts.length > 0 ? EFFORTS : [];

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
  }, [open, pane]);

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
  }, [query]);

  return (
    <div className={css.root} ref={rootRef}>
      <button type="button" className={css.trigger} aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
        <span className={css.triggerLabel}>{model === undefined ? "未配置模型" : model.name}</span>
        <IconChevronRightOutlineRegular size={10} className={`${css.chevron} ${open ? css.chevronOpen : ""}`} />
      </button>

      {open ? (
        <div className={css.panel} role="menu">
          {pane !== "root" ? (
            <button type="button" className={css.back} onClick={() => { setPane("root"); setQuery(""); }}>
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
              <button type="button" className={css.row} onClick={() => setPane("effort")}>
                <span className={css.rowLabel}>推理等级</span>
                <span className={css.rowValue}>{effort === "default" ? "Default" : effort}</span>
                <IconChevronRightOutlineRegular size={12} className={css.rowChevron} />
              </button>
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
                          setModelId(m.id);
                          setEffort("default");
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
                    onClick={() => { setEffort(e); setPane("root"); }}
                  >
                    <span className={css.itemLabel}>{e === "default" ? "Default（提供方默认）" : e}</span>
                    {e === effort ? <IconCheckOutlineRegular size={13} className={css.check} /> : null}
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
