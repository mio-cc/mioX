"use client";

/**
 * Main-area page registry for the /v2 shell.
 *
 * The shell's centre column shows either the Conversation (no `?page=`) or one
 * registered whole-page surface (`?page=<id>`). One entry carries everything both
 * consumers need: the left navigation row (label, icon, group, position) and the
 * component the main area renders. Registering a page therefore means adding one
 * entry here — the shell itself never changes.
 *
 * Ordering and lifecycle mirror the mini slot registry (`v2/slots/registry.ts`):
 * ascending explicit `order` with declaration order as the tie-break
 * (`registry.ts:130`), `when()` skips rendering while keeping the entry
 * (`registry.ts:54-58`), and removing an entry removes its row, its deep link and
 * its body together (`registry.ts:105-114` disposal leaves no hole). The list is
 * static rather than registered at runtime because a deep link must resolve
 * before the first paint — a runtime registration would leave the URL's page
 * unrenderable for at least one frame — and because the row metadata
 * (`label`/`Icon`/`group`) is not slot context. The registry class itself is not
 * reused: it only carries `id`/`order`/`when`/`render` and requires a slot
 * context, neither of which fits a page entry.
 */
import type { ReactNode } from "react";

import { AgentChatPage } from "@/components/v2/agent-chat/AgentChatPage";
import { AutomationsPage } from "@/components/v2/automations/AutomationsPage";
import { CommandsPage } from "@/components/v2/commands/CommandsPage";
import { DashboardPage } from "@/components/v2/dashboard/DashboardPage";
import { AssetsDataPage } from "@/components/v2/data-pages/AssetsDataPage";
import { TrafficDataPage } from "@/components/v2/data-pages/TrafficDataPage";
import { FindingsDataPage } from "@/components/v2/findings/FindingsDataPage";
import { LogsPage } from "@/components/v2/logs/LogsPage";
import { LlmRecordsPage } from "@/components/v2/llm/LlmRecordsPage";
import { MemoriesPage } from "@/components/v2/memories/MemoriesPage";
import { SyncPage } from "@/components/v2/sync/SyncPage";
import { WorkspacePage } from "@/components/v2/workspace/WorkspacePage";
import {
  IconClockOutlineRegular,
  IconCodeOutlineRegular,
  IconDatabaseOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGaugeOutlineRegular,
  IconGlobeOutlineRegular,
  IconLightOutlineRegular,
  IconListPenOutlineRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

/** Icon renderer shared with the sidebar's fixed navigation rows. */
export type PageIcon = (props: { size?: number }) => ReactNode;

/** One whole-page surface selectable from the sidebar and addressable as `?page=<id>`. */
export interface MainPage {
  /** `?page=` value and React identity of the main-area body. */
  readonly id: string;
  /** Navigation row text, also the row's accessible name and tooltip. */
  readonly label: string;
  /** Row glyph: 16px beside the expanded label, alone in the collapsed rail. */
  readonly Icon: PageIcon;
  /** Ascending position among the sidebar rows; ties keep declaration order. */
  readonly order: number;
  /** Caption of the consecutive navigation run this row belongs to. */
  readonly group: string;
  /** Main-area body. A page takes no props: it owns its data through `v2/data/`. */
  readonly Component: () => ReactNode;
  /** Conditional visibility; false skips the row and the body but keeps the entry. */
  when?(): boolean;
}

/**
 * The registered pages, in declaration order.
 *
 * Adding a page is adding one entry here: the sidebar row, the deep link and the
 * main-area body all read this list, so no shell file changes. Deleting an entry
 * disposes all three at once.
 */
const PAGES: readonly MainPage[] = [
  {
    id: "dashboard",
    label: "总览",
    Icon: IconGaugeOutlineRegular,
    order: 80,
    group: "数据",
    Component: DashboardPage,
  },
  {
    // D5：定时任务（自动化）一级页——DSH「自动化任务」页、Codex Scheduled 收件箱同位。
    id: "automations",
    label: "自动化",
    Icon: IconClockOutlineRegular,
    order: 85,
    group: "数据",
    Component: AutomationsPage,
  },
  {
    // D6·U4：原名「发现」；企业只读列表并入资产库后，本页是全局发现的唯一全功能入口。
    id: "findings",
    label: "发现库",
    Icon: IconShieldOutlineRegular,
    order: 90,
    group: "数据",
    Component: FindingsDataPage,
  },
  {
    // D6·U4：原名「资产」；「企业」页并入本页的 company tab（?page=assets&tab=company）。
    id: "assets",
    label: "资产库",
    Icon: IconDatabaseOutlineRegular,
    order: 100,
    group: "数据",
    Component: AssetsDataPage,
  },
  {
    id: "traffic",
    label: "流量",
    Icon: IconGlobeOutlineRegular,
    order: 110,
    group: "数据",
    Component: TrafficDataPage,
  },
  {
    // D6·U4：原名「Agent 对话」，从「数据」移到「系统」——它是独立聊天工具，不是
    // 跨任务数据页。order 290 让「系统」段在「数据」段之后连续（按 group 切段渲染）。
    id: "conversations",
    label: "Agent 聊天",
    Icon: IconDatabaseOutlineRegular,
    order: 290,
    group: "系统",
    Component: AgentChatPage,
  },
  {
    id: "workspace",
    label: "工作区文件",
    Icon: IconFolderOpenOutlineRegular,
    order: 130,
    group: "数据",
    Component: WorkspacePage,
  },
  {
    id: "commands",
    label: "命令记录",
    Icon: IconCodeOutlineRegular,
    order: 150,
    group: "数据",
    Component: CommandsPage,
  },
  {
    id: "memories",
    label: "记忆",
    Icon: IconLightOutlineRegular,
    order: 160,
    group: "数据",
    Component: MemoriesPage,
  },
  {
    id: "logs",
    label: "系统日志",
    Icon: IconGaugeOutlineRegular,
    order: 300,
    group: "系统",
    Component: LogsPage,
  },
  {
    id: "llm-records",
    label: "LLM 录制",
    Icon: IconListPenOutlineRegular,
    order: 310,
    group: "系统",
    Component: LlmRecordsPage,
  },
  {
    // D6·U4：原「工具」（order 330）与原「企业」（order 140）两项入口已删——
    // 工具组件在设置弹窗「工具」节（SettingsDialog.tsx），企业并入资产库 company tab。
    id: "sync",
    label: "资产同步",
    Icon: IconRefreshOutlineRegular,
    order: 320,
    group: "系统",
    Component: SyncPage,
  },
];

/**
 * The pages the sidebar and the main area should render right now.
 * @returns Pages passing `when()`, sorted by `order` then declaration order.
 */
export function listMainPages(): readonly MainPage[] {
  return PAGES.map((page, index) => ({ page, index }))
    .sort((a, b) => a.page.order - b.page.order || a.index - b.index)
    .map((row) => row.page)
    .filter((page) => page.when?.() !== false);
}

/**
 * Resolve a `?page=` value to its registration.
 * @param id - URL value, or null while the Conversation is showing.
 * @returns The page, or null when the id is absent, unknown or currently hidden.
 */
export function findMainPage(id: string | null): MainPage | null {
  if (id === null) return null;
  return listMainPages().find((page) => page.id === id) ?? null;
}
