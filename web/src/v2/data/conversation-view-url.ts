"use client";

/**
 * 会话中间视图的 URL 深链（`?view=<id>`）读写（U1，.tmp/d6-ia-inventory.md §4.6、§5 的 U1-①）。
 *
 * 中间栏原来是 `ConversationMainPanel` 的组件内 state（`.tmp/d6-ia-inventory.md §1.1`），
 * 右栏与全局页只能跳到它们各自的入口；现在视图 id 落在地址上（与 Shell 的 `?task=`
 * 同法：Shell.tsx:231-236 读初值、:381-394 replaceState 回写、:410-417 popstate 重读）。
 *
 * 本模块只碰地址和 window 事件：写完地址派发 {@link CONVERSATION_VIEW_EVENT}，
 * 挂载中的 `ConversationMainPanel` 订阅后把中间栏切到对应视图（别名解析在
 * `v2/data/conversation-views.ts` 的 `resolveViewAlias`）。UI 组件一律经本适配器调用，
 * 不直接 import `@/lib/api`。
 */

/** 地址更新后派发的 window 自定义事件名（订阅方见 `ConversationMainPanel`）。 */
export const CONVERSATION_VIEW_EVENT = "miox:conversation-view";

/**
 * 读地址里的 `?view=<id>` 原值。
 * @returns 去空白后的 id；服务端渲染或地址没写时为 null。
 */
export function readViewParam(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("view");
  return value === null || value.trim() === "" ? null : value.trim();
}

/** `setConversationView` 的可选参数。 */
export interface SetConversationViewOptions {
  /**
   * 一次性定位参数（`?hl=`）：右·发现「在发现视图打开」传发现 id，
   * 发现视图读取后滚动到该行、高亮 2 秒，然后把它从地址上摘掉。
   */
  readonly hl?: string;
}

/**
 * 从外部（右栏、总览等）把中间栏切到某个视图：写 `?view=` 后派发事件。
 *
 * 写法与 Shell 的 `?task=` 一致（`replaceState`，Shell.tsx:381-394）——
 * 视图选择不算一步历史，Back 仍然回到上一个页面级别状态。
 * @param id - 目标视图 id；别名（如 `explore.graph`）由订阅方解析。
 * @param options - 可选的 `?hl=` 一次性定位。
 */
export function setConversationView(id: string, options: SetConversationViewOptions = {}): void {
  const url = new URL(window.location.href);
  url.searchParams.set("view", id);
  if (typeof options.hl === "string" && options.hl !== "") url.searchParams.set("hl", options.hl);
  else url.searchParams.delete("hl");
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(
    new CustomEvent<{ readonly view: string; readonly hl: string | null }>(CONVERSATION_VIEW_EVENT, {
      detail: { view: id, hl: options.hl ?? null },
    }),
  );
}
