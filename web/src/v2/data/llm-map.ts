/**
 * Project backend LLM profiles onto the picker's option view model.
 * Pure, so the mapping can be checked without a backend.
 */
import type { LLMProfile } from "@/lib/types";

export interface ModelOption {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly efforts: readonly string[];
}

const FALLBACK_EFFORTS = ["low", "medium", "high"] as const;

/**
 * Map profiles to picker options.
 *
 * The profile's own `reasoning_efforts` wins; otherwise a thinking-enabled
 * profile offers the common three levels, and a non-thinking one offers none.
 * @param profiles - configured profiles in server order.
 * @returns options for the model menu, default profile first.
 */
export function profilesToOptions(profiles: readonly LLMProfile[]): ModelOption[] {
  const rows = profiles.map((profile) => {
    const declared = (profile.reasoning_efforts ?? []).filter((effort) => effort !== "");
    const thinking = (profile.thinking_type ?? "") !== "none" && (profile.thinking_type ?? "") !== "";
    const efforts = declared.length > 0 ? declared : thinking ? [...FALLBACK_EFFORTS] : [];
    return {
      id: profile.id,
      name: profile.model !== "" ? profile.model : profile.name,
      provider: profile.name !== "" ? profile.name : profile.format,
      efforts,
    };
  });
  const defaultId = profiles.find((profile) => profile.is_default === true)?.id;
  if (defaultId === undefined) return rows;
  return [...rows.filter((row) => row.id === defaultId), ...rows.filter((row) => row.id !== defaultId)];
}

/**
 * 存储的思考强度字段（`LLMProfile.reasoning_effort`，"" = 不发送）→ 触发器文案。
 * 映射复用旧页 Composer 的 effortText（`app/(main)/function/tasks/detail/_composer/model-picker.tsx:48-62`）：
 * 空串读作「默认」（提供方默认档），未收录的值原样显示，不编造假档位。
 * @param value - profile 的 reasoning_effort 存储值。
 * @returns 中文强度文案。
 */
export function reasoningEffortLabel(value: string): string {
  const LABELS: Record<string, string> = {
    off: "关闭",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最大",
  };
  if (value === "") return "默认";
  return LABELS[value] ?? value;
}
