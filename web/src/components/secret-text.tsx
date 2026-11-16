/**
 * 凭据的显示组件：画出掩码版，原文一个字符都不动。
 *
 * 对照 DSH `@deepseek-ai/dsh-client-ui-secret-mask/client/SecretText.tsx`：
 * - `:23-27` —— "Split the masked form into kept text and mask runs. Mask runs keep
 *   their characters for copying and assistive technology but draw centered marks,
 *   because a font's own asterisk sits near the cap height."（掩码段保留字符、画居中 mark）
 * - `:28-38` —— `MaskedText`：按 `\*+` 把掩码串切成"保留文本 + 掩码段"。
 * - `:49-51` —— "Holding the revealed value instead of a flag re-masks a different
 *   credential that reuses this element."（存展开的那一段，而不是布尔）
 * - `:52-67` —— 外层 `data-secret`，`aria-pressed` + 眼睛图标切换。
 *
 * 与 DSH 的差别：DSH 的展开按钮是文本插件注册的 UserText 节点渲染器，我们这里是
 * 普通 React 组件，调用方直接把原文交进来。原文只留在 React state 里，不落 DOM
 * 属性（S6：`data-secret-value` 已移除，DOM 里只有掩码后的文本）。
 */
"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { findSecrets, MASK } from "@/lib/secret-mask";
import styles from "./secret-text.module.css";

/** 掩码段切分：一个连续的 mark run（同 SecretText.tsx:13）。 */
const MASK_RUNS = /(\*+)/u;
const NO_OPEN: readonly number[] = [];

/** 把掩码串切成"保留文本 + 掩码段"，掩码段画成居中 mark。 */
function MaskedRun({ masked }: { readonly masked: string }) {
  let offset = 0;
  return (
    <>
      {masked.split(MASK_RUNS).map((part) => {
        const key = offset;
        offset += part.length;
        if (part === "") return null;
        return part.startsWith(MASK) ? (
          <span key={key} className={styles.mask}>
            {part}
          </span>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </>
  );
}

export type SecretTextProps = {
  /** 原文。掩码只影响画出来的字。 */
  readonly text: string;
  /** 是否给每段凭据一个眼睛按钮；默认给。 */
  readonly interactive?: boolean;
  readonly className?: string;
};

/**
 * 画一段可能含凭据的文本：凭据遮住，其余原样。
 * @param props - 原文、是否可展开、外层类名。
 * @returns 掩码后的内联内容；没有凭据时原样返回文本。
 */
export function SecretText({ text, interactive = true, className }: SecretTextProps) {
  const spans = React.useMemo(() => findSecrets(text), [text]);
  // 记"哪几段展开了"，并绑定当时的原文：同一个 DOM 位置换成另一条凭据时要重新遮住。
  const [state, setState] = React.useState<{ text: string; open: readonly number[] }>({ text, open: NO_OPEN });
  const open = state.text === text ? state.open : NO_OPEN;

  const toggle = React.useCallback(
    (start: number) => {
      setState((prev) => {
        const base = prev.text === text ? prev.open : NO_OPEN;
        return { text, open: base.includes(start) ? base.filter((value) => value !== start) : [...base, start] };
      });
    },
    [text],
  );

  if (spans.length === 0) return <>{text}</>;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start));
    const original = text.slice(span.start, span.end);
    const revealed = open.includes(span.start);
    nodes.push(
      <span
        key={`secret-${span.start}`}
        className={styles.secret}
        data-secret=""
        data-revealed={revealed ? "true" : undefined}
      >
        <span className={styles.value}>{revealed ? original : <MaskedRun masked={span.masked} />}</span>
        {interactive ? (
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={revealed}
            aria-label={revealed ? "隐藏密钥" : "显示密钥"}
            title={revealed ? "隐藏密钥" : "显示密钥"}
            data-testid="secret-toggle"
            onClick={() => toggle(span.start)}
          >
            {revealed ? (
              <EyeOff className={styles.icon} aria-hidden="true" />
            ) : (
              <Eye className={styles.icon} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </span>,
    );
    cursor = span.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <span className={className}>{nodes}</span>;
}
