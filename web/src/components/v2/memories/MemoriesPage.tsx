"use client";

/**
 * 记忆页（W-1）：后端 `/memories` CRUD 的全局视图。
 *
 * 后端已实现而前端从未接线（排查报告 2026-11-20）；旧 mioX 页面也没有，所以
 * 没有旧页依据。形态按本仓库数据页口径（`FindingsDataPage` 同款：页头 →
 * 工具条 → 内容），组件只用 vendor 原语（`102-UI-UX规范` §5），样式只用
 * `--dsw-*`。数据全部经 `v2/data/memories.ts`：GET 列表命中后端即计一次读取
 * （`TouchMemories`），行的 hits 是真实召回数。
 * 范围：只整理 scope=global 的记忆；任务级记忆由 agent 运行时自建，行上按
 * task_id 如实展示并同样可编辑，不提供伪造 `task` 归属的入口。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconLightOutlineRegular, IconPlusOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { toast } from "@/components/v2/settings/Toast";
import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import {
  createMemory,
  deleteMemory,
  MEMORY_KIND_LABEL,
  updateMemory,
  useMemories,
  type Memory,
  type MemoryDraft,
  type MemoryKind,
} from "@/v2/data/memories";
import css from "./memories.module.css";

/** 种类筛选选项（「全部」= all）。 */
const KIND_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "all", label: "全部种类" },
  ...Object.entries(MEMORY_KIND_LABEL).map(([value, label]) => ({ value, label })),
];

/** kind 的小标签色调：目标=业务蓝、教训=危险红（记的是「别再犯」）、技巧=成功绿。 */
function kindTone(kind: MemoryKind): "info" | "danger" | "success" | "neutral" {
  if (kind === "target") return "info";
  if (kind === "lesson") return "danger";
  if (kind === "technique") return "success";
  return "neutral";
}

/** 更新时间 → `M/D HH:mm`。 */
function stampOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 记忆页主体。
 * @returns 页面（页头 / 工具条 / 四态列表 / 编辑与删除弹窗）。
 */
export function MemoriesPage(): React.ReactNode {
  const [searchDraft, setSearchDraft] = React.useState("");
  const search = useDebouncedValue(searchDraft.trim(), 250);
  const [kindFilter, setKindFilter] = React.useState("all");
  const kind = kindFilter === "all" ? null : (kindFilter as MemoryKind);
  const state = useMemories({ search, kind });

  // 一个写动作在飞时锁住所有入口，避免连点出两条。
  const [busy, setBusy] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Memory | null>(null);

  return (
    <div className={css.page} data-memories-page="">
      <header className={css.head}>
        <div className={css.headMain}>
          <h1 className={css.title}>记忆</h1>
          <p className={css.lead}>
            跨任务沉淀的笔记 / 教训 / 技巧 / 目标。任务结束后的经验由 agent 写进 `task` 级记忆；这里整理
            `global` 级，每次读取都计入命中数。
          </p>
        </div>
        <div className={css.headActions}>
          <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={13} />} onClick={() => setCreating(true)}>
            新建记忆
          </Button>
        </div>
      </header>

      <div className={css.toolbar}>
        <Input
          className={css.search}
          value={searchDraft}
          placeholder="搜标题 / 正文 / 标签"
          aria-label="搜索记忆"
          data-memories-search=""
          onChange={(event) => setSearchDraft(event.currentTarget.value)}
        />
        <SelectMenu value={kindFilter} options={KIND_OPTIONS} ariaLabel="按种类筛选记忆" onChange={setKindFilter} />
        <Button variant="outline" size="sm" disabled={state.phase === "loading"} title="重新读取" onClick={state.reload}>
          刷新
        </Button>
        <span className={css.count} data-memories-total="">
          {state.phase === "ready"
            ? `${state.items.length} 条 · 累计读 ${state.items.reduce((sum, item) => sum + item.hits, 0)} 次`
            : ""}
        </span>
      </div>

      {state.phase === "loading" ? <div className={css.state}>读取记忆…</div> : null}
      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-memories-state="offline">
          <span>读取失败：{state.error ?? "未知原因"}</span>
          <Button variant="outline" size="sm" onClick={state.reload}>
            重试
          </Button>
        </div>
      ) : null}
      {state.phase === "ready" && state.items.length === 0 ? (
        <div className={css.empty} data-memories-state="empty">
          <span className={css.emptyIcon} aria-hidden="true">
            <IconLightOutlineRegular size={18} />
          </span>
          <span className={css.emptyTitle}>
            {search !== "" || kind !== null ? "没有匹配的记忆" : "还没有记忆"}
          </span>
          <span className={css.emptyText}>
            {search !== "" || kind !== null
              ? "换个关键词或清除筛选再看。"
              : "任务跑完后 agent 会把可复用的经验写进来，不用手工占位。"}
          </span>
        </div>
      ) : null}

      {state.phase === "ready" && state.items.length > 0 ? (
        <ul className={css.list} data-memories-rows="">
          {state.items.map((item) => (
            <li key={item.id} className={css.row} data-memories-row={item.id}>
              <div className={css.rowMain}>
                <div className={css.rowTop}>
                  <Tag tone={kindTone(item.kind)}>{MEMORY_KIND_LABEL[item.kind]}</Tag>
                  <span className={css.rowTitle} title={item.title}>
                    {item.title}
                  </span>
                  <span className={css.rowHits} title="每次读取都会计入命中数（后端 TouchMemories）">
                    读 {item.hits} 次
                  </span>
                </div>
                <p className={css.rowContent}>{item.content}</p>
                <div className={css.rowMeta}>
                  {item.tags.length > 0 ? (
                    <span className={css.tags}>
                      {[...new Set(item.tags)].map((tag) => (
                        <span key={tag} className={css.tag}>
                          #{tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {item.scope === "task" && item.task_id !== undefined && item.task_id !== "" ? (
                    <span className={css.taskRef}>任务 {item.task_id}</span>
                  ) : null}
                  <span className={css.stamp} title={item.updated_at}>
                    {stampOf(item.updated_at)}
                  </span>
                </div>
              </div>
              <div className={css.rowAside}>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(item)}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" className={css.danger} disabled={busy} onClick={() => setDeleteTarget(item)}>
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {creating || editing !== null ? (
        <MemoryEditor
          initial={editing}
          busy={busy}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(phase) => {
            setCreating(false);
            setEditing(null);
            state.reload();
            toast(phase === "created" ? "记忆已创建" : "记忆已保存");
          }}
          onSaveError={(reason) => {
            toast(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
          }}
          onBusy={setBusy}
        />
      ) : null}

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!busy) setDeleteTarget(null);
        }}
        closeLabel="关闭并取消删除"
        tone="warning"
        title={`删除记忆「${deleteTarget?.title ?? ""}」？`}
        description="删除后 agent 的后续任务无法再召回这条经验，且不可恢复。"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (deleteTarget === null) return;
                setBusy(true);
                void deleteMemory(deleteTarget.id)
                  .then(() => {
                    setBusy(false);
                    setDeleteTarget(null);
                    state.reload();
                    toast("记忆已删除");
                  })
                  .catch((reason: unknown) => {
                    setBusy(false);
                    toast(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
                  });
              }}
            >
              {busy ? "删除中…" : "删除"}
            </Button>
          </>
        }
      >
        <p className={css.deleteLead}>
          「{deleteTarget?.title}」
          {deleteTarget === null ? "" : ` · ${MEMORY_KIND_LABEL[deleteTarget.kind]}`}
        </p>
      </Modal>
    </div>
  );
}

