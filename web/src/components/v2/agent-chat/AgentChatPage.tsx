"use client";

/**
 * Agent 对话页（主区整页「Agent 对话」，对照表 P1:D1–P1:D5）：
 * 左栏对话列表 + 新建对话，右栏先放「选择一个对话」空状态。
 * 旧页面依据：ARTEX/web/src/app/(main)/chat/page.tsx:1348-1359（左列表 / 右消息的两栏骨架）、
 * :1357-1359（「新建对话」按钮）、:421-444（先选 Agent 再创建对话）、:1255-1346（删除 / 批量删除 /
 * 置顶 / 重命名）。
 * DSH 依据：DSH 无独立 Agent 对话页，按「主区整页」扩展（总表 §4.1）；页头几何照抄
 * `components/v2/workspace/WorkspacePage.tsx:110-145`，删除确认照抄
 * `components/v2/data-pages/AssetDeleteDialog.tsx:69-96` 的 `Modal` 写法（tone="warning"、
 * 取消 / 确认两个按钮、忙碌时都 disabled）。
 * 对照表行：P1:D1 P1:D2 P1:D3 P1:D4 P1:D5
 *
 * 右栏消息区属于 B08（P1:D6–D11）：没有选中对话时显示「选择一个对话」空状态，
 * 选中对话时渲染 `ConversationPane`（消息流、输入与发送、停止、详情、对话级模型）。
 * 选中对话只是本页的本地状态，不写地址栏。
 */
import { type ReactNode, useCallback, useState } from "react";

import type { Conversation } from "@/lib/types";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { toast } from "@/components/v2/settings/Toast";
import { useAgents } from "@/v2/data/agents";
import {
  createConversation,
  deleteConversation,
  deleteConversations,
  pinConversation,
  renameConversation,
  useConversations,
} from "@/v2/data/agent-conversations";

import { ConversationList, type ConversationFilter } from "./ConversationList";
import { ConversationPane } from "./ConversationPane";
import css from "./agent-chat.module.css";

/** 删除确认弹窗的目标：一行或一批。 */
type DeleteTarget = { kind: "one"; conversations: Conversation[] } | { kind: "many"; conversations: Conversation[] };

/** 弹窗里显示的标题（空标题按旧页 chat/page.tsx:268 显示「新对话」）。 */
function conversationLabel(conversation: Conversation): string {
  return conversation.title.trim() === "" ? "新对话" : conversation.title;
}

/**
 * 渲染 Agent 对话页。
 * @returns 页头、「新建对话」弹窗、左栏列表、右栏空状态、删除确认弹窗。
 */
