"use client";

import * as React from "react";

import { useSearchParams } from "next/navigation";

import { FileText, Folder, Inbox, Maximize2, Minimize2, PanelRightClose, ShieldCheck } from "lucide-react";

import { api } from "@/lib/api";
import type { Asset, Finding, InterceptApprovalRow, Task, WorkspaceEntry } from "@/lib/types";

import { useAppLayout } from "./app-frame";
import styles from "./right-panel.module.css";

type RightTab = "task" | "assets" | "evidence" | "approvals" | "files" | "session";

interface TabDef {
  readonly id: RightTab;
  readonly label: string;
  readonly count?: number;
}

const tabs: readonly TabDef[] = [
  { id: "task", label: "任务" },
  { id: "assets", label: "资产" },
  { id: "evidence", label: "证据" },
  { id: "approvals", label: "审批" },
  { id: "files", label: "文件" },
  // Aside session (reference: openChildAside) - a child lane shown beside the main view.
  { id: "session", label: "子会话" },
];

const RIGHT_TAB_KEY = "artex.rightPanel.tab";
const rightTabIds = tabs.map((tab) => tab.id);

function readStoredTab(): RightTab {
  if (typeof window === "undefined") return "task";
  try {
    const value = window.localStorage.getItem(RIGHT_TAB_KEY);
    return value && (rightTabIds as string[]).includes(value) ? (value as RightTab) : "task";
  } catch {
    return "task";
  }
}

type AppLayoutValue = ReturnType<typeof useAppLayout>;

function isElementVisible(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && element.getClientRects().length > 0);
}

const TRIGGER_SELECTORS = [
  '[data-testid="task-right-toggle"]',
  '[data-testid="toggle-right"]',
  '[data-testid="right-panel-trigger"]',
  '[aria-label="切换右侧检查器"]',
  '[aria-label="打开右侧检查器"]',
];

function findRightPanelTrigger(): HTMLElement | null {
  for (const selector of TRIGGER_SELECTORS) {
    const candidate = document.querySelector<HTMLElement>(selector);
    if (isElementVisible(candidate)) return candidate;
  }
  return null;
}

type PillTone = "success" | "warning" | "muted";

/**
 * Inspector data, all from the real API.
 *
 * This panel used to render hardcoded `acme.com` fixtures — it looked functional
 * while showing fiction, which is the worst kind of placeholder. Everything here
 * is derived from `api.task` / `api.taskAssets` / `api.findings` /
 * `api.interceptTask` / `api.workspaceList`, and every empty state says so
 * instead of inventing rows.
 */
interface PanelData {
  readonly taskId: string;
  readonly loading: boolean;
  readonly error: string;
  readonly task: Task | null;
  readonly assets: Asset[];
  readonly findings: Finding[];
  readonly approvals: InterceptApprovalRow[];
}

const EMPTY_DATA: PanelData = {
  taskId: "",
  loading: false,
  error: "",
  task: null,
  assets: [],
  findings: [],
  approvals: [],
};

const POLL_MS = 10_000;

