"use client";

/**
 * "添加模型提供商" flow for the models page.
 *
 * ARTEX stores one provider+model per profile, so this form is the single
 * creation path: it writes a new LLM profile through the adapter, and the
 * catalog button asks the configured endpoint for its real model list.
 * Neither write happens without an explicit press.
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";

import { fetchLlmModels, saveLlmProfile } from "@/v2/data/llm-profiles";

import { opencodePublicPreset } from "./ModelProfileFields";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";

const FORMATS = [
  { value: "openai", label: "OpenAI Chat Completions" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "openai-responses", label: "OpenAI Responses" },
] as const;

/**
 * Render the provider form.
 * @param preset - true prefills the OpenCode public free tier (key `public`);
 * the values still only reach the backend on 创建提供商.
 * @param onCreated - called after the backend stored the new profile.
 * @param onCancel - called when the user backs out without writing.
 * @returns the form card and its actions.
 */
export function ModelsAddProvider({
  preset = false,
  onCreated,
  onCancel,
}: {
  preset?: boolean;
  onCreated: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const prefill = preset ? opencodePublicPreset() : null;
  const [name, setName] = React.useState(prefill === null ? "" : prefill.name);
  const [baseUrl, setBaseUrl] = React.useState(prefill === null ? "" : prefill.baseUrl);
  const [format, setFormat] = React.useState<string>(prefill === null ? "openai" : prefill.format);
  const [apiKey, setApiKey] = React.useState(prefill === null ? "" : prefill.apiKey);
  const [model, setModel] = React.useState(prefill === null ? "" : prefill.model);
  const [catalog, setCatalog] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState<"fetch" | "create" | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const fail = (reason: unknown): void => setFailure(reason instanceof Error ? reason.message : String(reason));

  /** POST /llm/models: the endpoint is asked for its own catalog (network call). */
  const loadCatalog = (): void => {
    setBusy("fetch");
    setFailure(null);
    void fetchLlmModels(format, baseUrl, apiKey)
      .then((result) => {
        if (!result.ok) {
          setCatalog([]);
          setFailure(result.error ?? "获取可用模型失败");
          return;
        }
        setCatalog(result.models);
        if (result.models.length === 0) setFailure("该端点没有返回任何模型");
      })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const create = (): void => {
    if (name.trim() === "") {
      setFailure("Provider ID 不能为空。");
      return;
    }
    if (model.trim() === "") {
      setFailure("模型 ID 不能为空（可先「获取可用模型」再选一个）。");
      return;
    }
    setBusy("create");
    setFailure(null);
    void saveLlmProfile({
      name: name.trim(),
      format,
      model: model.trim(),
      base_url: baseUrl.trim(),
      api_key: apiKey,
      ...(prefill === null
        ? {}
        : {
            context_window_k: prefill.contextWindowK,
            session_header_key: prefill.sessionHeaderKey,
          }),
    })
      .then(() => {
        toast(prefill === null ? "已创建模型提供商" : "已创建 OpenCode 公开免费配置");
        onCreated();
      })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const locked = busy !== null;

  return (
    <>
      <h2 className={css.pageTitle}>模型</h2>
      <p className={css.pageLead}>添加模型提供商</p>
      {prefill === null ? null : (
        <p className={css.fieldHint}>
          已预填 OpenCode 公开免费 API：模型 {prefill.model}、Key=public、地址 {prefill.baseUrl}、会话头{" "}
          {prefill.sessionHeaderKey}；点「创建提供商」才会写入。
        </p>
      )}

      <div className={css.modelCard}>
        <label className={css.fieldLabel} htmlFor={`${uid}-provider`}>Provider ID</label>
        <input
          id={`${uid}-provider`}
          className={css.textField}
          value={name}
          placeholder="acme-gateway"
          aria-label="Provider ID"
          disabled={locked}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <p className={css.fieldHint}>该配置的唯一标识（不能与已有配置同名）；只用于区分配置，不写入模型请求。</p>

        <label className={css.fieldLabel} htmlFor={`${uid}-base-url`}>API 地址</label>
        <input
          id={`${uid}-base-url`}
          className={css.textField}
          value={baseUrl}
          placeholder="https://gateway.example/v1"
          aria-label="API 地址"
          disabled={locked}
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
        />

        <label className={css.fieldLabel} htmlFor={`${uid}-format`}>API 协议</label>
        <SelectMenu id={`${uid}-format`} value={format} onChange={setFormat} options={FORMATS} disabled={locked} />

        <label className={css.fieldLabel} htmlFor={`${uid}-key`}>API 密钥</label>
        <input
          id={`${uid}-key`}
          className={css.textField}
          type="password"
          autoComplete="new-password"
          value={apiKey}
          placeholder="输入 API 密钥"
          aria-label="API 密钥"
          disabled={locked}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />

        <div className={css.catalogRow}>
          <span className={css.fieldLabel}>模型目录</span>
          <button type="button" className={css.linkBtn} disabled={locked || baseUrl.trim() === ""} onClick={loadCatalog}>
            获取可用模型
          </button>
        </div>
        <div className={css.modelList}>
          {catalog === null ? (
            <div className={css.catalogEmpty}>尚未获取：填入 API 地址后点「获取可用模型」，或直接填写模型 ID。</div>
          ) : null}
          {catalog !== null && catalog.length === 0 ? (
            <div className={css.catalogEmpty}>该端点没有返回模型；目录外 ID 仍可直接填写。</div>
          ) : null}
          {(catalog ?? []).map((id) => (
            <button
              key={id}
              type="button"
              className={css.linkBtn}
              aria-label={`选用模型 ${id}`}
              disabled={locked}
              onClick={() => setModel(id)}
            >
              {id}
            </button>
          ))}
        </div>

        <label className={css.fieldLabel} htmlFor={`${uid}-model-id`}>模型 ID</label>
        <input
          id={`${uid}-model-id`}
          className={css.textField}
          value={model}
          placeholder="模型 ID"
          aria-label="模型 ID"
          disabled={locked}
          onChange={(event) => setModel(event.currentTarget.value)}
        />

        {failure === null ? null : <div className={css.serverError}>{failure}</div>}

        <div className={css.cardActions}>
          <Button variant="outline" size="sm" disabled={locked} onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={locked} onClick={create}>
            创建提供商
          </Button>
        </div>
      </div>
    </>
  );
}