/**
 * 新建 / 编辑共用的编辑器：种类 + 标题 + 正文 + 标签（逗号分隔）。
 * @param props.initial - 编辑时的原记忆；null 表示新建。
 * @param props.busy - 页面级写锁。
 * @returns 保存弹窗。
 */
function MemoryEditor({
  initial,
  busy,
  onClose,
  onSaved,
  onSaveError,
  onBusy,
}: {
  readonly initial: Memory | null;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSaved: (phase: "created" | "saved") => void;
  readonly onSaveError: (reason: unknown) => void;
  readonly onBusy: (next: boolean) => void;
}): React.ReactNode {
  const [kind, setKind] = React.useState<MemoryKind>(initial?.kind ?? "note");
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [content, setContent] = React.useState(initial?.content ?? "");
  const [tagsDraft, setTagsDraft] = React.useState((initial?.tags ?? []).join(", "));
  const [working, setWorking] = React.useState(false);

  const draft: MemoryDraft = {
    kind,
    title: title.trim(),
    content,
    tags: tagsDraft
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ""),
  };
  const blocked = working || busy || draft.title === "" || draft.content.trim() === "";

  return (
    <Modal
      open
      onClose={() => {
        if (!working && !busy) onClose();
      }}
      closeLabel="关闭"
      title={initial === null ? "新建记忆" : "编辑记忆"}
      description={initial === null ? "写成以后 agent 在任何任务里都召回得到。" : undefined}
      footer={
        <>
          <Button variant="outline" disabled={working || busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() => {
              setWorking(true);
              onBusy(true);
              const write = initial === null ? createMemory(draft) : updateMemory(initial.id, draft);
              void write
                .then(() => {
                  setWorking(false);
                  onBusy(false);
                  onSaved(initial === null ? "created" : "saved");
                })
                .catch((reason: unknown) => {
                  setWorking(false);
                  onBusy(false);
                  onSaveError(reason);
                });
            }}
          >
            {working ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className={css.editor}>
        <label className={css.field} htmlFor="memory-kind">种类</label>
        <SelectMenu
          value={kind}
          options={Object.entries(MEMORY_KIND_LABEL).map(([value, label]) => ({ value, label }))}
          ariaLabel="记忆种类"
          onChange={(next) => setKind(next as MemoryKind)}
        />
        <label className={css.field} htmlFor="memory-title">标题</label>
        <Input
          value={title}
          placeholder="一句话标题"
          aria-label="记忆标题"
          data-memories-title=""
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <label className={css.field} htmlFor="memory-content">正文</label>
        <textarea
          className={css.textarea}
          value={content}
          placeholder="经验、教训或做法的完整描述"
          aria-label="记忆正文"
          data-memories-content=""
          rows={8}
          onChange={(event) => setContent(event.target.value)}
        />
        <label className={css.field} htmlFor="memory-tags">标签（逗号分隔）</label>
        <Input
          value={tagsDraft}
          placeholder="如：登录, 越权, 内网"
          aria-label="记忆标签"
          data-memories-tags=""
          onChange={(event) => setTagsDraft(event.currentTarget.value)}
        />
      </div>
    </Modal>
  );
}
