"use client";

/**
 * 工作区文件查看 / 编辑面板（对照表 P2:F8）：读文件、textarea 编辑、脏标记「未保存 / 已同步」、保存、下载。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/workspace/page.tsx:284-337（右侧 Sheet 的查看 / 编辑区）、
 * :109-130（打开与保存的提交流程）、:299-307（过大与二进制时只给下载）。
 * DSH 依据：DSH 无文件管理页，按「主区整页」扩展（总表 §4.1）；弹窗外壳照
 * `components/v2/data-pages/AssetDeleteDialog.tsx:69-96` 的 `Modal` 用法（旧页是右侧 Sheet，
 * DSH 组件集里没有 Sheet，改用 Modal）。textarea 用原生元素，样式来自 `./workspace.module.css`。
 * 对照表行：P2:F8（下载按钮同时服务 P2:F6 的详情页入口）。
 *
 * 只读判定口径：完全按后端返回的 `binary` / `too_large` 字段，不做任何扩展名白名单
 * （后端 `ARTEX/server/workspace.go:120-133`：超 2 MiB 只回 too_large+binary 且无 content；
 * 含 NUL 或非 UTF-8 回 binary 且无 content）。依据见 `v2/data/workspace-manager.ts` 的
 * `useWorkspaceFile` 注释。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconDownloadOutlineRegular,
  IconSaveOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  downloadFile,
  formatFileSize,
  useWorkspaceFile,
  workspaceReadOnlyReason,
  writeFile,
} from "@/v2/data/workspace-manager";

import css from "./workspace.module.css";

export interface WorkspaceFileViewProps {
  /** 要查看的文件路径；null 时关闭面板。 */
  path: string | null;
  /** 关闭面板。 */
  onClose: () => void;
  /** 保存成功后通知外层重读目录（旧页 page.tsx:124 的 `load(path)`）。 */
  onSaved: () => void;
}

/**
 * 渲染文件的查看 / 编辑面板。
 * @param props - 目标路径、关闭回调、保存成功回调。
 * @returns 面板（`path` 为 null 时不渲染内容）。
 */
export function WorkspaceFileView({ path, onClose, onSaved }: WorkspaceFileViewProps): ReactNode {
  const state = useWorkspaceFile(path);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loaded = state.file;
  const readOnlyReason = loaded === null ? null : workspaceReadOnlyReason(loaded);
  const original = loaded?.content ?? "";

  // 读到新内容（或换了文件）后，把原文灌进编辑框并清掉失败提示。
  useEffect(() => {
    if (loaded === null) return;
    setDraft(loaded.content ?? "");
    setFailure(null);
  }, [loaded]);

  const dirty = state.phase === "ready" && readOnlyReason === null && draft !== original;

  const close = useCallback((): void => {
    if (saving) return;
    onClose();
  }, [saving, onClose]);

  const save = useCallback((): void => {
    if (loaded === null || saving || readOnlyReason !== null) return;
    setSaving(true);
    setFailure(null);
    writeFile(loaded.path, draft)
      .then(() => {
        setSaving(false);
        toast("已保存");
        onSaved();
        state.reload();
      })
      .catch((reason: unknown) => {
        setSaving(false);
        setFailure(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [loaded, saving, readOnlyReason, draft, onSaved, state]);

  const download = useCallback((): void => {
    if (loaded === null || downloading) return;
    setDownloading(true);
    setFailure(null);
    downloadFile(loaded.path)
      .catch((reason: unknown) => {
        setFailure(`下载失败：${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => setDownloading(false));
  }, [loaded, downloading]);

  const sizeText = useMemo(() => (loaded === null ? "" : formatFileSize(loaded.size)), [loaded]);

  const footer =
    loaded === null ? null : (
      <>
        <Button variant="outline" size="sm" onClick={close} disabled={saving} data-workspace-file-close="">
          关闭
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={download}
          disabled={downloading}
          icon={<IconDownloadOutlineRegular size={13} />}
          data-workspace-file-download=""
        >
          {downloading ? "下载中…" : "下载"}
        </Button>
        {readOnlyReason === null ? (
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            disabled={!dirty || saving}
            icon={<IconSaveOutlineRegular size={13} />}
            data-workspace-file-save=""
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        ) : null}
      </>
    );

  return (
    <Modal
      open={path !== null}
      onClose={close}
      title={path === null ? "文件" : path}
      closeLabel="关闭"
      description={loaded === null ? undefined : `${sizeText}${readOnlyReason === null ? "" : " · 只读"}`}
      footer={footer ?? undefined}
    >
      {state.phase === "loading" ? (
        <div className={css.state} data-workspace-file-state="loading">
          读取中…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-workspace-file-state="offline">
          <span>读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-workspace-file-retry="">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && readOnlyReason !== null ? (
        <div className={css.readOnly} data-workspace-file-state="readonly">
          <span className={css.readOnlyIcon} aria-hidden="true">
            <IconWarningOutlineRegular size={16} />
          </span>
          <p className={css.readOnlyText}>{readOnlyReason}</p>
          <Tag tone="warning">{loaded?.too_large === true ? "过大" : "二进制"}</Tag>
          <p className={css.readOnlyHint}>改用下方「下载」取得完整文件。</p>
        </div>
      ) : null}

      {state.phase === "ready" && readOnlyReason === null ? (
        <div className={css.editorWrap} data-workspace-file-state="ready">
          <div className={css.editorHead}>
            <Tag tone={dirty ? "warning" : "success"} data-workspace-file-dirty={dirty ? "1" : "0"}>
              {dirty ? "未保存" : "已同步"}
            </Tag>
            <span className={css.editorHint}>编辑后点「保存」写回工作区。</span>
          </div>
          <textarea
            className={css.editor}
            aria-label="文件内容"
            spellCheck={false}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.currentTarget.value)}
            data-workspace-file-editor=""
          />
        </div>
      ) : null}

      {failure === null ? null : (
        <p className={css.errorLine} role="alert" data-workspace-file-error="">
          {failure}
        </p>
      )}
    </Modal>
  );
}
