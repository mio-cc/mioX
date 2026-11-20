"use client";

/**
 * Per-profile fields the first settings pass left out: endpoint proxy, the
 * custom session header, rate limits, polling flags, streaming, the output-limit
 * field name, the thinking switch, and the three retry layers a single profile
 * can override.
 *
 * Every control is a staged draft: the editor's 保存 button writes once, so
 * opening the page never changes backend behavior. Field names and defaults
 * come from GET /llm/profiles (`LLMProfile` in lib/types.ts) and the write set
 * matches saveLLMProfile (`lib/api.ts:1078-1101`).
 *
 * `thinking_type` / `max_tokens_field` store "" for "send nothing", but a
 * Select needs a non-empty value, so an explicit `none` sentinel crosses that
 * boundary — the same conversion the old page used (`system/llm/page.tsx:47-51`).
 */
import * as React from "react";

import type { LLMRetryOverride } from "@/lib/types";
import { Switch } from "@/vendor/dsh/primitives/Switch";

import { SelectMenu } from "./SelectMenu";
import css from "./SettingsDialog.module.css";

/** Select value meaning "do not send this field" (stored as ""). */
export const NONE_OPTION = "none";

/** All-zero retry override: every layer follows the global policy. */
export const EMPTY_LLM_RETRY: LLMRetryOverride = {
  connect: { attempts: 0, interval_ms: 0 },
  empty: { attempts: 0, interval_ms: 0 },
  stream: { attempts: 0, interval_ms: 0 },
};

/** Stored thinking_type -> Select value. */
export function thinkingFromStore(value: string | undefined): string {
  return value === undefined || value === "" ? NONE_OPTION : value;
}

/** Select value -> stored thinking_type. */
export function thinkingToStore(value: string): string {
  return value === NONE_OPTION ? "" : value;
}

/** Stored max_tokens_field -> Select value. */
export function maxTokensFieldFromStore(value: string | undefined): string {
  return value === undefined || value === "" ? NONE_OPTION : value;
}

/** Select value -> stored max_tokens_field. */
export function maxTokensFieldToStore(value: string): string {
  return value === NONE_OPTION ? "" : value;
}

export const THINKING_OPTIONS = [
  { value: NONE_OPTION, label: "不发送（默认）" },
  { value: "disabled", label: "关闭" },
  { value: "enabled", label: "开启" },
] as const;

export const MAX_TOKENS_FIELD_OPTIONS = [
  { value: NONE_OPTION, label: "max_tokens（默认）" },
  { value: "max_completion_tokens", label: "max_completion_tokens" },
] as const;

/** Hints per API format, mirroring the old page (`system/llm/page.tsx:75-80`). */
export const MAX_TOKENS_FIELD_HINTS: Record<string, string> = {
  openai:
    "上限发哪个键。max_tokens 是默认，绝大多数兼容网关只认它；OpenAI 官方推理模型反过来只认 max_completion_tokens，收到 max_tokens 会报 unsupported_parameter。",
  anthropic: "仅 openai 格式可选。Anthropic 的字段名固定为 max_tokens。",
  "openai-responses": "仅 openai 格式可选。Responses API 的字段名固定为 max_output_tokens。",
};

/**
 * OpenCode Zen public free tier: no login, no issued key, the literal key `public`.
 * Copied from the old page's real preset (`app/(main)/system/llm/page.tsx:55-63`),
 * not sample data. It is not a default: only a click on 「OpenCode 公开免费」
 * prefills the add form, and nothing is written without 创建提供商.
 * `.tmp/r09-scan.mjs` S1 keeps a narrow whitelist for exactly this constant.
 */
export interface OpencodePublicPreset {
  name: string;
  format: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  sessionHeaderKey: string;
  contextWindowK: number;
}

export const OPENCODE_PUBLIC_PRESET: OpencodePublicPreset = {
  name: "OpenCode 公开免费",
  format: "openai",
  model: "space-bunny-free",
  baseUrl: "https://opencode.ai/zen/v1",
  apiKey: "public",
  sessionHeaderKey: "x-opencode-session",
  contextWindowK: 512,
};

/**
 * Accessor over {@link OPENCODE_PUBLIC_PRESET} for the add form's initializer.
 * It reads the constant above (scan-visible), it does not carry a hidden literal.
 * @returns the OpenCode public free tier values.
 */
export function opencodePublicPreset(): OpencodePublicPreset {
  return OPENCODE_PUBLIC_PRESET;
}

/** Retry override draft: three endpoint-scoped layers, all optional. */
export const RETRY_OVERRIDE_LAYERS = [
  { key: "connect", label: "建连重试", hint: "拿到 200 之前的连接重置 / 超时 / 429 / 5xx" },
  { key: "empty", label: "空响应重试", hint: "HTTP 200 但整条响应没有任何内容（仅 openai 格式）" },
  { key: "stream", label: "同 provider 安全窗口重试", hint: "流已建立但未交付任何 token 就断开" },
] as const;

