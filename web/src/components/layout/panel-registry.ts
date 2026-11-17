// Panel registry for the sidebar (D2 card 1-2).
//
// DSH ui-sidebar/panel-pins.ts + index.ts:56-71 semantics:
// - panels come from a registry projection with `order` sorting, not const arrays
// - FIXED_PANEL_ID can never be unpinned
// - unpin is an in-memory set; setPinned is idempotent and ignores the fixed panel

export interface SidebarPanel {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** 面板动作（空 = 普通链接面板，如页面入口）。 */
  readonly order: number;
}

/** DSH panel-pins.ts:5 FIXED_PANEL_ID='plugins' — our fixed entry is the More menu itself. */
export const FIXED_PANEL_ID = "more";

const registry = new Map<string, SidebarPanel>();

/** 注册一个侧边栏面板（DSH index.ts:56-71 的槽位投影等价物）。 */
export function registerPanel(panel: SidebarPanel): void {
  if (panel.id === FIXED_PANEL_ID) return; // fixed panel is owned by the shell
  registry.set(panel.id, panel);
}

/** 全部面板，按 order 升序（order 相同按注册序）。 */
export function listPanels(): readonly SidebarPanel[] {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

// in-memory unpin set (DSH panel-pins.ts:26-33)
const unpinned = new Set<string>();

/** 取消钉住（固定面板被忽略——DSH panel-pins.ts:30）。 */
export function unpinPanel(id: string): void {
  if (id === FIXED_PANEL_ID) return;
  unpinned.add(id);
}

/** 重新钉住（幂等——DSH setPinned）。 */
export function pinPanel(id: string): void {
  unpinned.delete(id);
}

export function isUnpinned(id: string): boolean {
  return unpinned.has(id);
}

/** 渲染过滤（DSH SidebarRoot.tsx:412：固定面板 或 无 unpin 权限 或 未取消钉住）。 */
export function visiblePanels(): readonly SidebarPanel[] {
  return listPanels().filter((p) => p.id === FIXED_PANEL_ID || !isUnpinned(p.id));
}

/** 测试/重置用。 */
export function clearPanels(): void {
  registry.clear();
  unpinned.clear();
}