export function AgentChatPage(): ReactNode {
  const conversations = useConversations();
  const agents = useAgents();
  const [filter, setFilter] = useState<ConversationFilter>({ kind: "all" });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createAgentKey, setCreateAgentKey] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createFailure, setCreateFailure] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);

  const openCreate = useCallback((): void => {
    setCreateFailure(null);
    setCreateTitle("");
    setCreateAgentKey("");
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback((): void => {
    if (creating) return;
    setCreateOpen(false);
  }, [creating]);

  const submitCreate = useCallback((): void => {
    if (createAgentKey === "" || creating) return;
    setCreating(true);
    setCreateFailure(null);
    createConversation(createAgentKey, createTitle.trim())
      .then((conversation) => {
        setCreating(false);
        setCreateOpen(false);
        setCreateTitle("");
        setSelectedId(conversation.id);
        toast("已新建对话");
        conversations.reload();
      })
      .catch((reason: unknown) => {
        setCreating(false);
        setCreateFailure(`新建失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [conversations, createAgentKey, createTitle, creating]);

  const rename = useCallback(
    async (conversation: Conversation, title: string): Promise<void> => {
      await renameConversation(conversation.id, title);
      toast("已重命名");
      conversations.reload();
    },
    [conversations],
  );

  const togglePin = useCallback(
    async (conversation: Conversation): Promise<void> => {
      const pinned = conversation.pinned ?? Boolean(conversation.pinned_at);
      await pinConversation(conversation.id, !pinned);
      toast(pinned ? "已取消置顶" : "已置顶");
      conversations.reload();
    },
    [conversations],
  );

  // ---- 删除：一律先弹二次确认（红线 5 / 总表 §5.5）----

  const askDeleteOne = useCallback((conversation: Conversation): void => {
    setDeleteFailure(null);
    setDeleteTarget({ kind: "one", conversations: [conversation] });
  }, []);

  const askDeleteMany = useCallback((targets: Conversation[]): void => {
    if (targets.length === 0) return;
    setDeleteFailure(null);
    setDeleteTarget({ kind: "many", conversations: targets });
  }, []);

  const closeDelete = useCallback((): void => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteFailure(null);
  }, [deleting]);

  const confirmDelete = useCallback((): void => {
    if (deleteTarget === null || deleting) return;
    const targets = deleteTarget.conversations;
    setDeleting(true);
    setDeleteFailure(null);
    const request =
      targets.length === 1
        ? deleteConversation(targets[0].id).then(() => ({
            deleted: [targets[0].id],
            failed: [] as { id: number; error: string }[],
          }))
        : deleteConversations(targets.map((conversation) => conversation.id));
    request
      .then((outcome) => {
        setDeleting(false);
        setDeleteTarget(null);
        if (selectedId !== null && outcome.deleted.includes(selectedId)) setSelectedId(null);
        if (targets.length === 1 && outcome.failed.length === 0) {
          toast("已删除对话");
        } else if (outcome.failed.length === 0) {
          toast(`已删除 ${outcome.deleted.length} 个对话`);
        } else {
          const details = outcome.failed
            .slice(0, 3)
            .map((item) => `#${item.id}（${item.error}）`)
            .join("；");
          toast(`${outcome.failed.length} 个对话删除失败：${details}`);
        }
        conversations.reload();
      })
      .catch((reason: unknown) => {
        setDeleting(false);
        setDeleteFailure(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [conversations, deleteTarget, deleting, selectedId]);

  const deleteCount = deleteTarget === null ? 0 : deleteTarget.conversations.length;
  const deletePreview =
    deleteTarget === null ? "" : deleteTarget.conversations.slice(0, 3).map(conversationLabel).join("、");

  const selected = conversations.conversations.find((conversation) => conversation.id === selectedId) ?? null;
  // 可新建对话的 Agent：自定义 + 对话类内置（role=assistant），照旧页 chat/page.tsx:1203。
  const creatableAgents = agents.agents.filter((agent) => !agent.builtin || agent.role === "assistant");

  return (
    <div data-data-page="conversations" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>Agent 对话</h1>
          <p className={css.lead}>跨任务的 Agent 对话：按 Agent 分组与筛选，支持新建、重命名、置顶与删除。</p>
        </div>
        <div
          className={css.headActions}
          role="toolbar"
          aria-label="Agent 对话页头动作"
          data-data-page-toolbar="conversations"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={conversations.reload}
            title="重新读取对话列表"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-conversation-action="refresh"
          >
            刷新
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            icon={<IconPlusOutlineRegular size={13} />}
            data-conversation-action="create"
          >
            新建对话
          </Button>
        </div>
      </header>

      {agents.phase === "offline" ? (
        <p className={css.notice} role="status" data-conversation-agents-offline="">
          Agent 列表读取失败（{agents.error}）：新建对话需要它，分组名会退化成 agent key。
          <Button variant="outline" size="sm" onClick={agents.reload}>
            重试
          </Button>
        </p>
      ) : null}

      <div className={css.split}>
        <div className={css.listPane} data-conversation-list-pane="">
          <ConversationList
            state={conversations}
            agents={agents}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRename={rename}
            onTogglePin={togglePin}
            onDelete={askDeleteOne}
            onBulkDelete={askDeleteMany}
          />
        </div>

        <section className={css.detailPane} aria-label="对话内容" data-conversation-detail="">
          {selected === null ? (
            <div className={css.detailEmpty} data-conversation-detail-empty="">
              <span className={css.detailEmptyTitle}>选择一个对话</span>
              <span className={css.detailEmptyText}>从左侧列表选中一个对话，即可查看消息并继续对话。</span>
            </div>
          ) : (
            <ConversationPane
              key={selected.id}
              conversation={selected}
              agentName={
                agents.agents.find((agent) => agent.key === selected.agent_key)?.name ?? selected.agent_key
              }
              agentBuiltin={
                agents.agents.find((agent) => agent.key === selected.agent_key)?.builtin ?? true
              }
              agentDescription={
                agents.agents.find((agent) => agent.key === selected.agent_key)?.description ?? ""
              }
              onConversationChanged={conversations.reload}
            />
          )}
        </section>
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="新建对话"
        closeLabel="关闭"
        description="先选一个 Agent；标题留空则交给后端默认。"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={closeCreate}
              disabled={creating}
              data-conversation-create-cancel=""
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitCreate}
              disabled={creating || createAgentKey === ""}
              data-conversation-create-confirm=""
            >
              {creating ? "创建中…" : "创建"}
            </Button>
          </>
        }
      >
        <div className={css.dialogStack}>
          <div className={css.dialogField}>
            <span className={css.dialogLabel}>Agent</span>
            {creatableAgents.length === 0 ? (
              <p className={css.dialogHint}>
                {agents.phase === "loading" ? "正在读取 Agent 列表…" : "没有可用的 Agent，无法新建对话。"}
              </p>
            ) : (
              <div role="radiogroup" aria-label="选择 Agent" data-conversation-create-agents="">
                {creatableAgents.map((agent) => (
                  <label key={agent.key} className={css.dialogChoice}>
                    <input
                      type="radio"
                      name="conversation-create-agent"
                      checked={createAgentKey === agent.key}
                      disabled={creating}
                      onChange={() => setCreateAgentKey(agent.key)}
                      data-conversation-create-agent={agent.key}
                    />
                    <span>{`${agent.name}${agent.builtin ? "" : "（自定义）"}`}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={css.dialogField}>
            <span className={css.dialogLabel}>标题（可选）</span>
            <Input
              value={createTitle}
              aria-label="对话标题"
              placeholder="留空则由后端生成"
              disabled={creating}
              onChange={(event) => setCreateTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCreate();
              }}
              data-conversation-create-title=""
            />
          </div>
          {createFailure === null ? null : (
            <p className={css.errorLine} role="alert">
              {createFailure}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        title={deleteCount > 1 ? "确认批量删除" : "确认删除"}
        closeLabel="关闭"
        tone="warning"
        description={`将永久删除 ${deleteCount} 个对话及其全部消息，此操作不可撤销。`}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={closeDelete}
              disabled={deleting}
              data-conversation-delete-cancel=""
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirmDelete}
              disabled={deleting}
              data-conversation-delete-confirm=""
              icon={<IconTrashOutlineRegular size={13} />}
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={css.dialogStack}>
          <p className={css.dialogText} data-conversation-delete-count={deleteCount}>
            {deletePreview}
            {deleteCount > 3 ? ` 等 ${deleteCount} 个` : ""}
          </p>
          {deleteFailure === null ? null : (
            <p className={css.errorLine} role="alert">
              {deleteFailure}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
