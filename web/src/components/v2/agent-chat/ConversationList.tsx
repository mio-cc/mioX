"use client";

/**
 * Agent 对话页的左栏：按 Agent 分组、置顶块、单选、双击重命名、置顶开关、行内删除、
 * 多选批量删除、按 Agent 筛选。
 * 旧页面依据：ARTEX/web/src/app/(main)/chat/page.tsx:900-1050（分组头与行：折叠箭头、
 * Agent 名、运行中标记、条数）、:923-990（行按钮双击重命名、运行中徽标、置顶图标、
 * 行尾「管理」菜单：重命名 / 置顶 / 删除）、:1360-1423（筛选下拉、多选入口、已选计数）。
 * DSH 依据：DSH 侧栏会话树 `ui-sidebar/src/client/SidebarRoot.tsx`；本单元按「主区整页」
 * 扩展，表面组件用 vendor `Button` / `Modal` / `Input` / `Tag` / `Checkbox` 与
 * `components/v2/settings/SelectMenu`。
 * 对照表行：P1:D1 P1:D2 P1:D4 P1:D5
 *
 * 未读：`Conversation`（lib/types.ts:810）没有未读字段，后端也不返回，所以不画未读标记。
 * 分组折叠状态只存在本组件里（旧页面存 localStorage 键 artex.chat.collapsed-agents，
 * 本单元不持久化）。
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import type { Conversation } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronRightOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { AgentsState } from "@/v2/data/agents";
import type { ConversationsState } from "@/v2/data/agent-conversations";
import { CONVERSATION_LIST_PAGE, conversationIsPinned } from "@/v2/data/agent-conversations";

import css from "./agent-chat.module.css";

/** 筛选值：`all` 或 `agent:<key>`（照旧页 chat/page.tsx:1361 的值形状）。 */
export type ConversationFilter = { kind: "all" } | { kind: "agent"; key: string };

/** 一个 Agent 分组（旧页 chat/page.tsx:105-132 的 AgentGroup）。 */
interface AgentGroup {
  key: string;
  name: string;
  conversations: Conversation[];
  runningCount: number;
}

export interface ConversationListProps {
  /** 对话列表状态（含加载 / 失败 / 空 / 有数据四态）。 */
  state: ConversationsState;
  /** Agent 元信息，用来取分组名与筛选选项。 */
  agents: AgentsState;
  /** 当前筛选。 */
  filter: ConversationFilter;
  /** 切换筛选。 */
  onFilter: (filter: ConversationFilter) => void;
  /** 右栏当前展示的对话；选中只在本地生效（消息区属 B08）。 */
  selectedId: number | null;
  /** 选中一行。 */
  onSelect: (id: number) => void;
  /** 提交重命名（标题已 trim 且非空）。 */
  onRename: (conversation: Conversation, title: string) => Promise<void>;
  /** 置顶 / 取消置顶。 */
  onTogglePin: (conversation: Conversation) => Promise<void>;
  /** 删除一行（调用方弹二次确认）。 */
  onDelete: (conversation: Conversation) => void;
  /** 批量删除已勾选的行（调用方弹二次确认）。 */
  onBulkDelete: (conversations: Conversation[]) => void;
}

/**
 * 按 Agent 分桶，保持传入顺序（服务端按 updated_at DESC 返回，所以首现顺序即最近活跃优先）。
 * @param conversations - 已过滤的未置顶对话。
 * @param names - agent_key → 显示名的映射。
 * @returns 每个 Agent 一组。
 */
function groupByAgent(conversations: Conversation[], names: Map<string, string>): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();
  for (const conversation of conversations) {
    let group = groups.get(conversation.agent_key);
    if (group === undefined) {
      group = {
        key: conversation.agent_key,
        name: names.get(conversation.agent_key) ?? conversation.agent_key,
        conversations: [],
        runningCount: 0,
      };
      groups.set(conversation.agent_key, group);
    }
    group.conversations.push(conversation);
    if (conversation.running === true) group.runningCount++;
  }
  return [...groups.values()];
}