/** The staged values this module owns; the editor keeps its own text fields. */
export interface ProfileExtraDraft {
  proxy: string;
  sessionHeaderKey: string;
  ratePerSecond: number;
  ratePerMinute: number;
  priority: number;
  poolExclude: boolean;
  streaming: boolean;
  thinkingType: string;
  maxTokensField: string;
  retry: LLMRetryOverride;
}

/**
 * Read the extra draft out of a stored profile.
 * @param profile - fields from GET /llm/profiles.
 * @returns the draft with defaults filled in.
 */
export function extraDraftFromProfile(profile: {
  proxy?: string;
  session_header_key?: string;
  rate_per_second: number;
  rate_per_minute: number;
  priority?: number;
  pool_exclude?: boolean;
  streaming?: boolean;
  thinking_type?: string;
  max_tokens_field?: string;
  retry?: LLMRetryOverride;
}): ProfileExtraDraft {
  return {
    proxy: profile.proxy ?? "",
    sessionHeaderKey: profile.session_header_key ?? "",
    ratePerSecond: profile.rate_per_second,
    ratePerMinute: profile.rate_per_minute,
    priority: profile.priority ?? 0,
    poolExclude: profile.pool_exclude === true,
    streaming: profile.streaming !== false,
    thinkingType: thinkingFromStore(profile.thinking_type),
    maxTokensField: maxTokensFieldFromStore(profile.max_tokens_field),
    retry: profile.retry ?? EMPTY_LLM_RETRY,
  };
}

/** Controlled numeric input that keeps half-typed text local to the field. */
function RuleNum({
  id,
  value,
  onChange,
  placeholder,
  min,
  disabled,
  label,
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
  placeholder: string;
  min: number;
  disabled: boolean;
  label: string;
}): React.ReactNode {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // Adopt a value that arrived from outside (profile reload, revert) without
  // overwriting what is being typed: only replace when the parse disagrees.
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((current) => (Number(current === "" ? 0 : current) === value ? current : incoming));
  }, [value]);
  return (
    <input
      id={id}
      className={css.numberInput}
      type="number"
      min={min}
      step={1}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setText(raw);
        const parsed = Number(raw);
        onChange(raw.trim() === "" || !Number.isFinite(parsed) ? 0 : Math.trunc(parsed));
      }}
    />
  );
}

/**
 * The proxy / limits / polling / streaming / thinking / retry fields of one
 * profile. Rendered inside the editor's 高级设置 block.
 * @param props.value - staged draft values.
 * @param props.onChange - receives a partial patch for the fields it owns.
 * @param props.disabled - true while a write or probe is in flight.
 * @param props.format - current API format, decides the output-limit field hint.
 * @param props.uid - prefix that keeps label htmlFor ids unique on the page.
 * @returns the extra rows.
 */
