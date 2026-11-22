"use client";

/**
 * Workspace flows, mirroring packages/client/ui-workspace:
 *   - add: adopt a picked host directory (WorkspacePicker.tsx `createWorkspace({ path })`),
 *     the flow stays busy until the answer lands, and a failure opens the folder-error
 *     dialog whose action reopens the flow;
 *   - rename / delete: the two confirmation dialogs in WorkspaceDialogs.tsx, including
 *     the duplicate-title guard and the delete dialog's pending status.
 */
import * as React from "react";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { IconFolderOpenRegular } from "@/vendor/dsh/primitives/icons/index";
import css from "./WorkspaceFlow.module.css";

const CANDIDATE_DIRS = ["D:\\demo", "D:\\projects\\miox-lab"];

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

type Flow = { kind: "add" } | { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

export function WorkspaceFlow({
  open,
  onClose,
  workspaces,
  onCreate,
  onRename,
  onDelete,
}: {
  open: Flow;
  onClose: () => void;
  workspaces: { id: string; title: string }[];
  onCreate: (path: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const target = open !== null && open.kind !== "add"
    ? workspaces.find((w) => w.id === open.id) ?? null
    : null;

  React.useEffect(() => {
    if (open?.kind === "rename") setDraft(workspaces.find((w) => w.id === open.id)?.title ?? "");
    setError(null);
  }, [open, workspaces]);

  // Adopting a directory is async in the product: keep the flow busy, then close.
  const adopt = (path: string): void => {
    setBusy(true);
    setError(null);
    window.setTimeout(() => {
      setBusy(false);
      onCreate(path);
      onClose();
    }, 500);
  };

  const trimmed = draft.trim();
  const duplicate = open?.kind === "rename" && target !== null && trimmed !== ""
    && workspaces.some((w) => w.id !== target.id && w.title === trimmed);
  const renameBlocked = busy || trimmed === "" || target === null
    || trimmed === target.title || duplicate;

  return (
    <>
      {/* Add workspace = pick a directory. There is no title field: the title
          derives from the picked path. */}
      <Modal
        open={open?.kind === "add"}
        onClose={() => { if (!busy) onClose(); }}
        closeLabel="关闭"
        title="添加工作区"
        description="选择一个目录作为工作区。工作区名称取自目录名。"
        footer={<Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>}
      >
        <div className={css.dirList}>
          {CANDIDATE_DIRS.map((path) => (
            <button key={path} type="button" className={css.dirRow} disabled={busy} onClick={() => adopt(path)}>
              <IconFolderOpenRegular size={14} />
              <span className={css.dirPath}>{path}</span>
              <span className={css.dirName}>{basename(path)}</span>
            </button>
          ))}
        </div>
        {busy ? <div className={css.status} role="status">正在添加工作区…</div> : null}
      </Modal>

      {/* Folder-error dialog: its action reopens the flow. */}
      <Modal
        open={error !== null}
        onClose={() => setError(null)}
        closeLabel="关闭"
        title="无法添加工作区"
        description={error ?? ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setError(null)}>取消</Button>
            <Button variant="primary" onClick={() => setError(null)}>重新选择</Button>
          </>
        }
      >
        <span />
      </Modal>

      <Modal
        open={open?.kind === "rename"}
        onClose={() => { if (!busy) onClose(); }}
        closeLabel="关闭"
        title="重命名工作区"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
            <Button
              variant="primary"
              disabled={renameBlocked}
              onClick={() => {
                if (renameBlocked || target === null) return;
                setBusy(true);
                window.setTimeout(() => {
                  setBusy(false);
                  onRename(target.id, trimmed);
                  onClose();
                }, 300);
              }}
            >
              重命名
            </Button>
          </>
        }
      >
        <input
          className={css.input}
          value={draft}
          aria-label="工作区名称"
          autoFocus
          disabled={busy}
          onFocus={(e) => e.target.select()}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !renameBlocked && target !== null) {
              e.preventDefault();
              onRename(target.id, trimmed);
              onClose();
            }
          }}
        />
        {duplicate ? <div className={css.error} role="alert">已存在同名工作区「{trimmed}」。</div> : null}
      </Modal>

      <Modal
        open={open?.kind === "delete"}
        onClose={() => { if (!busy) onClose(); }}
        closeLabel="关闭"
        title="删除工作区"
        description={target === null ? "" : `确认删除「${target.title}」？该工作区下的会话不会被删除。`}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
            <Button
              variant="outline"
              className={css.danger}
              disabled={busy || target === null}
              onClick={() => {
                if (target === null) return;
                setBusy(true);
                window.setTimeout(() => {
                  setBusy(false);
                  onDelete(target.id);
                  onClose();
                }, 300);
              }}
            >
              删除工作区
            </Button>
          </>
        }
      >
        {busy ? <div className={css.status} role="status">正在删除…</div> : <span />}
      </Modal>
    </>
  );
}
