"use client";

/**
 * 工作区文件页（对照表 P2:F1–P2:F8）：面包屑、目录列表、进入子目录、新建文件夹、上传，
 * 以及 B10 的刷新、点文件查看/编辑、下载、删除。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/workspace/page.tsx:172-282（头部面包屑与操作、
 * 目录表）、:339-361（新建文件夹弹窗）、:143-170（上传与新建的提交流程）、
 * :201-203（刷新按钮）、:236-247（点文件名进入目录或打开文件）、:253-276（行内下载 / 删除）、
 * :132-141（删除流程）、:109-130（打开与保存）、:284-337（查看 / 编辑面板，在本目录的 WorkspaceFileView.tsx）。
 * DSH 依据：DSH 无文件管理页，按「主区整页」扩展（总表 §4.1）；外壳与工具条几何照抄
 * `components/v2/findings/FindingsDataPage.tsx:232-249`，弹窗用
 * `components/v2/data-pages/AssetDeleteDialog.tsx:69-96` 的 `Modal` 写法。
 * 主区整页的 body 不带参数、自己通过 `v2/data/` 取数（总表 §4.1 第 1 步）。
 *
 * 删除的确认文案按后端真实行为写：`ARTEX/server/workspace.go:187-208` 的 DELETE 对目录走
 * `os.RemoveAll`，即整棵子树一起删掉且不可撤销；目录行在列表里显示的就是非空目录
 * （空目录也会同样递归删除），所以「目录 → 含其下所有内容」的警告一律给出。
 */
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  IconChevronRightOutlineRegular,
  IconDeliverDocRegular,
  IconDownloadOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenOutlineRegular,
  IconProjectAddOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  IconUploadOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { WorkspaceEntry } from "@/lib/types";
import {
  createFolder,
  deleteEntry,
  downloadFile,
  formatFileSize,
  formatFileTime,
  joinWorkspacePath,
  uploadFiles,
  useWorkspaceDir,
  workspaceCrumbs,
} from "@/v2/data/workspace-manager";

import { WorkspaceFileView } from "./WorkspaceFileView";
import css from "./workspace.module.css";

/**
 * 渲染工作区文件页。
 * @returns 页头、面包屑、新建文件夹 / 上传 / 刷新入口，当前目录的列表，查看编辑面板与删除确认。
 */
