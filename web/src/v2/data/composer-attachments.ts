"use client";

/**
 * Draft attachments for the composer: one upload lifecycle per picked file.
 *
 * Port of the draft-attachment staging in DSH (
 * `ui-conversation/src/client/service.ts:330-441` + `input/facade.ts:349-352`):
 * every picked file becomes its own draft entry with a runtime id, uploads
 * immediately through `api.chatUpload`, and appends to the list in pick order.
 * Picking the same file twice appends a second entry — the source maps files to
 * drafts without deduplicating (`service.ts:330-348`) and the input facade
 * appends the ids (`input/facade.ts:349-352`), so no name/size dedupe is done
 * here either. An image draft gets its browser-local object URL as the square
 * thumbnail (`contract/slots.ts:43-52` `previewUrl`); it is presentation-only
 * and revoked with the draft, never persisted. Send is held while any draft is
 * not ready, matching the source's `uploadsPending` gate (`InputBar.tsx:98-104`)
 * and its send guard (`service.ts:246-253`).
 *
 * The six-draft cap comes from this product's existing composer rule
 * (`task-workspace-dsh.tsx` `MAX_ATTACHMENTS = 6`), not from the source: DSH
 * puts no count limit on generic files.
 */
import * as React from "react";

import { api } from "@/lib/api";

/** Per-file upload lifecycle, mirroring the source's `DraftFileUpload` states (`contract/slots.ts:61-71`). */
export type DraftAttachmentStatus = "uploading" | "ready" | "error";

/** Draft kinds the rail renders differently: a file card or a 64px image tile. */
export type DraftAttachmentKind = "file" | "image";

/** One picked file and where its upload stands. */
export interface DraftAttachment {
  /** Runtime identity; a repeated pick gets a new id and stays a separate entry. */
  readonly id: string;
  readonly kind: DraftAttachmentKind;
  /** Browser file name (`FileCard.tsx:51-53`, image labels `ComposerAttachments.tsx:91`). */
  readonly name: string;
  /** Exact byte count, rendered through `fileSizeText` (`file-size.ts:8-16`). */
  readonly size: number;
  readonly status: DraftAttachmentStatus;
  /** Server path relative to the task workspace (`uploads/<name>`); present once ready. */
  readonly path?: string;
  /** Failure text retained for the chip's retry row. */
  readonly error?: string;
  /** Browser-local object URL for an image draft's thumbnail; revoked with the draft. */
  readonly previewUrl?: string;
}

/** Draft-attachment state and the mutations the composer owns. */
export interface ComposerAttachmentsState {
  /** Drafts in pick order. */
  readonly attachments: readonly DraftAttachment[];
  /** True while at least one picked file is still uploading. */
  readonly uploading: boolean;
  /** False while any draft is still uploading or failed; send waits for it (`InputBar.tsx:102-104`). */
  readonly ready: boolean;
  /**
   * Add picked files: every file appends a draft and starts its upload now.
   * @param files - picked, pasted, or dropped browser files in source order.
   */
  readonly addFiles: (files: readonly File[]) => void;
  /**
   * Drop one draft; a result that lands afterwards is discarded.
   * @param id - draft id to remove.
   */
  readonly removeAttachment: (id: string) => void;
  /**
   * Upload one failed draft again from its retained browser bytes.
   * @param id - failed draft id.
   */
  readonly retryAttachment: (id: string) => void;
  /** Drop every draft, as after a send was accepted. */
  readonly clear: () => void;
}

/** Product cap retained from the existing composer; DSH itself has none for files. */
const MAX_DRAFT_ATTACHMENTS = 6;

/**
 * Follow the composer's draft attachments and their per-file uploads.
 * @param taskId - selected task the uploads land under; null blocks intake.
 * @param onError - receives the readable upload failure, or null when one clears.
 * @returns the draft list, the send gate, and the add/remove/retry/clear actions.
 */
