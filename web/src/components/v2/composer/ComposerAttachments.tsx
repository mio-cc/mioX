"use client";

/**
 * Draft-attachment rail shown inside the composer card, above the draft row.
 *
 * Port of `ui-attachment/src/client/ComposerAttachments.tsx` and its
 * `AttachmentRail` / `FileCard` (`AttachmentRail.tsx`, `FileCard.tsx`): a
 * single-line rail of draft cards — 240×64 file cards with a 28px type glyph,
 * the CSS-ellipsized name, an extension+size meta line; 64×64 image tiles using
 * the browser-local object URL as their preview. Both carry the 18px remove
 * control that is transparent until hover or `:focus-visible` (so it stays
 * keyboard reachable). Upload state is the source's indeterminate one — a
 * spinner in the glyph seat, "上传中…" in the meta line, and a 2px track whose
 * 35%-wide bar sweeps horizontally (`FileCard.module.css:142-169`) — never a
 * fabricated percentage. A failed card turns its body into the retry control
 * and colors the meta line (`FileCard.tsx:33-62`). Names are ellipsized by CSS
 * only, exactly as the source does (`FileCard.module.css:61-69`), with the
 * full name in `title`.
 */
import * as React from "react";

import { FileTypeIcon, fileExtension } from "@/vendor/dsh/primitives/FileTypeIcon";
import { fileSizeText } from "@/vendor/dsh/primitives/file-size";
import { IconCloseFillRegular, IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./ComposerAttachments.module.css";
import type { DraftAttachment } from "@/v2/data/composer-attachments";

/** Source copy for the one pending status the rail renders (`locales.ts:63`). */
const UPLOADING = "上传中…";
/** Source copy for the retry line (`locales.ts:64`). */
const FAILED = "上传失败，点击重试";
/** Rail group name, from the source's `attachment.pending` (`locales.ts:34`). */
const GROUP_LABEL = "待发送附件";

/**
 * Meta line of a ready file card: upper-cased extension plus human-readable
 * size, joined only when both exist (`FileCard.tsx:33-38`).
 * @param item - ready draft attachment.
 * @returns e.g. `MD 2.5KB`, `312B`, or the extension alone.
 */
function readyMeta(item: DraftAttachment): string {
  const extension = fileExtension(item.name).toUpperCase().slice(0, 8);
  return [extension, fileSizeText(item.size)].filter((part) => part !== "").join(" ");
}

/** One image draft: local preview tile, its retry face, remove, and upload track. */
function ImageTile({
  item,
  onRemove,
  onRetry,
}: {
  readonly item: DraftAttachment;
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
}): React.ReactNode {
  const failed = item.status === "error";
  return (
    <div className={css.imageItem} title={item.path ?? item.name}>
      {failed ? (
        <button
          type="button"
          className={`${css.thumbnail} ${css.thumbnailFailed}`}
          aria-label={`重试上传 ${item.name}`}
          title={item.error ?? FAILED}
          onClick={() => onRetry(item.id)}
        >
          <img src={item.previewUrl} alt="" />
          <span className={css.failureGlyph} aria-hidden="true">
            <IconRefreshOutlineRegular size={16} />
          </span>
        </button>
      ) : (
        <span className={css.thumbnail}>
          <img src={item.previewUrl} alt={item.name} />
        </span>
      )}
      {item.status === "uploading" ? (
        <span className={css.imageTrack} aria-hidden="true">
          <span className={css.progressBar} />
        </span>
      ) : null}
      <button
        type="button"
        className={css.remove}
        aria-label={`移除图片 ${item.name}`}
        title={`移除图片 · ${item.name}`}
        onClick={() => onRemove(item.id)}
      >
        <IconCloseFillRegular size={12} />
      </button>
    </div>
  );
}

/** One file draft: type glyph / spinner, name, meta or retry row, remove, upload track. */
function FileCard({
  item,
  onRemove,
  onRetry,
}: {
  readonly item: DraftAttachment;
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
}): React.ReactNode {
  const failed = item.status === "error";
  return (
    <div
      className={`${css.card}${failed ? ` ${css.failed}` : ""}`}
      title={item.path ?? item.name}
      aria-busy={item.status === "uploading" ? true : undefined}
    >
      <span className={css.icon} aria-hidden="true">
        {item.status === "uploading" ? <span className={css.spinner} /> : <FileTypeIcon path={item.name} />}
      </span>
      {failed ? (
        <button
          type="button"
          className={`${css.body} ${css.retry}`}
          aria-label={`重试上传 ${item.name}`}
          title={item.error ?? FAILED}
          onClick={() => onRetry(item.id)}
        >
          <span className={css.name}>{item.name}</span>
          <span className={`${css.meta} ${css.metaFailed}`}>{FAILED}</span>
        </button>
      ) : (
        <span className={css.body} aria-label="待发送文件">
          <span className={css.name}>{item.name}</span>
          <span className={css.meta}>{item.status === "uploading" ? UPLOADING : readyMeta(item)}</span>
        </span>
      )}
      <button
        type="button"
        className={css.remove}
        aria-label={`移除文件 ${item.name}`}
        title={`移除文件 · ${item.name}`}
        onClick={() => onRemove(item.id)}
      >
        <IconCloseFillRegular size={12} />
      </button>
      {item.status === "uploading" ? (
        <span className={css.progressTrack} aria-hidden="true">
          <span className={css.progressBar} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Render the draft-attachment rail.
 * @param props.attachments - drafts in pick order; the rail is absent while empty.
 * @param props.onRemove - removes one draft from the owner state.
 * @param props.onRetry - re-uploads one failed draft.
 * @returns the rail, or null with no drafts.
 */
export function ComposerAttachments({
  attachments,
  onRemove,
  onRetry,
}: {
  readonly attachments: readonly DraftAttachment[];
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
}): React.ReactNode {
  if (attachments.length === 0) return null;
  return (
    <div className={css.rail} data-composer-attachments="">
      <div className={css.scroller} role="group" aria-label={GROUP_LABEL}>
        {attachments.map((item) =>
          item.kind === "image" ? (
            <ImageTile key={item.id} item={item} onRemove={onRemove} onRetry={onRetry} />
          ) : (
            <FileCard key={item.id} item={item} onRemove={onRemove} onRetry={onRetry} />
          ),
        )}
      </div>
    </div>
  );
}