/**
 * 时间显示，照旧页 chat/page.tsx:948-955（月/日 + 时分）。
 * @param iso - created_at 字符串。
 * @returns 本地时间文本；无法解析时原样返回。
 */
export function formatConversationTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 渲染左栏对话列表。
 * @param props - 列表状态、Agent 列表、筛选与选中、以及四个写操作回调。
 * @returns 筛选条 + 列表（四态齐全）。
 */
export function ConversationList({
  state,
  agents,
  filter,
  onFilter,
  selectedId,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  onBulkDelete,
}: ConversationListProps): ReactNode {
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(CONVERSATION_LIST_PAGE);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const agentNames = useMemo(
    () => new Map(agents.agents.map((agent) => [agent.key, agent.name])),
    [agents.agents],
  );

  const filtered = useMemo(
    () =>
      filter.kind === "all"
        ? state.conversations
        : state.conversations.filter((conversation) => conversation.agent_key === filter.key),
    [state.conversations, filter],
  );

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const pinnedRows = useMemo(() => visible.filter(conversationIsPinned), [visible]);
  const groups = useMemo(
    () => groupByAgent(visible.filter((conversation) => !conversationIsPinned(conversation)), agentNames),
    [visible, agentNames],
  );

  // 筛选选项：会话用到的 Agent（含已删除 / 已停用的历史 key）+ 对话类内置 Agent，
  // 照旧页 chat/page.tsx:1204-1215 的口径。
  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conversation of state.conversations) {
      counts.set(conversation.agent_key, (counts.get(conversation.agent_key) ?? 0) + 1);
    }
    const chatKeys = agents.agents
      .filter((agent) => !agent.builtin || agent.role === "assistant")
      .map((agent) => agent.key);
    const keys = new Set<string>([...chatKeys, ...counts.keys()]);
    if (filter.kind === "agent") keys.add(filter.key);
    const options: { value: string; label: string }[] = [{ value: "all", label: "全部 Agent" }];
    const rows = [...keys]
      .map((key) => ({ key, name: agentNames.get(key) ?? key, count: counts.get(key) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    for (const row of rows) {
      options.push({ value: `agent:${row.key}`, label: `${row.name}（${row.count}）` });
    }
    return options;
  }, [state.conversations, agents.agents, agentNames, filter]);

  const changeFilter = useCallback(
    (value: string): void => {
      onFilter(value === "all" ? { kind: "all" } : { kind: "agent", key: value.slice("agent:".length) });
      setSelectionMode(false);
      setSelected(new Set());
      setVisibleCount(CONVERSATION_LIST_PAGE);
      setRenamingId(null);
    },
    [onFilter],
  );

  const startRename = useCallback((conversation: Conversation): void => {
    setRenamingId(conversation.id);
    setRenameText(conversation.title);
  }, []);

  const commitRename = useCallback(
    (conversation: Conversation, value: string): void => {
      const title = value.trim();
      setRenamingId(null);
      if (title === "" || title === conversation.title) return;
      setBusyId(conversation.id);
      setFailure(null);
      onRename(conversation, title)
        .catch((reason: unknown) => {
          setFailure(`重命名失败：${reason instanceof Error ? reason.message : String(reason)}`);
        })
        .finally(() => setBusyId(null));
    },
    [onRename],
  );

  const togglePin = useCallback(
    (conversation: Conversation): void => {
      setBusyId(conversation.id);
      setFailure(null);
      onTogglePin(conversation)
        .catch((reason: unknown) => {
          setFailure(`置顶失败：${reason instanceof Error ? reason.message : String(reason)}`);
        })
        .finally(() => setBusyId(null));
    },
    [onTogglePin],
  );

  const toggleSelected = useCallback((id: number, next: boolean): void => {
    setSelected((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  const runBulkDelete = useCallback((): void => {
    // 真正的删除由调用方在二次确认弹窗里提交（见 AgentChatPage.confirmDelete）。
    const targets = filtered.filter((conversation) => selected.has(conversation.id));
    if (targets.length === 0) return;
    onBulkDelete(targets);
  }, [filtered, onBulkDelete, selected]);

  const renderRow = (conversation: Conversation, showAgent: boolean): ReactNode => {
    const pinned = conversationIsPinned(conversation);
    const title = conversation.title === "" ? "新对话" : conversation.title;
    const busy = busyId === conversation.id;
    return (
      <div
        key={conversation.id}
        className={conversation.id === selectedId ? `${css.row} ${css.rowActive}` : css.row}
        data-conversation-row={conversation.id}
        data-conversation-pinned={pinned ? "" : undefined}
        data-conversation-running={conversation.running === true ? "" : undefined}
      >
        {selectionMode ? (
          <span className={css.rowCheck}>
            <Checkbox
              checked={selected.has(conversation.id)}
              label=""
              title={`选择对话「${title}」`}
              onChange={(next) => toggleSelected(conversation.id, next)}
            />
          </span>
        ) : null}
        {renamingId === conversation.id ? (
          <div className={css.renameForm}>
            <Input
              value={renameText}
              aria-label={`重命名对话「${title}」`}
              disabled={busy}
              onChange={(event) => setRenameText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename(conversation, renameText);
                if (event.key === "Escape") setRenamingId(null);
              }}
              data-conversation-rename=""
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label="保存标题"
              title="保存标题"
              onClick={() => commitRename(conversation, renameText)}
              data-conversation-rename-save=""
            >
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label="取消重命名"
              title="取消重命名"
              icon={<IconCloseOutlineRegular size={13} />}
              onClick={() => setRenamingId(null)}
              data-conversation-rename-cancel=""
            />
          </div>
        ) : (
          <button
            type="button"
            className={css.rowMain}
            aria-current={conversation.id === selectedId ? "true" : undefined}
            title="单击选中，双击重命名"
            onClick={() => onSelect(conversation.id)}
            onDoubleClick={() => startRename(conversation)}
            data-conversation-open={conversation.id}
          >
            <span className={css.rowTitleLine}>
              {pinned ? (
                <span className={css.rowPin} data-conversation-pin="on">
                  <IconPinFillRegular size={11} />
                </span>
              ) : null}
              <span className={css.rowTitle}>{title}</span>
              {conversation.running === true ? (
                <span data-conversation-running-tag="">
                  <Tag tone="info">运行中</Tag>
                </span>
              ) : null}
            </span>
            <span className={css.rowMeta}>
              {showAgent ? (
                <span className={css.rowMetaAgent}>
                  {agentNames.get(conversation.agent_key) ?? conversation.agent_key}
                </span>
              ) : null}
              <span>{formatConversationTime(conversation.created_at)}</span>
              <span className={css.rowMetaId}>#{conversation.id}</span>
            </span>
          </button>
        )}
        {renamingId === conversation.id ? null : busy ? (
          <span className={css.rowBusy}>处理中…</span>
        ) : (
          <span className={css.rowActions}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={pinned ? `取消置顶「${title}」` : `置顶「${title}」`}
              title={pinned ? "取消置顶" : "置顶"}
              icon={pinned ? <IconPinFillRegular size={13} /> : <IconPinOutlineRegular size={13} />}
              onClick={() => togglePin(conversation)}
              data-conversation-pin-toggle={conversation.id}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`重命名「${title}」`}
              title="重命名"
              icon={<IconEditOutlineRegular size={13} />}
              onClick={() => startRename(conversation)}
              data-conversation-rename-start={conversation.id}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`删除「${title}」`}
              title="删除"
              icon={<IconTrashOutlineRegular size={13} />}
              onClick={() => onDelete(conversation)}
              data-conversation-delete={conversation.id}
            />
          </span>
        )}
      </div>
    );
  };

  const countLabel = filter.kind === "all" ? `共 ${filtered.length} 个` : `${filtered.length} / ${state.conversations.length} 个`;

  return (
    <>
      <div className={css.listBar} role="toolbar" aria-label="对话列表筛选" data-conversation-toolbar="">
        <div className={css.listBarRow}>
          <span className={css.filterLabel}>Agent</span>
          <div className={css.filterField}>
            <SelectMenu
              value={filter.kind === "all" ? "all" : `agent:${filter.key}`}
              options={filterOptions}
              onChange={changeFilter}
              ariaLabel="按 Agent 筛选对话"
            />
          </div>
        </div>
        {state.phase === "ready" && state.conversations.length > 0 ? (
          <div className={css.listBarRow}>
            {selectionMode ? (
              <>
                <Checkbox
                  checked={allSelected}
                  label=""
                  title="选择当前筛选的全部对话"
                  disabled={filtered.length === 0}
                  onChange={(next) =>
                    setSelected(next ? new Set(filtered.map((conversation) => conversation.id)) : new Set())
                  }
                />
                <span className={css.listCount}>
                  {selected.size > 0 ? `已选 ${selected.size} 个` : countLabel}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={runBulkDelete}
                  icon={<IconTrashOutlineRegular size={13} />}
                  data-conversation-bulk-delete=""
                >
                  删除
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectionMode(false);
                    setSelected(new Set());
                  }}
                  data-conversation-selection-exit=""
                >
                  完成
                </Button>
              </>
            ) : (
              <>
                <span className={css.listCount}>{countLabel}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={filtered.length === 0}
                  onClick={() => setSelectionMode(true)}
                  data-conversation-selection-start=""
                >
                  多选
                </Button>
              </>
            )}
          </div>
        ) : null}
        {failure === null ? null : (
          <p className={css.errorLine} role="alert" data-conversation-error="">
            {failure}
          </p>
        )}
      </div>

      {state.phase === "loading" ? (
        <div className={css.state} data-conversation-state="loading">
          加载中…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-conversation-state="offline">
          <span>读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-conversation-retry="">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && filtered.length === 0 ? (
        <div className={css.empty} data-conversation-state="empty">
          <span className={css.emptyTitle}>{filter.kind === "all" ? "暂无对话" : "该 Agent 暂无对话"}</span>
          <span className={css.emptyText}>用上方「新建对话」选一个 Agent 开始。</span>
        </div>
      ) : null}

      {state.phase === "ready" && filtered.length > 0 ? (
        <div className={css.listScroll} data-conversation-list="">
          {state.error === null ? null : (
            <p className={css.errorLine} role="status" data-conversation-poll-error="">
              刷新失败（显示的是上次结果）：{state.error}
            </p>
          )}
          {pinnedRows.map((conversation) => renderRow(conversation, true))}
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} data-conversation-group={group.key}>
                <button
                  type="button"
                  className={css.groupHead}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? `展开「${group.name}」` : `收起「${group.name}」`}
                  onClick={() =>
                    setCollapsed((current) => {
                      const copy = new Set(current);
                      if (!copy.delete(group.key)) copy.add(group.key);
                      return copy;
                    })
                  }
                  data-conversation-group-toggle={group.key}
                >
                  <span className={isCollapsed ? css.groupCaret : `${css.groupCaret} ${css.groupCaretOpen}`}>
                    <IconChevronRightOutlineRegular size={11} />
                  </span>
                  <span className={css.groupName}>{group.name}</span>
                  {group.runningCount > 0 ? (
                    <span data-conversation-group-running={group.runningCount}>
                      <Tag tone="info">{`${group.runningCount} 运行中`}</Tag>
                    </span>
                  ) : null}
                  <span className={css.groupCount}>{group.conversations.length}</span>
                </button>
                {isCollapsed ? null : group.conversations.map((conversation) => renderRow(conversation, false))}
              </div>
            );
          })}
          {visibleCount < filtered.length ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisibleCount((count) => count + CONVERSATION_LIST_PAGE)}
              data-conversation-more=""
            >
              显示更多（还有 {filtered.length - visibleCount} 个）
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