export function WorkspacePage(): ReactNode {
  const [dir, setDir] = useState("");
  const state = useWorkspaceDir(dir);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [busy, setBusy] = useState<"mkdir" | "upload" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 正在查看/编辑的文件路径；null 表示面板关闭。 */
  const [openPath, setOpenPath] = useState<string | null>(null);
  /** 待删除的条目；null 表示确认弹窗关闭。 */
  const [pendingDelete, setPendingDelete] = useState<WorkspaceEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** 正在下载的行路径（只用于禁用并标记该行按钮）。 */
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const openMkdir = useCallback((): void => {
    setMkdirName("");
    setFailure(null);
    setMkdirOpen(true);
  }, []);

  const closeMkdir = useCallback((): void => {
    if (busy === "mkdir") return;
    setMkdirOpen(false);
  }, [busy]);

  const submitMkdir = useCallback((): void => {
    const name = mkdirName.trim();
    if (name === "" || busy !== null) return;
    setBusy("mkdir");
    setFailure(null);
    createFolder(joinWorkspacePath(state.path, name))
      .then(() => {
        setBusy(null);
        setMkdirOpen(false);
        setMkdirName("");
        toast("已创建目录");
        state.reload();
      })
      .catch((reason: unknown) => {
        setBusy(null);
        setFailure(`创建失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [busy, mkdirName, state]);

  const onPick = useCallback(
    (picked: FileList | null): void => {
      const files = picked === null ? [] : Array.from(picked);
      if (fileRef.current !== null) fileRef.current.value = "";
      if (files.length === 0) return;
      setBusy("upload");
      setFailure(null);
      uploadFiles(state.path, files)
        .then((result) => {
          setBusy(null);
          toast(`已上传 ${result.uploaded} 个文件`);
          state.reload();
        })
        .catch((reason: unknown) => {
          setBusy(null);
          setFailure(`上传失败：${reason instanceof Error ? reason.message : String(reason)}`);
        });
    },
    [state],
  );

  const crumbs = useMemo(() => workspaceCrumbs(state.path), [state.path]);

  /** 打开一个文件（旧页 page.tsx:109-114、:238：非目录的条目点名称即打开）。 */
  const openEntry = useCallback((entry: WorkspaceEntry): void => {
    setOpenPath(entry.path);
  }, []);

  const closeFile = useCallback((): void => {
    setOpenPath(null);
  }, []);

  /** 保存成功后重读当前目录，让大小与修改时间跟上（旧页 page.tsx:124）。 */
  const afterSaved = useCallback((): void => {
    state.reload();
  }, [state]);

  /** 下载一个文件（旧页 page.tsx:261、:304、:323）。 */
  const downloadEntry = useCallback((entry: WorkspaceEntry): void => {
    setDownloadingPath(entry.path);
    setFailure(null);
    downloadFile(entry.path)
      .catch((reason: unknown) => {
        setFailure(`下载失败：${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => setDownloadingPath(null));
  }, []);

  const askDelete = useCallback((entry: WorkspaceEntry): void => {
    setDeleteError(null);
    setPendingDelete(entry);
  }, []);

  const cancelDelete = useCallback((): void => {
    if (deleting) return;
    setPendingDelete(null);
  }, [deleting]);

  /** 确认删除（旧页 page.tsx:132-141：成功后重读目录）。 */
  const confirmDelete = useCallback((): void => {
    if (pendingDelete === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    deleteEntry(pendingDelete.path)
      .then(() => {
        setDeleting(false);
        setPendingDelete(null);
        toast("已删除");
        state.reload();
      })
      .catch((reason: unknown) => {
        setDeleting(false);
        setDeleteError(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [pendingDelete, deleting, state]);

  return (
    <div data-data-page="workspace" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>工作区文件</h1>
          <p className={css.lead}>任务工作目录的文件浏览器：进入子目录、新建文件夹、上传、查看编辑、下载、删除。</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="工作区文件动作" data-data-page-toolbar="workspace">
          <Button
            variant="ghost"
            size="sm"
            disabled={state.phase === "loading"}
            onClick={state.reload}
            title="刷新当前目录"
            aria-label="刷新当前目录"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-workspace-action="refresh"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={openMkdir}
            icon={<IconProjectAddOutlineRegular size={13} />}
            data-workspace-action="mkdir"
          >
            新建文件夹
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className={css.fileInput}
            data-workspace-upload-input=""
            onChange={(event) => onPick(event.currentTarget.files)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
            icon={<IconUploadOutlineRegular size={13} />}
            data-workspace-action="upload"
          >
            {busy === "upload" ? "上传中…" : "上传"}
          </Button>
        </div>
      </header>

      <nav className={css.crumbs} aria-label="目录路径" data-workspace-crumbs="">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={crumb.path === "" ? "/" : crumb.path} className={css.crumbItem}>
              {index > 0 ? (
                <IconChevronRightOutlineRegular size={11} className={css.crumbSep} aria-hidden="true" />
              ) : null}
              <button
                type="button"
                className={last ? `${css.crumb} ${css.crumbCurrent}` : css.crumb}
                aria-current={last ? "page" : undefined}
                disabled={last}
                onClick={() => setDir(crumb.path)}
                data-workspace-crumb={crumb.path === "" ? "/" : crumb.path}
              >
                {crumb.name}
              </button>
            </span>
          );
        })}
      </nav>

      {failure === null ? null : (
        <p className={css.errorLine} role="alert" data-workspace-error="">
          {failure}
        </p>
      )}

      {state.phase === "loading" ? (
        <div className={css.state} data-workspace-state="loading">
          加载中…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-workspace-state="offline">
          <span>读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-workspace-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && state.entries.length === 0 ? (
        <div className={css.empty} data-workspace-state="empty">
          <IconFolderOpenOutlineRegular size={20} />
          <span className={css.emptyTitle}>空目录</span>
          <span className={css.emptyText}>可以用右上角「新建文件夹」或「上传」往这里放内容。</span>
        </div>
      ) : null}

      {state.phase === "ready" && state.entries.length > 0 ? (
        <div className={css.tableWrap}>
          <table className={css.table} data-workspace-rows="">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col" className={css.colSize}>
                  大小
                </th>
                <th scope="col" className={css.colTime}>
                  修改时间
                </th>
                <th scope="col" className={css.colActions}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((entry) => (
                <tr key={entry.path} data-workspace-row={entry.path} data-workspace-dir={entry.dir ? "" : undefined}>
                  <td className={css.cellName}>
                    <span className={css.glyph} aria-hidden="true">
                      {entry.dir ? (
                        <IconFolderCloseRegular size={14} />
                      ) : (
                        <IconDeliverDocRegular size={14} />
                      )}
                    </span>
                    <button
                      type="button"
                      className={css.nameBtn}
                      title={entry.dir ? `进入 ${entry.name}` : `打开 ${entry.name}`}
                      onClick={() => (entry.dir ? setDir(entry.path) : openEntry(entry))}
                      data-workspace-enter={entry.dir ? entry.path : undefined}
                      data-workspace-open={entry.dir ? undefined : entry.path}
                    >
                      {entry.name}
                    </button>
                  </td>
                  <td className={css.colSize}>{entry.dir ? "—" : formatFileSize(entry.size)}</td>
                  <td className={css.colTime}>{formatFileTime(entry.mtime)}</td>
                  <td className={css.colActions}>
                    <span className={css.rowActions}>
                      {entry.dir ? null : (
                        <button
                          type="button"
                          className={css.iconBtn}
                          title="下载"
                          aria-label={`下载 ${entry.name}`}
                          disabled={downloadingPath === entry.path}
                          onClick={() => downloadEntry(entry)}
                          data-workspace-download={entry.path}
                        >
                          <IconDownloadOutlineRegular size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${css.iconBtn} ${css.iconBtnDanger}`}
                        title="删除"
                        aria-label={`删除 ${entry.name}`}
                        onClick={() => askDelete(entry)}
                        data-workspace-delete={entry.path}
                      >
                        <IconTrashOutlineRegular size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={mkdirOpen}
        onClose={closeMkdir}
        title="新建文件夹"
        closeLabel="关闭"
        description={`在「${state.path === "" ? "工作空间" : state.path}」下创建。`}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeMkdir} disabled={busy === "mkdir"} data-workspace-mkdir-cancel="">
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitMkdir}
              disabled={busy === "mkdir" || mkdirName.trim() === ""}
              data-workspace-mkdir-confirm=""
            >
              {busy === "mkdir" ? "创建中…" : "创建"}
            </Button>
          </>
        }
      >
        <Input
          data-modal-autofocus
          value={mkdirName}
          aria-label="文件夹名称"
          placeholder="文件夹名称"
          disabled={busy === "mkdir"}
          onChange={(event) => setMkdirName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitMkdir();
          }}
          data-workspace-mkdir-name=""
        />
        {failure === null ? null : (
          <p className={css.errorLine} role="alert">
            {failure}
          </p>
        )}
      </Modal>

      <WorkspaceFileView path={openPath} onClose={closeFile} onSaved={afterSaved} />

      <Modal
        open={pendingDelete !== null}
        onClose={cancelDelete}
        title="确认删除"
        closeLabel="关闭"
        tone="warning"
        description={
          pendingDelete === null
            ? undefined
            : `将永久删除工作区里的${pendingDelete.dir ? "目录" : "文件"}「${pendingDelete.name}」，此操作不可撤销。`
        }
        footer={
          <>
            <Button variant="outline" size="sm" onClick={cancelDelete} disabled={deleting} data-workspace-delete-cancel="">
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirmDelete}
              disabled={deleting}
              data-workspace-delete-confirm=""
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={css.confirmBody}>
          <p style={{ margin: 0, fontFamily: "var(--ds-font-family-code)", overflowWrap: "anywhere" }}>
            {pendingDelete?.path ?? ""}
          </p>
          {pendingDelete !== null && pendingDelete.dir ? (
            <p className={css.confirmWarn} data-workspace-delete-warn="">
              <IconWarningOutlineRegular size={14} aria-hidden="true" />
              <span>这是目录：会连同其下所有文件和子目录一起删除，无法恢复。</span>
            </p>
          ) : null}
          {pendingDelete !== null && !pendingDelete.dir && pendingDelete.size > 0 ? (
            <p className={css.deleteMeta}>
              文件大小 {formatFileSize(pendingDelete.size)}。
            </p>
          ) : null}
          {deleteError === null ? null : (
            <p className={css.errorLine} role="alert" data-workspace-delete-error="">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
