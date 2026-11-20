"use client";

/**
 * Global LLM retry policy editor: one row per backend layer, each with an
 * attempt count and a fixed retry interval. The draft only leaves this
 * component when the user presses 保存重试策略.
 */
import * as React from "react";

import type { LLMRetryPolicy } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { RETRY_LAYERS, useLlmRetryPolicy } from "@/v2/data/llm-retry";

import css from "./SettingsDialog.module.css";

/** Draft copy of the policy; numbers stay numbers so the API shape is unchanged. */
type PolicyDraft = LLMRetryPolicy;

/**
 * Render the retry/backoff rows for the LLM pool page.
 * @returns the editable layers, a hint line, and the save/reset actions.
 */
export function LlmRetrySection(): React.ReactNode {
  const state = useLlmRetryPolicy();
  const [draft, setDraft] = React.useState<PolicyDraft | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (state.policy !== null) setDraft(state.policy);
  }, [state.policy]);

  const patch = (key: keyof PolicyDraft, field: "attempts" | "interval_ms", raw: string): void => {
    const value = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(value)) return;
    setDraft((current) => {
      if (current === null) return current;
      return { ...current, [key]: { ...current[key], [field]: value } };
    });
  };

  if (state.phase === "loading") return <p className={css.pageLead}>读取重试策略…</p>;
  if (state.phase === "offline" || draft === null) {
    return <p className={css.pageLead}>未连接后端（读不到重试策略）</p>;
  }

  return (
    <>
      <h3 className={css.subTitle}>重试与退避</h3>
      <p className={css.pageLead}>
        来自 GET /llm/retry-policy。每层独立配置：次数 0 = 用内置默认、-1 = 关闭该层；间隔 0 = 用默认间隔，&gt;0 = 固定毫秒。
      </p>
      {RETRY_LAYERS.map((layer) => (
        <div key={layer.key} className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowLabel}>{layer.label}</div>
            <div className={css.rowHint}>{layer.hint}</div>
          </div>
          <div className={css.rowControl}>
            <span className={css.inlineRow}>
              <input
                className={css.numberInput}
                type="number"
                min={-1}
                step={1}
                aria-label={`${layer.label}次数`}
                value={draft[layer.key].attempts}
                disabled={saving}
                onChange={(event) => patch(layer.key, "attempts", event.currentTarget.value)}
              />
              <span className={css.rowHint}>次</span>
            </span>
            <span className={css.inlineRow}>
              <input
                className={css.numberInput}
                type="number"
                min={0}
                step={100}
                aria-label={`${layer.label}间隔（毫秒）`}
                value={draft[layer.key].interval_ms}
                disabled={saving}
                onChange={(event) => patch(layer.key, "interval_ms", event.currentTarget.value)}
              />
              <span className={css.rowHint}>ms</span>
            </span>
          </div>
        </div>
      ))}
      {failure === null ? null : <div className={css.serverError}>保存失败：{failure}</div>}
      <div className={css.cardActions}>
        <Button
          variant="outline"
          size="sm"
          disabled={saving || state.policy === null}
          onClick={() => {
            if (state.policy === null) return;
            setDraft(state.policy);
            setFailure(null);
          }}
        >
          放弃修改
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setFailure(null);
            void state
              .save(draft)
              .then((error) => setFailure(error))
              .finally(() => setSaving(false));
          }}
        >
          保存重试策略
        </Button>
      </div>
    </>
  );
}
