"use client";

/**
 * Global LLM retry policy editor: one row per backend layer, each with an
 * attempt count and a fixed retry interval. The draft only leaves this
 * component when the user presses 保存重试策略.
 *
 * D3 layout: a kit Section whose card is a three-column grid table
 * (layer · attempts · interval) with the save bar under it.
 */
import * as React from "react";

import type { LLMRetryPolicy } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Card, kit, Notice, Section, Skeleton, UnitInput } from "@/components/v2/design/Kit";
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

  const dirty = draft !== null && state.policy !== null && JSON.stringify(draft) !== JSON.stringify(state.policy);

  return (
    <Section
      title="重试与退避"
      hint="次数 0 = 内置默认、-1 = 关闭该层；间隔 0 = 默认，>0 = 固定毫秒"
      data={{ "data-settings-retry": "" }}
    >
      {state.phase === "loading" ? (
        <Card>
          <Skeleton label="读取重试策略" />
        </Card>
      ) : null}
      {state.phase === "offline" || (state.phase !== "loading" && draft === null) ? (
        <Notice tone="danger">未连接后端（读不到重试策略）</Notice>
      ) : null}
      {draft === null ? null : (
        <>
          <Card>
            <div className={css.retryTable} role="table" aria-label="全局重试策略" data-flat="">
              <div className={css.retryHead} role="row">
                <span role="columnheader">层</span>
                <span role="columnheader">次数</span>
                <span role="columnheader">间隔</span>
              </div>
              {RETRY_LAYERS.map((layer) => (
                <div key={layer.key} className={css.retryRow} role="row" data-retry-layer={layer.key}>
                  <span className={css.retryLayer} role="cell">
                    <span className={css.retryLayerName}>{layer.label}</span>
                    <span className={css.retryLayerHint} title={layer.hint}>
                      {layer.hint}
                    </span>
                  </span>
                  <span role="cell">
                    <UnitInput unit="次">
                      <input
                        className={`${kit.input} ${css.numberInputKit}`}
                        type="number"
                        min={-1}
                        step={1}
                        aria-label={`${layer.label}次数`}
                        value={draft[layer.key].attempts}
                        disabled={saving}
                        onChange={(event) => patch(layer.key, "attempts", event.currentTarget.value)}
                      />
                    </UnitInput>
                  </span>
                  <span role="cell">
                    <UnitInput unit="ms">
                      <input
                        className={`${kit.input} ${css.numberInputKit}`}
                        type="number"
                        min={0}
                        step={100}
                        aria-label={`${layer.label}间隔（毫秒）`}
                        value={draft[layer.key].interval_ms}
                        disabled={saving}
                        onChange={(event) => patch(layer.key, "interval_ms", event.currentTarget.value)}
                      />
                    </UnitInput>
                  </span>
                </div>
              ))}
            </div>
          </Card>
          {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}
          <div className={kit.editorActions}>
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || state.policy === null || !dirty}
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
              disabled={saving || !dirty}
              onClick={() => {
                setSaving(true);
                setFailure(null);
                void state
                  .save(draft)
                  .then((error) => setFailure(error))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? "保存中…" : "保存重试策略"}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
