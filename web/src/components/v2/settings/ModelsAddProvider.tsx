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

import {
  Card,
  Editor,
  EditorActions,
  EditorGroup,
  Field,
  FieldGrid,
  Notice,
  PageHead,
  SettingsPage as KitSettingsPage,
  TextInput,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";

import { saveLlmProfile } from "@/v2/data/llm-profiles";

import { ModelIdField } from "./ModelIdField";
import { opencodePublicPreset } from "./ModelProfileFields";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";

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
  const [busy, setBusy] = React.useState<"create" | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const fail = (reason: unknown): void => setFailure(reason instanceof Error ? reason.message : String(reason));

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
    <KitSettingsPage data={{ "data-models-add-form": prefill === null ? "custom" : "opencode" }}>
      <PageHead
        title="添加模型提供商"
        lead={
          prefill === null
            ? "填写端点与密钥，获取可用模型后选一个；点「创建提供商」才会写入。"
            : `已预填 OpenCode 公开免费 API（Key=public、会话头 ${prefill.sessionHeaderKey}）；点「创建提供商」才会写入。`
        }
        actions={
          <Button variant="ghost" size="sm" disabled={locked} onClick={onCancel}>
            返回
          </Button>
        }
      />
      <Card>
        <Editor inCard>
          <EditorGroup title="连接">
            <FieldGrid>
              <Field label="Provider ID" htmlFor={`${uid}-provider`} hint="唯一标识（不能与已有配置同名），只用于区分配置。">
                <TextInput
                  id={`${uid}-provider`}
                  value={name}
                  placeholder="acme-gateway"
                  aria-label="Provider ID"
                  disabled={locked}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </Field>
              <Field label="API 协议" htmlFor={`${uid}-format`}>
                <SelectMenu id={`${uid}-format`} value={format} onChange={setFormat} options={FORMATS} disabled={locked} />
              </Field>
              <Field label="API 地址" htmlFor={`${uid}-base-url`} span>
                <TextInput
                  id={`${uid}-base-url`}
                  mono
                  value={baseUrl}
                  placeholder="https://gateway.example/v1"
                  aria-label="API 地址"
                  disabled={locked}
                  onChange={(event) => setBaseUrl(event.currentTarget.value)}
                />
              </Field>
              <Field label="API 密钥" htmlFor={`${uid}-key`} span>
                <TextInput
                  id={`${uid}-key`}
                  mono
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  placeholder="输入 API 密钥"
                  aria-label="API 密钥"
                  disabled={locked}
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                />
              </Field>
              <Field
                label="模型"
                htmlFor={`${uid}-model-id`}
                span
                hint="填好地址与密钥后「获取模型」，或直接输入模型 ID。"
              >
                <ModelIdField
                  id={`${uid}-model-id`}
                  value={model}
                  onChange={setModel}
                  format={format}
                  baseUrl={baseUrl}
                  apiKey={apiKey}
                  disabled={locked}
                />
              </Field>
            </FieldGrid>
          </EditorGroup>
          {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
          <EditorActions>
            <Button variant="ghost" size="sm" disabled={locked} onClick={onCancel}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={locked} onClick={create} data-models-create="">
              {busy === "create" ? "创建中…" : "创建提供商"}
            </Button>
          </EditorActions>
        </Editor>
      </Card>
    </KitSettingsPage>
  );
}
