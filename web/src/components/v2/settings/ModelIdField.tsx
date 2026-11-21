"use client";

/**
 * 模型 ID 输入 + 「获取可用模型」目录（编辑与新增两处共用）。
 *
 * 旧页依据：`app/(main)/system/llm/page.tsx:452-526`——打开编辑器时先读本地记忆的
 * 模型目录（`lib/llm-model-cache.ts`，按 协议 + Base URL 分键），已存配置或已填 Key
 * 时静默刷新一次；手动「获取」会向端点请求真实目录（POST /llm/models，会把 Key
 * 发给该端点）。编辑已存配置时传 profileId，Key 留空即复用已存的 Key。
 *
 * 交互：输入框右侧是「获取模型」按钮；目录拉到后在输入框下方展开可搜索的列表，
 * 点一项即填入；列表头显示数量与记忆时间、可清除记忆。
 */
import * as React from "react";

import { clearLLMModelCache, formatModelCacheTime, loadLLMModelCache, saveLLMModelCache } from "@/lib/llm-model-cache";
import { kit, TextInput } from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconCheckOutlineRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { fetchLlmModels } from "@/v2/data/llm-profiles";

import css from "./SettingsDialog.module.css";

export interface ModelIdFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** API 协议（openai / anthropic / openai-responses）。 */
  format: string;
  baseUrl: string;
  /** 正在输入的 Key；空 + profileId = 复用已存的 Key。 */
  apiKey: string;
  proxy?: string;
  /** 已存配置的 id（编辑时）。 */
  profileId?: number;
  disabled?: boolean;
  /** 打开时若能取到（已存配置 / 已填 Key）就静默刷新一次目录。 */
  autoFetch?: boolean;
}

/**
 * 渲染模型 ID 字段与目录。
 * @returns 输入框 + 获取按钮 + 可展开目录。
 */
export function ModelIdField({
  id,
  value,
  onChange,
  format,
  baseUrl,
  apiKey,
  proxy = "",
  profileId,
  disabled = false,
  autoFetch = true,
}: ModelIdFieldProps): React.ReactNode {
  const [models, setModels] = React.useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const autoKey = React.useRef<string>("");

  const canFetch = profileId !== undefined || apiKey.trim() !== "" || baseUrl.trim() !== "";

  const load = React.useCallback(
    async (silent: boolean): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchLlmModels(format, baseUrl, apiKey, proxy, profileId);
        if (result.ok && result.models.length > 0) {
          const cached = saveLLMModelCache(format, baseUrl, result.models);
          setModels(cached?.models ?? [...result.models].sort((a, b) => a.localeCompare(b)));
          setUpdatedAt(cached?.updatedAt ?? Date.now());
          if (!silent) setOpen(true);
          return;
        }
        const message = result.error ?? (result.ok ? "端点返回了空模型列表" : "未获取到模型");
        if (!silent) setError(message);
      } catch (reason) {
        if (!silent) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setLoading(false);
      }
    },
    [format, baseUrl, apiKey, proxy, profileId],
  );

  // Endpoint changed: show the remembered list first, then refresh quietly once
  // when credentials are available (old page :483-500).
  React.useEffect(() => {
    const cached = loadLLMModelCache(format, baseUrl);
    setModels(cached?.models ?? []);
    setUpdatedAt(cached?.updatedAt ?? null);
    setError(null);
    if (!autoFetch) return undefined;
    const key = `${format}|${baseUrl}|${apiKey}|${profileId ?? ""}`;
    const credentialed = profileId !== undefined || apiKey.trim() !== "";
    if (!credentialed || baseUrl.trim() === "" || autoKey.current === key) return undefined;
    // Mark the endpoint as fetched only when the request actually starts: React
    // StrictMode runs this effect twice and the first run's timer is cleared, so
    // marking up front would make the second run skip the fetch entirely.
    const timer = window.setTimeout(() => {
      autoKey.current = key;
      void load(true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [format, baseUrl, apiKey, profileId, autoFetch, load]);

  const query = filter.trim().toLowerCase();
  const visible = query === "" ? models : models.filter((item) => item.toLowerCase().includes(query));

  return (
    <div className={css.modelIdField} data-model-id-field="">
      <div className={css.inlineSave}>
        <TextInput
          id={id}
          mono
          value={value}
          placeholder={models.length > 0 ? `从 ${models.length} 个可用模型中选择或直接输入` : "模型 ID"}
          aria-label="模型 ID"
          disabled={disabled}
          onFocus={() => {
            if (models.length > 0) setOpen(true);
          }}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={disabled || loading || !canFetch}
          title={canFetch ? "向该端点请求可用模型列表（会使用此 Key）" : "先填写 API 地址或 Key"}
          data-model-fetch=""
          onClick={() => void load(false)}
        >
          {loading ? "获取中…" : models.length > 0 ? "刷新模型" : "获取模型"}
        </Button>
      </div>
      {error === null ? null : <p className={css.inlineError}>获取失败：{error}</p>}
      {models.length > 0 && !open ? (
        <button type="button" className={css.catalogToggle} onClick={() => setOpen(true)} disabled={disabled}>
          {models.length} 个可用模型{updatedAt === null ? "" : ` · 记忆于 ${formatModelCacheTime(updatedAt)}`} · 展开选择
        </button>
      ) : null}
      {open && models.length > 0 ? (
        <div className={css.catalog} data-model-catalog={models.length}>
          <div className={css.catalogHead}>
            <input
              className={`${kit.input} ${css.catalogSearch}`}
              value={filter}
              placeholder={`搜索 ${models.length} 个模型`}
              aria-label="搜索模型"
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
            <button
              type="button"
              className={css.catalogLink}
              onClick={() => {
                clearLLMModelCache(format, baseUrl);
                setModels([]);
                setUpdatedAt(null);
                setFilter("");
                setOpen(false);
              }}
            >
              清除记忆
            </button>
            <button type="button" className={css.catalogLink} onClick={() => setOpen(false)}>
              收起
            </button>
          </div>
          <ul className={css.catalogList} role="listbox" aria-label="可用模型">
            {visible.length === 0 ? <li className={css.catalogNone}>没有匹配「{filter}」的模型，可直接在上方输入。</li> : null}
            {visible.slice(0, 300).map((item) => {
              const selected = item === value;
              return (
                <li key={item}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? `${css.catalogItem} ${css.catalogItemOn}` : css.catalogItem}
                    disabled={disabled}
                    data-model-option={item}
                    onClick={() => {
                      onChange(item);
                      setOpen(false);
                      setFilter("");
                    }}
                  >
                    <span className={kit.mono}>{item}</span>
                    {selected ? <IconCheckOutlineRegular size={13} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length > 300 ? <p className={css.catalogNone}>仅显示前 300 个，输入关键字缩小范围。</p> : null}
        </div>
      ) : null}
    </div>
  );
}
