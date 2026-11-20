"use client";

/**
 * Session-header More menu.
 *
 * Upstream the Utilities seat hosts the context-menu launcher through
 * `renderFactorySlot('contextMenu.button', { target: { kind: 'sessionHeader' } })`
 * (`ConversationSession.tsx:209-215`), while the row set comes from the
 * ui-context-menu registry. ARTEX reuses the vendored `Menu` primitive and
 * contributes the task mutations the backend actually exposes.
 */
import { type ReactNode, useState } from "react";

import { toast } from "@/components/v2/settings/Toast";
import type { Task } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconEllipsisOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { MenuEntry } from "@/vendor/dsh/primitives/Menu";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { Modal } from "@/vendor/dsh/primitives/Modal";

import css from "./ConversationRoot.module.css";
import type { ConversationTaskActions } from "./contract";

/**
 * Render the More launcher and its menu (plus the delete confirmation).
 * @param props.task - the selected task the rows act on.
 * @param props.taskActions - pin/archive/delete callbacks owned by the shell.
 * @returns the launcher menu subtree.
 */
export function ConversationMoreMenu({
  task,
  taskActions,
}: {
  readonly task: Task;
  readonly taskActions: ConversationTaskActions;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const items: MenuEntry[] = [
    { id: "copy-id", label: "复制任务 ID" },
    { id: "pin", label: task.pinned === true ? "取消置顶" : "置顶任务" },
    { type: "separator", id: "task-mutations" },
    { id: "archive", label: "归档任务" },
    { id: "delete", label: "删除任务", danger: true },
  ];

  const onSelect = (id: string): void => {
    setOpen(false);
    switch (id) {
      case "copy-id": {
        void navigator.clipboard.writeText(task.id).then(
          () => {
            toast(`已复制任务 ID：${task.id}`);
          },
          () => {
            toast("复制失败");
          },
        );
        return;
      }
      case "pin": {
        taskActions.setPinned(task.id, task.pinned !== true);
        return;
      }
      case "archive": {
        taskActions.archive(task.id);
        return;
      }
      case "delete": {
        setConfirmDelete(true);
        return;
      }
      default: {
        return;
      }
    }
  };

  const remove = (): void => {
    setDeleting(true);
    void taskActions.remove(task.id).then(
      () => {
        setDeleting(false);
        setConfirmDelete(false);
        toast("已删除任务");
      },
      () => {
        setDeleting(false);
        toast("删除任务失败");
      },
    );
  };

  return (
    <>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        onSelect={onSelect}
        items={items}
        align="end"
        side="bottom"
        portal
        listClassName={css.moreMenu}
        anchor={
          <button
            type="button"
            className={css.headerMenuButton}
            aria-label="更多操作"
            title="更多操作"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setOpen((value) => !value);
            }}
          >
            <IconEllipsisOutlineRegular size={15} />
          </button>
        }
      />
      <Modal
        open={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        closeLabel="关闭"
        tone="warning"
        title="删除这个任务？"
        description="任务及其活动记录会被删除，此操作无法撤销。"
        footer={
          <>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              取消
            </Button>
            <Button variant="primary" disabled={deleting} onClick={remove}>
              {deleting ? "删除中…" : "删除任务"}
            </Button>
          </>
        }
      />
    </>
  );
}
