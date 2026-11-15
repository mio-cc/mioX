"use client";

/**
 * Appearance preferences owned by the settings dialog (font size level + code
 * font family).
 *
 * The existing preference pipeline (`lib/preferences/*` + `stores/preferences/*`)
 * owns theme mode/preset and the body font key; it has no font-size or code-font
 * knob, so this module extends the same *token* contract instead of inventing a
 * parallel one: the chosen values are written onto `<html>` as inline custom
 * properties (`--ax-font-size-*`, `--ax-font-family-code`) — exactly the tokens
 * `styles/tokens.css` declares and every shell stylesheet consumes — plus a
 * `data-*` attribute that mirrors the choice for CSS/QA. Values persist in
 * localStorage (non-layout preference, same persistence class as the other
 * non-critical keys) and are re-applied on mount so a reload keeps them.
 */

/** Font-size levels, mapped onto the `--ax-font-size-*` token set. */
export const FONT_SIZE_LEVELS = [
  { id: "compact", label: "小", detail: "正文 13px" },
  { id: "default", label: "标准", detail: "正文 14px" },
  { id: "comfortable", label: "大", detail: "正文 16px" },
] as const;

export type FontSizeLevel = (typeof FONT_SIZE_LEVELS)[number]["id"];

/** `--ax-font-size-*` / `--ax-line-height-*` values for one level. */
type FontSizeTokens = Readonly<Record<string, string>>;

const FONT_SIZE_TOKENS: Readonly<Record<FontSizeLevel, FontSizeTokens>> = {
  compact: {
    "--ax-font-size-body": "13px",
    "--ax-line-height-body": "22px",
    "--ax-font-size-secondary": "12px",
    "--ax-line-height-secondary": "18px",
    "--ax-font-size-caption": "11px",
    "--ax-line-height-caption": "16px",
    "--ax-font-size-code": "11px",
    "--ax-line-height-code": "17px",
    "--ax-font-size-code-block": "10px",
  },
  default: {
    "--ax-font-size-body": "14px",
    "--ax-line-height-body": "24px",
    "--ax-font-size-secondary": "13px",
    "--ax-line-height-secondary": "20px",
    "--ax-font-size-caption": "12px",
    "--ax-line-height-caption": "18px",
    "--ax-font-size-code": "12px",
    "--ax-line-height-code": "19px",
    "--ax-font-size-code-block": "11px",
  },
  comfortable: {
    "--ax-font-size-body": "16px",
    "--ax-line-height-body": "26px",
    "--ax-font-size-secondary": "15px",
    "--ax-line-height-secondary": "22px",
    "--ax-font-size-caption": "13px",
    "--ax-line-height-caption": "20px",
    "--ax-font-size-code": "13px",
    "--ax-line-height-code": "20px",
    "--ax-font-size-code-block": "12px",
  },
};

/** Monospace families offered for code blocks; `system` keeps the built-in stack. */
export const CODE_FONT_OPTIONS = [
  { id: "system", label: "系统等宽", stack: "" },
  { id: "consolas", label: "Consolas", stack: 'Consolas, "SF Mono", ui-monospace, monospace' },
  {
    id: "jetbrains",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", "Fira Code", Consolas, ui-monospace, monospace',
  },
  { id: "fira", label: "Fira Code", stack: '"Fira Code", "JetBrains Mono", Consolas, ui-monospace, monospace' },
] as const;

export type CodeFontId = (typeof CODE_FONT_OPTIONS)[number]["id"];

/** Defaults mirror `tokens.css`, so an untouched install renders identically. */
export const DEFAULT_FONT_SIZE: FontSizeLevel = "default";
export const DEFAULT_CODE_FONT: CodeFontId = "system";

const STORAGE_FONT_SIZE = "miox.settings.font_size";
const STORAGE_CODE_FONT = "miox.settings.code_font";

/** Mirror attributes on `<html>`; CSS and QA both read them. */
export const FONT_SIZE_ATTR = "data-font-size";
export const CODE_FONT_ATTR = "data-code-font";

/** Built-in code stack from `tokens.css`, restored when the choice is `system`. */
const BUILTIN_CODE_STACK =
  '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: the choice still applies for this session.
  }
}

function isFontSizeLevel(value: string | null): value is FontSizeLevel {
  return FONT_SIZE_LEVELS.some((option) => option.id === value);
}

function isCodeFontId(value: string | null): value is CodeFontId {
  return CODE_FONT_OPTIONS.some((option) => option.id === value);
}

/** Apply one font-size level to `<html>` (inline tokens + mirror attribute). */
export function applyFontSize(level: FontSizeLevel): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(FONT_SIZE_TOKENS[level])) {
    root.style.setProperty(token, value);
  }
  root.setAttribute(FONT_SIZE_ATTR, level);
}

/** Apply one code font to `<html>` (inline token + mirror attribute). */
export function applyCodeFont(id: CodeFontId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const option = CODE_FONT_OPTIONS.find((entry) => entry.id === id) ?? CODE_FONT_OPTIONS[0];
  root.style.setProperty("--ax-font-family-code", option.stack || BUILTIN_CODE_STACK);
  root.setAttribute(CODE_FONT_ATTR, option.id);
}

/** Persist the font-size level (localStorage; survives reload). */
export function persistFontSize(level: FontSizeLevel): void {
  writeStored(STORAGE_FONT_SIZE, level);
}

/** Persist the code font choice (localStorage; survives reload). */
export function persistCodeFont(id: CodeFontId): void {
  writeStored(STORAGE_CODE_FONT, id);
}

/** Read the stored font-size level, falling back to the token default. */
export function readFontSize(): FontSizeLevel {
  const stored = readStored(STORAGE_FONT_SIZE);
  return isFontSizeLevel(stored) ? stored : DEFAULT_FONT_SIZE;
}

/** Read the stored code font, falling back to the built-in stack. */
export function readCodeFont(): CodeFontId {
  const stored = readStored(STORAGE_CODE_FONT);
  return isCodeFontId(stored) ? stored : DEFAULT_CODE_FONT;
}

/**
 * Re-apply both stored appearance choices. Called once when the shell mounts so
 * a reload restores the previous session's choices before the dialog is opened.
 */
export function applyStoredAppearance(): void {
  applyFontSize(readFontSize());
  applyCodeFont(readCodeFont());
}