function usePanelData(taskId: string): PanelData {
  const [state, setState] = React.useState<PanelData>(EMPTY_DATA);

  React.useEffect(() => {
    if (!taskId) {
      setState(EMPTY_DATA);
      return;
    }
    let alive = true;
    const load = async () => {
      const [task, assetsRes, findings, approvals] = await Promise.all([
        api.task(taskId).catch(() => null),
        api.taskAssets(taskId, "", 20).catch(() => ({ assets: [] as Asset[], total: 0 })),
        api.findings(taskId).catch(() => [] as Finding[]),
        api.interceptTask(taskId).catch(() => [] as InterceptApprovalRow[]),
      ]);
      if (!alive) return;
      setState({
        taskId,
        loading: false,
        error: task ? "" : "任务数据不可用",
        task,
        assets: assetsRes.assets,
        findings,
        approvals,
      });
    };
    setState((prev) => ({ ...prev, taskId, loading: true }));
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [taskId]);

  return state;
}

const severityLabel: Record<string, string> = {
  critical: "严重",
  high: "高危",
  medium: "中危",
  low: "低危",
  info: "提示",
};

const severityTone: Record<string, PillTone> = {
  critical: "warning",
  high: "warning",
  medium: "muted",
  low: "muted",
  info: "muted",
};

const toneClass: Record<PillTone, string> = {
  success: styles.pillSuccess,
  warning: styles.pillWarn,
  muted: styles.pillMuted,
};

function assetLabel(asset: Asset): string {
  return asset.domain || asset.url || asset.app_name || asset.ip || asset.c_segment || `#${asset.id}`;
}

function assetMetaLine(asset: Asset): string {
  const parts: string[] = [asset.type];
  if (asset.port) parts.push(String(asset.port));
  if (asset.open_ports?.length) parts.push(`${asset.open_ports.length} 个开放端口`);
  if (asset.app_name) parts.push(asset.app_name);
  return parts.filter(Boolean).join(" · ");
}

function EmptyState({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Inbox size={16} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className={styles.emptyTitle}>{title}</span>
      <span className={styles.emptyText}>{text}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className={styles.panel}>
      <div className={styles.note}>正在加载…</div>
    </div>
  );
}

function TaskTab({ data }: { readonly data: PanelData }) {
  if (!data.taskId) {
    return <EmptyState title="没有打开的任务" text="从左侧任务树选择一个任务，检查器会显示它的目标、资产与审批。" />;
  }
  if (data.loading && !data.task) return <LoadingState />;
  const task = data.task;
  if (!task) {
    return <EmptyState title="任务不可用" text={data.error || "任务可能已被归档或删除。"} />;
  }
  const goalsTotal = task.goals_total ?? 0;
  const goalsMet = task.goals_met ?? 0;
  const pct = goalsTotal > 0 ? Math.round((goalsMet / goalsTotal) * 100) : 0;
  const pending = data.approvals.filter((row) => row.status === "pending");
  const terminal = ["done", "failed", "timeout"].includes(task.status);
  const statusText = task.paused ? "已暂停" : terminal ? task.status : "运行中";
  const findingsTotal =
    (task.findings?.critical ?? 0) +
    (task.findings?.high ?? 0) +
    (task.findings?.medium ?? 0) +
    (task.findings?.low ?? 0);

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>任务概况</h3>
          <span className={`${styles.pill} ${terminal || task.paused ? styles.pillMuted : styles.pillLive}`}>
            <span className={styles.statusDot} />
            {statusText}
          </span>
        </div>
        <dl className={styles.kv}>
          <dt>目标</dt>
          <dd>{task.goal || "未设置"}</dd>
          <dt>进度</dt>
          <dd>
            {goalsMet} / {goalsTotal} 目标 · {pending.length} 个待审批
          </dd>
          <dt>发现</dt>
          <dd>
            严重 {task.findings?.critical ?? 0} · 高危 {task.findings?.high ?? 0} · 中危{" "}
            {task.findings?.medium ?? 0} · 低危 {task.findings?.low ?? 0}
          </dd>
          <dt>Token</dt>
          <dd>
            入 {(task.tokens?.input_tokens ?? 0).toLocaleString()} · 出{" "}
            {(task.tokens?.output_tokens ?? 0).toLocaleString()}
          </dd>
        </dl>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="任务进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span className={styles.progressBar} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.progressMeta}>
          <span>已完成 {goalsMet} 个目标</span>
          <span>{findingsTotal} 个发现</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>待审批</h3>
          <span className={styles.sectionMeta}>{pending.length} 项</span>
        </div>
        {pending.length === 0 ? (
          <div className={styles.note}>当前没有待审批的操作。</div>
        ) : (
          <div className={styles.list}>
            {pending.slice(0, 6).map((row) => (
              <div className={styles.pendingRow} key={row.id}>
                <span className={styles.pendingDot} />
                <div className={styles.rowMain}>
                  <div className={`${styles.rowTitle} ${styles.mono}`}>
                    {row.tool_name || "tool"} · {row.rule_name || row.conv_agent_key || "审批"}
                  </div>
                  <div className={styles.rowSub}>
                    #{row.id}
                    {row.conv_title ? ` · ${row.conv_title}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>当前资产</h3>
          <span className={styles.sectionMeta}>{data.assets.length} 个</span>
        </div>
        {data.assets.length === 0 ? (
          <div className={styles.note}>该任务还没有关联资产。</div>
        ) : (
          data.assets.slice(0, 4).map((asset) => (
            <div className={styles.assetRow} key={asset.id}>
              <span className={styles.assetIcon}>{assetLabel(asset).slice(0, 1).toUpperCase()}</span>
              <div className={styles.rowMain}>
                <div className={styles.assetName}>{assetLabel(asset)}</div>
                <div className={styles.assetMeta}>{assetMetaLine(asset)}</div>
              </div>
            </div>
          ))
        )}
      </section>

      <div className={styles.note}>右侧检查器可停靠、可全屏；关闭后任务上下文与滚动位置保持不变。</div>
    </div>
  );
}

function AssetsTab({ data }: { readonly data: PanelData }) {
  if (!data.taskId) {
    return <EmptyState title="没有打开的任务" text="选择任务后，这里列出它关联的资产。" />;
  }
  if (data.loading && data.assets.length === 0) return <LoadingState />;
  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>资产</h3>
          <span className={styles.sectionMeta}>{data.assets.length} 项</span>
        </div>
        {data.assets.length === 0 ? (
          <div className={styles.note}>该任务还没有关联资产。</div>
        ) : (
          <div className={styles.list}>
            {data.assets.map((asset) => (
              <div className={styles.assetRow} key={asset.id}>
                <span className={styles.assetIcon}>{assetLabel(asset).slice(0, 1).toUpperCase()}</span>
                <div className={styles.rowMain}>
                  <div className={styles.assetName}>{assetLabel(asset)}</div>
                  <div className={styles.assetMeta}>{assetMetaLine(asset)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className={styles.note}>资产来自任务关联（GET /api/assets?task_id=），按最近探测结果展示。</div>
    </div>
  );
}

function EvidenceTab({ data }: { readonly data: PanelData }) {
  if (!data.taskId) {
    return <EmptyState title="没有打开的任务" text="选择任务后，这里列出它的发现与证据。" />;
  }
  if (data.loading && data.findings.length === 0) return <LoadingState />;
  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>发现</h3>
          <span className={styles.sectionMeta}>{data.findings.length} 条</span>
        </div>
        {data.findings.length === 0 ? (
          <EmptyState
            title="还没有发现"
            text="工具执行产生证据后，会在这里按严重级别列出，并关联到对应资产。"
          />
        ) : (
          <div className={styles.list}>
            {data.findings.slice(0, 20).map((finding) => (
              <div className={styles.evidenceRow} key={finding.id}>
                <span className={styles.rowIcon}>
                  <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>{finding.name || finding.vulnclass}</div>
                  <div className={styles.rowSub}>
                    {severityLabel[finding.severity] ?? finding.severity}
                    {finding.summary ? ` · ${finding.summary}` : ""}
                  </div>
                </div>
                <span className={`${styles.pill} ${toneClass[severityTone[finding.severity] ?? "muted"]}`}>
                  {finding.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className={styles.note}>来自 GET /api/exploration/findings?task=；主区「发现」可看完整证据。</div>
    </div>
  );
}

function ApprovalsTab({ data }: { readonly data: PanelData }) {
  if (!data.taskId) {
    return <EmptyState title="没有打开的任务" text="选择任务后，这里列出它的审批队列。" />;
  }
  if (data.loading && data.approvals.length === 0) return <LoadingState />;
  const pending = data.approvals.filter((row) => row.status === "pending");
  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>审批队列</h3>
          <span className={styles.sectionMeta}>{pending.length} 项待处理</span>
        </div>
        {pending.length === 0 ? (
          <EmptyState title="没有待审批" text="当工具调用命中拦截规则时，会在这里排队等待你决定。" />
        ) : (
          <div className={styles.list}>
            {pending.map((row) => (
              <div className={styles.approvalRow} key={row.id}>
                <span className={styles.rowIcon}>
                  <ShieldCheck size={13} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className={styles.rowMain}>
                  <div className={`${styles.rowTitle} ${styles.mono}`}>{row.tool_name || "tool"}</div>
                  <div className={styles.rowSub}>{row.rule_name || "规则已删除"}</div>
                  <div className={styles.rowSub}>
                    #{row.id}
                    {row.conv_title ? ` · ${row.conv_title}` : ""}
                  </div>
                </div>
                <span className={`${styles.pill} ${styles.pillWarn}`}>待审批</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className={styles.note}>审批动作在主区对话流里完成；右侧队列只用于快速定位。</div>
    </div>
  );
}

function FilesTab() {
  const [state, setState] = React.useState<{ loading: boolean; error: string; entries: WorkspaceEntry[] }>({
    loading: true,
    error: "",
    entries: [],
  });

  React.useEffect(() => {
    let alive = true;
    api
      .workspaceList("")
      .then((listing) => {
        if (alive) setState({ loading: false, error: "", entries: listing.entries ?? [] });
      })
      .catch((err: Error) => {
        if (alive) setState({ loading: false, error: err.message || "工作区不可用", entries: [] });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.loading) return <LoadingState />;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>工作区文件</h3>
          <span className={styles.sectionMeta}>根目录</span>
        </div>
        {state.error ? (
          <div className={styles.note}>{state.error}</div>
        ) : state.entries.length === 0 ? (
          <EmptyState title="工作区是空的" text="任务上传的附件与工具产出会写到工作区，这里显示根目录内容。" />
        ) : (
          <div className={styles.fileTree} role="tree" aria-label="工作区文件">
            <div className={styles.treeGroup}>
              <div className={styles.treeGroupTitle}>
                <Folder size={12} strokeWidth={1.8} aria-hidden="true" />
                /
              </div>
              {state.entries.slice(0, 40).map((entry) => (
                <div className={styles.treeRow} key={entry.path} role="treeitem" tabIndex={-1}>
                  <span className={styles.fileType}>{entry.dir ? "DIR" : "FILE"}</span>
                  <span className={styles.fileName}>{entry.name}</span>
                  <span className={styles.fileSize}>
                    {entry.dir ? "" : `${Math.max(1, Math.round(entry.size / 1024))} KB`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <div className={styles.note}>来自 GET /api/workspace/list；完整文件管理在「工作空间」页面。</div>
    </div>
  );
}

/**
 * Read-only view of one child lane, shown beside the main conversation instead of
 * replacing it (reference: the right-sidebar subagent chat).
 */
function SessionTab({ laneKey, taskId }: { readonly laneKey: string; readonly taskId: string }) {
  const [state, setState] = React.useState<{
    loading: boolean;
    error: string;
    items: ReadonlyArray<{ seq: number; kind: string; summary: string; tool?: string }>;
  }>({ loading: false, error: "", items: [] });

  React.useEffect(() => {
    if (laneKey === "" || taskId === "") return;
    let live = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    api
      .activityHistory(taskId, laneKey, 0, 150)
      .then((result) => {
        if (!live) return;
        setState({ loading: false, error: "", items: result.items as ReadonlyArray<{ seq: number; kind: string; summary: string; tool?: string }> });
      })
      .catch((loadError: Error) => {
        if (live) setState({ loading: false, error: loadError.message, items: [] });
      });
    return () => {
      live = false;
    };
  }, [laneKey, taskId]);

  if (laneKey === "") {
    return <p className={styles.empty}>在会话菜单里点「旁开」，子会话会显示在这里，主对话不受影响。</p>;
  }
  if (state.loading && state.items.length === 0) {
    return <p className={styles.empty}>加载子会话…</p>;
  }
  if (state.error !== "") {
    return <p className={styles.empty}>子会话加载失败：{state.error}</p>;
  }
  if (state.items.length === 0) {
    return <p className={styles.empty}>这个子会话还没有活动。</p>;
  }
  return (
    <div className={styles.asideList} data-testid="aside-session">
      <div className={styles.asideHead} data-testid="aside-lane">
        {laneKey}
      </div>
      {state.items.map((item) => (
        <div className={styles.asideRow} key={item.seq} data-kind={item.kind}>
          <span className={styles.asideKind}>{item.kind}</span>
          <span className={styles.asideText}>{(item.summary || "").slice(0, 220)}</span>
        </div>
      ))}
    </div>
  );
}

function renderTab(tab: RightTab, data: PanelData, aside: string, taskId: string) {
  switch (tab) {
    case "task":
      return <TaskTab data={data} />;
    case "assets":
      return <AssetsTab data={data} />;
    case "evidence":
      return <EvidenceTab data={data} />;
    case "approvals":
      return <ApprovalsTab data={data} />;
    case "files":
      return <FilesTab />;
    case "session":
      return <SessionTab laneKey={aside} taskId={taskId} />;
  }
}


function RightPanelContent({ layout }: { readonly layout: AppLayoutValue | null }) {
  // The inspector follows the task in the URL (?id=), same source the sidebar
  // tree uses, so opening a task updates the panel without extra plumbing.
  const searchParams = useSearchParams();
  const taskId = searchParams?.get("id") ?? "";
  // Aside lane requested by the workspace (reference: openChildAside). A child
  // session opens HERE instead of replacing the conversation being read.
  const asideKey = searchParams?.get("aside") ?? "";

  // Opening an aside switches the inspector to it: the user asked to see that
  // lane, so leaving the panel on its previous tab would look like nothing happened.
  React.useEffect(() => {
    if (asideKey !== "") setActive("session");
  }, [asideKey]);
  const data = usePanelData(taskId);
  // 审批 tab 徽标 = API 返回的 pending 条数(K4:之前是硬编码 2)。
  const pendingApprovals = data.approvals.filter((row) => row.status === "pending").length;

  const [active, setActive] = React.useState<RightTab>("task");
  // Tabs are mounted lazily on first visit and kept mounted afterwards.
  const [visited, setVisited] = React.useState<ReadonlySet<RightTab>>(() => new Set<RightTab>(["task"]));
  const [fullscreen, setFullscreen] = React.useState(false);
  const [standaloneDismissed, setStandaloneDismissed] = React.useState(false);
  const hydrated = React.useRef(false);
  const wasOpenRef = React.useRef(layout ? layout.rightOpen : true);
  const lastFocusRef = React.useRef<HTMLElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const scrollPositions = React.useRef<Record<RightTab, number>>({
    task: 0,
    assets: 0,
    evidence: 0,
    approvals: 0,
    files: 0,
    session: 0,
  });

  const rightOpen = layout ? layout.rightOpen : true;

  React.useEffect(() => {
    setActive(readStoredTab());
    hydrated.current = true;
  }, []);

  React.useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(RIGHT_TAB_KEY, active);
    } catch {
      // localStorage may be unavailable; tab state still works in memory.
    }
  }, [active]);

  // Restore the scroll position that belongs to the tab being shown.
  React.useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = scrollPositions.current[active] ?? 0;
  }, [active]);

  // Mark the active tab as visited so it mounts (and stays mounted).
  React.useEffect(() => {
    setVisited((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);

  // Panel open: move focus into the inspector. Panel close: return focus to the
  // header trigger (or the control that opened it when the trigger is absent).
  React.useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = rightOpen;
    if (!layout) return;

    if (!wasOpen && rightOpen) {
      lastFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const frame = window.requestAnimationFrame(() => {
        const index = tabs.findIndex((tab) => tab.id === active);
        tabRefs.current[index]?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (wasOpen && !rightOpen) {
      setFullscreen(false);
      const frame = window.requestAnimationFrame(() => {
        const remembered = isElementVisible(lastFocusRef.current) ? lastFocusRef.current : null;
        const target = findRightPanelTrigger() ?? remembered;
        target?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [active, layout, rightOpen]);

  // Escape leaves fullscreen before AppFrame's Escape handler can close the panel.
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreen]);

  const selectTab = React.useCallback((next: RightTab, moveFocus = false) => {
    setActive((current) => {
      if (current === next) return current;
      const body = bodyRef.current;
      if (body) scrollPositions.current[current] = body.scrollTop;
      return next;
    });
    if (moveFocus) {
      const index = tabs.findIndex((tab) => tab.id === next);
      window.requestAnimationFrame(() => {
        const button = tabRefs.current[index];
        button?.focus({ preventScroll: true });
        button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
  }, []);

  const onTabListKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === active),
      );
      const key = event.key;
      let nextIndex: number;
      if (key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (key === "Home") {
        nextIndex = 0;
      } else if (key === "End") {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      if (nextTab) selectTab(nextTab.id, true);
    },
    [active, selectTab],
  );

  const closePanel = React.useCallback(() => {
    if (layout) {
      layout.toggleRight();
      return;
    }
    setStandaloneDismissed(true);
  }, [layout]);

  if (!layout && standaloneDismissed) return null;

  return (
    <section
      className={`${styles.root} ${fullscreen ? styles.rootFullscreen : ""}`}
      data-testid="right-panel"
      data-fullscreen={fullscreen ? "true" : "false"}
      aria-label="任务检查器"
      inert={layout ? !rightOpen : undefined}
    >
      <div className={styles.tabStrip}>
        <div className={styles.tabViewport}>
          <div className={styles.tabs} role="tablist" aria-label="任务检查器" onKeyDown={onTabListKeyDown}>
            {tabs.map((tab, index) => {
              const selected = active === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`right-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`right-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  data-testid={`right-tab-${tab.id}`}
                  className={`${styles.tab} ${selected ? styles.tabActive : ""}`}
                  onClick={() => selectTab(tab.id)}
                >
                  <span className={styles.tabLabel}>{tab.label}</span>
                  {tab.id === "approvals" && pendingApprovals > 0 ? (
                    <span className={styles.count} data-testid="approvals-tab-count">
                      {pendingApprovals}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setFullscreen((value) => !value)}
            aria-label={fullscreen ? "退出全屏" : "全屏显示右侧检查器"}
            aria-pressed={fullscreen}
            title={fullscreen ? "退出全屏 (Esc)" : "全屏显示"}
            data-testid="right-panel-fullscreen"
          >
            {fullscreen ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            className={styles.closeButton}
            onClick={closePanel}
            aria-label="收起右侧检查器"
            title="收起右侧检查器 (Ctrl+Shift+B)"
            data-testid="right-panel-close"
          >
            <PanelRightClose size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div ref={bodyRef} className={styles.body} data-testid="right-panel-body">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`right-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`right-tab-${tab.id}`}
            hidden={active !== tab.id}
            className={styles.tabPanel}
          >
            {/* Mount on first visit, then keep mounted: switching back must restore
                scroll position and internal state, but a tab the user never opened
                should not run its own fetches (FilesTab loads the workspace list). */}
            {visited.has(tab.id) ? renderTab(tab.id, data, asideKey, taskId) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

interface RightPanelBoundaryState {
  readonly failed: boolean;
}

/**
 * RightPanel is mounted through AppFrame in the app, but previews and
 * component tests may render it in isolation. The boundary degrades to a
 * local dismiss state instead of crashing when no AppLayoutContext exists.
 */
class RightPanelBoundary extends React.Component<React.PropsWithChildren, RightPanelBoundaryState> {
  state: RightPanelBoundaryState = { failed: false };

  static getDerivedStateFromError(): RightPanelBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <RightPanelContent layout={null} />;
    return this.props.children;
  }
}

function RightPanelWithLayout() {
  const layout = useAppLayout();
  return <RightPanelContent layout={layout} />;
}

export function RightPanel() {
  return (
    <RightPanelBoundary>
      <RightPanelWithLayout />
    </RightPanelBoundary>
  );
}