export function useComposerAttachments(
  taskId: string | null,
  onError: (message: string | null) => void,
): ComposerAttachmentsState {
  const [attachments, setAttachments] = React.useState<readonly DraftAttachment[]>([]);
  const seqRef = React.useRef(0);
  /** Browser bytes stay owned by the draft so a failed upload can retry (`service.ts:330-348`). */
  const filesRef = React.useRef(new Map<string, File>());
  /** Object URLs to revoke when their draft leaves the list. */
  const previewsRef = React.useRef(new Map<string, string>());
  /** Removed ids whose in-flight upload must not repopulate the list or the error row. */
  const removedRef = React.useRef(new Set<string>());

  const upload = React.useCallback(
    (id: string, task: string, file: File): void => {
      setAttachments((prev) => prev.map((item) => (item.id === id ? { ...item, status: "uploading" } : item)));
      void api
        .chatUpload("task", task, [file])
        .then((result) => {
          if (removedRef.current.has(id)) return;
          const uploaded = result.attachments[0];
          if (uploaded === undefined || uploaded.path === "") throw new Error("上传结果缺少文件路径");
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: "ready", path: uploaded.path, error: undefined } : item,
            ),
          );
        })
        .catch((reason: unknown) => {
          if (removedRef.current.has(id)) return;
          const message = reason instanceof Error ? reason.message : String(reason);
          setAttachments((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: "error", error: message } : item)),
          );
          onError(`附件上传失败：${message}`);
        });
    },
    [onError],
  );

  const addFiles = React.useCallback(
    (files: readonly File[]): void => {
      if (files.length === 0) return;
      if (taskId === null) {
        onError("先选择一个任务再上传附件");
        return;
      }
      const room = MAX_DRAFT_ATTACHMENTS - filesRef.current.size;
      if (room <= 0) {
        onError(`最多 ${MAX_DRAFT_ATTACHMENTS} 个附件`);
        return;
      }
      const accepted = files.slice(0, room);
      onError(
        accepted.length === files.length
          ? null
          : `最多 ${MAX_DRAFT_ATTACHMENTS} 个附件，已忽略 ${files.length - accepted.length} 个`,
      );
      const created: DraftAttachment[] = accepted.map((file) => {
        seqRef.current += 1;
        const id = `draft-${seqRef.current}`;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        filesRef.current.set(id, file);
        removedRef.current.delete(id);
        if (previewUrl !== undefined) previewsRef.current.set(id, previewUrl);
        return {
          id,
          kind: previewUrl === undefined ? "file" : "image",
          name: file.name === "" ? "文件" : file.name,
          size: file.size,
          status: "uploading",
          previewUrl,
        };
      });
      setAttachments((prev) => [...prev, ...created]);
      for (const [index, draft] of created.entries()) {
        const file = accepted[index];
        if (file !== undefined) upload(draft.id, taskId, file);
      }
    },
    [onError, taskId, upload],
  );

  const removeAttachment = React.useCallback((id: string): void => {
    removedRef.current.add(id);
    filesRef.current.delete(id);
    const previewUrl = previewsRef.current.get(id);
    if (previewUrl !== undefined) {
      URL.revokeObjectURL(previewUrl);
      previewsRef.current.delete(id);
    }
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const retryAttachment = React.useCallback(
    (id: string): void => {
      const file = filesRef.current.get(id);
      if (file === undefined || taskId === null) return;
      removedRef.current.delete(id);
      onError(null);
      upload(id, taskId, file);
    },
    [onError, taskId, upload],
  );

  const clear = React.useCallback((): void => {
    for (const id of filesRef.current.keys()) removedRef.current.add(id);
    filesRef.current.clear();
    for (const previewUrl of previewsRef.current.values()) URL.revokeObjectURL(previewUrl);
    previewsRef.current.clear();
    setAttachments([]);
    onError(null);
  }, [onError]);

  // A remount or task switch that drops the composer must not leak object URLs.
  React.useEffect(
    () => () => {
      for (const previewUrl of previewsRef.current.values()) URL.revokeObjectURL(previewUrl);
      previewsRef.current.clear();
    },
    [],
  );

  const uploading = attachments.some((item) => item.status === "uploading");
  const ready = attachments.every((item) => item.status === "ready");
  return { attachments, uploading, ready, addFiles, removeAttachment, retryAttachment, clear };
}
