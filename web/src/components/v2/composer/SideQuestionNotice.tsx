"use client";

/**
 * 旁路问题在没有可提问车道时的原因提示条。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1972,2038
 *   （旧页只在 `running` 时露出「发送旁路问题」按钮，没有对应的「为什么不可用」文案，
 *     这里补上真实原因，避免按钮静默消失）。
 * DSH 无，按输入区扩展。
 * 对照表行：P1:D12
 */
import * as React from "react";

import { IconCloseOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./SideQuestions.module.css";

/**
 * 渲染原因提示条。
 * @param props.reason - 原因文本；null 时不渲染。
 * @param props.onDismiss - 关闭提示。
 * @returns 提示条或 null。
 */
export function SideQuestionNotice({
  reason,
  onDismiss,
}: {
  readonly reason: string | null;
  readonly onDismiss: () => void;
}): React.ReactNode {
  if (reason === null) return null;
  return (
    <div className={css.notice} role="alert" data-side-question-notice="">
      <span>{reason}</span>
      <button type="button" className={css.linkBtn} aria-label="关闭提示" onClick={onDismiss}>
        <IconCloseOutlineRegular size={12} />
      </button>
    </div>
  );
}
