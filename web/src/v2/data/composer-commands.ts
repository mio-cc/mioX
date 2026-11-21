/**
 * Slash commands the composer executes itself (instead of sending the draft).
 *
 * `/plan` follows DSH `ui-plan` (`/plan`, `/plan <message>`, `/plan off`) and the
 * Codex/Claude Code entry of the same name; `/goal` follows the task-goal API
 * (`v2/data/goal.ts`): `/goal <objective>` sets or replaces the goal, and
 * `/goal pause|resume|clear` act on the current one. Parsing is pure; the
 * composer owns the side effects and the feedback.
 */

/** One row of the `/` menu. */
export interface CommandRow {
  readonly id: string;
  /** Inserted text when picked (the trailing space is added by the menu). */
  readonly label: string;
  readonly desc: string;
}

/** Rows contributed by this module, in menu order. */
export const PLAN_GOAL_COMMANDS: readonly CommandRow[] = [
  { id: "plan", label: "/plan", desc: "开启计划模式：先侦察并给出计划，批准后再执行；/plan <内容> 开启并发送" },
  { id: "plan-off", label: "/plan off", desc: "关闭计划模式" },
  { id: "goal", label: "/goal", desc: "设定持续推进的目标：/goal <目标>" },
  { id: "goal-control", label: "/goal pause", desc: "暂停 / 恢复 / 清除目标：/goal pause | resume | clear" },
];

/** A draft the composer handles locally. */
export type ParsedCommand =
  | { readonly kind: "plan-on"; readonly message: string }
  | { readonly kind: "plan-off" }
  | { readonly kind: "goal-set"; readonly objective: string }
  | { readonly kind: "goal-pause" }
  | { readonly kind: "goal-resume" }
  | { readonly kind: "goal-clear" }
  | { readonly kind: "goal-missing" };

const PLAN_OFF = new Set(["off", "关闭", "退出"]);
const GOAL_CLEAR = new Set(["clear", "off", "stop", "reset", "none", "cancel"]);

/**
 * Parse a draft into a local command.
 * @param draft - whole draft text.
 * @returns the command, or null when the draft is an ordinary message.
 */
export function parseComposerCommand(draft: string): ParsedCommand | null {
  const text = draft.trim();
  const match = /^\/(plan|goal)(?:\s+([\s\S]*))?$/i.exec(text);
  if (match === null) return null;
  const name = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();
  if (name === "plan") {
    if (PLAN_OFF.has(rest.toLowerCase())) return { kind: "plan-off" };
    return { kind: "plan-on", message: rest };
  }
  const word = rest.toLowerCase();
  if (rest === "") return { kind: "goal-missing" };
  if (word === "pause") return { kind: "goal-pause" };
  if (word === "resume") return { kind: "goal-resume" };
  if (GOAL_CLEAR.has(word)) return { kind: "goal-clear" };
  return { kind: "goal-set", objective: rest };
}
