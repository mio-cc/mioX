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