export function ModelProfileExtraFields({
  value,
  onChange,
  disabled,
  format,
  uid,
}: {
  value: ProfileExtraDraft;
  onChange: (patch: Partial<ProfileExtraDraft>) => void;
  disabled: boolean;
  format: string;
  uid: string;
}): React.ReactNode {
  const patchRetry = (layer: keyof LLMRetryOverride, patch: Partial<LLMRetryOverride["connect"]>): void => {
    onChange({ retry: { ...value.retry, [layer]: { ...value.retry[layer], ...patch } } });
  };

  return (
    <>
      <label className={css.fieldLabel} htmlFor={`${uid}-proxy`}>代理</label>
      <input
        id={`${uid}-proxy`}
        className={css.textField}
        value={value.proxy}
        placeholder="socks5://user:pass@127.0.0.1:1080"
        aria-label="代理"
        disabled={disabled}
        onChange={(event) => onChange({ proxy: event.currentTarget.value })}
      />
      <p className={css.fieldHint}>
        仅该配置的 LLM 出站请求走此代理，支持 http/https/socks5（可带账号密码，特殊字符需 URL 编码）；留空 = 直连。
      </p>

      <label className={css.fieldLabel} htmlFor={`${uid}-session-header`}>自定义会话头</label>
      <input
        id={`${uid}-session-header`}
        className={css.textField}
        value={value.sessionHeaderKey}
        placeholder="如 x-session-id（留空 = 不发送）"
        aria-label="自定义会话头"
        disabled={disabled}
        onChange={(event) => onChange({ sessionHeaderKey: event.currentTarget.value })}
      />
      <p className={css.fieldHint}>
        填头名后每次请求都带该 HTTP 头，头值为当前会话的 session id（chat 如 conv-12、worker 如 exp3-worker-i87），用于按 session-id 做提示缓存 / 粘性路由；留空则不发送。
      </p>

      <div className={css.modelGrid}>
        <label className={css.modelField} htmlFor={`${uid}-rps`}>
          <span>每秒限速</span>
          <RuleNum
            id={`${uid}-rps`}
            min={0}
            value={value.ratePerSecond}
            placeholder="0"
            disabled={disabled}
            label="每秒限速"
            onChange={(next) => onChange({ ratePerSecond: next })}
          />
        </label>
        <label className={css.modelField} htmlFor={`${uid}-rpm`}>
          <span>每分钟限速</span>
          <RuleNum
            id={`${uid}-rpm`}
            min={0}
            value={value.ratePerMinute}
            placeholder="0"
            disabled={disabled}
            label="每分钟限速"
            onChange={(next) => onChange({ ratePerMinute: next })}
          />
        </label>
      </div>
      <p className={css.fieldHint}>限速 0 = 不限，全 Agent 共享该配置的配额。</p>

      <div className={css.modelGrid}>
        <label className={css.modelField} htmlFor={`${uid}-priority`}>
          <span>轮询优先级</span>
          <RuleNum
            id={`${uid}-priority`}
            min={0}
            value={value.priority}
            placeholder="0"
            disabled={disabled}
            label="轮询优先级"
            onChange={(next) => onChange({ priority: next })}
          />
        </label>
      </div>
      <p className={css.fieldHint}>
        数字越大越先被选中；当前生效配置恒为第 1 顺位，与本值无关。相同优先级会轮流打头，天然分摊额度。
      </p>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowLabel}>不参与轮询</div>
          <div className={css.rowHint}>开启后不会被当作故障转移目标；仍可被 Agent / 任务显式指定使用。</div>
        </div>
        <div className={css.rowControl}>
          <Switch
            checked={value.poolExclude}
            label="不参与轮询"
            disabled={disabled}
            onChange={(next) => onChange({ poolExclude: next })}
          />
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowLabel}>流式输出</div>
          <div className={css.rowHint}>
            开启（默认）走流式 SSE，有运行中实时进度与 token 计数；关闭走真·非流式（一次性返回），可绕开糟糕的 SSE 实现。
          </div>
        </div>
        <div className={css.rowControl}>
          <Switch
            checked={value.streaming}
            label="流式输出"
            disabled={disabled}
            onChange={(next) => onChange({ streaming: next })}
          />
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowLabel}>思考开关（thinking.type）</div>
          <div className={css.rowHint}>
            控制是否发送 thinking 字段。不发送 = 不带该字段（兼容不支持它的模型）；关闭 = 发 disabled；开启 = 发 enabled。
          </div>
        </div>
        <div className={css.rowControl}>
          <SelectMenu
            id={`${uid}-thinking`}
            value={value.thinkingType}
            onChange={(next) => onChange({ thinkingType: next })}
            options={THINKING_OPTIONS}
            disabled={disabled}
            ariaLabel="思考开关"
          />
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowLabel}>上限字段名</div>
          <div className={css.rowHint}>{MAX_TOKENS_FIELD_HINTS[format] ?? MAX_TOKENS_FIELD_HINTS.openai}</div>
        </div>
        <div className={css.rowControl}>
          <SelectMenu
            id={`${uid}-max-tokens-field`}
            value={format === "openai" ? value.maxTokensField : NONE_OPTION}
            onChange={(next) => onChange({ maxTokensField: next })}
            options={MAX_TOKENS_FIELD_OPTIONS}
            disabled={disabled || format !== "openai"}
            ariaLabel="上限字段名"
          />
        </div>
      </div>

      <div className={css.reasonRow}>
        <span className={css.typeLabel}>重试覆盖</span>
        <span className={css.fieldHint}>
          只对该配置生效，覆盖「重试与退避」的全局默认：次数 0 = 跟随全局、-1 = 关闭该层；间隔 0 = 指数退避。
        </span>
      </div>
      {RETRY_OVERRIDE_LAYERS.map((layer) => (
        <div key={layer.key} className={css.modelField}>
          <span>{layer.label}</span>
          <span className={css.inlineRow}>
            <RuleNum
              id={`${uid}-retry-${layer.key}-n`}
              min={-1}
              value={value.retry[layer.key].attempts}
              placeholder="0"
              disabled={disabled}
              label={`本配置${layer.label}次数`}
              onChange={(next) => patchRetry(layer.key, { attempts: next })}
            />
            <span className={css.unit}>次</span>
            <RuleNum
              id={`${uid}-retry-${layer.key}-ms`}
              min={0}
              value={value.retry[layer.key].interval_ms}
              placeholder="0"
              disabled={disabled}
              label={`本配置${layer.label}间隔（毫秒）`}
              onChange={(next) => patchRetry(layer.key, { interval_ms: next })}
            />
            <span className={css.unit}>ms</span>
          </span>
          <span className={css.fieldHint}>{layer.hint}</span>
        </div>
      ))}
    </>
  );
}
