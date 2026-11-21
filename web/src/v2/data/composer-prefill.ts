"use client";

/**
 * 跨组件的输入框草稿预填通道（DX-OV，.tmp/d5-goal-plan-schedule-design.md §3.1.1）。
 *
 * 概览「目标与验收项」节的「在会话中设置目标」按钮要把输入框预填为 `/goal ` 并聚焦，
 * 但输入框的草稿属于 Composer（contenteditable 非受控面），概览不该拿到它的引用。
 * 与 `v2/data/conversation-view-url.ts` 的做法一致：window 上的一个自定义事件，
 * 派发方 {@link prefillComposer} 只带文本，订阅方（`Composer.tsx`）落到草稿与光标上。
 * UI 组件一律经本适配器取用/派发，不直接耦合组件实例。
 */
import { useEffect, useRef } from "react";

/** 预填事件名（订阅方 `Composer.tsx`）。 */
export const COMPOSER_PREFILL_EVENT = "miox:composer-prefill";

/** 事件 detail：`text` 为要落进草稿的完整文本（调用方负责末尾空格）。 */
export interface ComposerPrefillDetail {
  readonly text: string;
}

/**
 * 把一段文本预填进当前挂载的输入框（整体替换草稿，光标落在文本末尾并聚焦）。
 * 没有输入框挂载（hero 之外的页面）时事件无人订阅，安静丢弃。
 * @param text - 完整草稿文本（如 `/goal `）。
 */
export function prefillComposer(text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ComposerPrefillDetail>(COMPOSER_PREFILL_EVENT, { detail: { text } }),
  );
}

/**
 * 订阅预填事件。handler 在渲染期间不变（存 ref），切换 handler 不会重挂监听。
 * @param handler - 收到预填文本时的处理（Composer：替换整稿 + 光标置尾 + 聚焦）。
 */
export function useComposerPrefill(handler: (text: string) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<ComposerPrefillDetail>).detail;
      if (detail === null || typeof detail !== "object" || typeof detail.text !== "string") return;
      handlerRef.current(detail.text);
    };
    window.addEventListener(COMPOSER_PREFILL_EVENT, listener);
    return () => {
      window.removeEventListener(COMPOSER_PREFILL_EVENT, listener);
    };
  }, []);
}
