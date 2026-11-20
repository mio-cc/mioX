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
import { CommandsPage } from "@/components/v2/commands/CommandsPage";
import { CompaniesPage } from "@/components/v2/companies/CompaniesPage";
import { DashboardPage } from "@/components/v2/dashboard/DashboardPage";
import { AssetsDataPage } from "@/components/v2/data-pages/AssetsDataPage";
import { TrafficDataPage } from "@/components/v2/data-pages/TrafficDataPage";
import { FindingsDataPage } from "@/components/v2/findings/FindingsDataPage";
import { LogsPage } from "@/components/v2/logs/LogsPage";
import { LlmRecordsPage } from "@/components/v2/llm/LlmRecordsPage";
import { MemoriesPage } from "@/components/v2/memories/MemoriesPage";
import { SyncPage } from "@/components/v2/sync/SyncPage";
import { ToolsPage } from "@/components/v2/tools/ToolsPage";
import { WorkspacePage } from "@/components/v2/workspace/WorkspacePage";
import {
  IconCodeOutlineRegular,
  IconDatabaseOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGaugeOutlineRegular,
  IconGlobeOutlineRegular,
  IconLightOutlineRegular,
  IconListPenOutlineRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
  IconSlidersTwoOutlineRegular,
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
    id: "findings",
    label: "发现",
    Icon: IconShieldOutlineRegular,
    order: 90,
    group: "数据",
    Component: FindingsDataPage,
  },
  {
    id: "assets",
    label: "资产",
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
    id: "conversations",
    label: "Agent 对话",
    Icon: IconDatabaseOutlineRegular,
    order: 120,
    group: "数据",
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
    id: "companies",
    label: "企业",
    Icon: IconDatabaseOutlineRegular,
    order: 140,
    group: "数据",
    Component: CompaniesPage,
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
    id: "tools",
    label: "工具",
    Icon: IconSlidersTwoOutlineRegular,
    order: 330,
    group: "系统",
    Component: ToolsPage,
  },
  {
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
