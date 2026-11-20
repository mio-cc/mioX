"use client";

/**
 * Delete confirmation of the asset page (D11: 多选 + 删除已选，确认时提示删除条数).
 *
 * Wording is the old page's alert dialog (`app/(main)/function/assets/page.tsx:739-762`):
 * title 「确认删除」, body 「将永久删除 N 条资产记录，此操作不可撤销。」 and the
 * 取消 / 确认删除 footer. The dialog uses the vendored DSH `Modal` (same atom as
 * the finding delete confirmation, `components/v2/findings/FindingWriteControls.tsx:284-325`).
 *
 * Only the confirmation is exercised by the audit: it opens the dialog and
 * cancels, so `deleteAssetsByIds` is never called there.
 */
import { type ReactNode, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { deleteAssetsByIds } from "@/v2/data/assets-page";

import { assetTypeCaption } from "./AssetTable";
import css from "./AssetDeleteDialog.module.css";

/** One row the confirmation is about: its id and the label shown to the user. */
export interface AssetDeleteTarget {
  id: number;
  label: string;
}

export interface AssetDeleteDialogProps {
  /** Rows the request is about, or null while the dialog is closed. */
  targets: AssetDeleteTarget[] | null;
  /** Active asset class, only used for the body wording. */
  type: string | null;
  /** Close without deleting. */
  onCancel: () => void;
  /** Called with the deleted row count after a successful request. */
  onDeleted: (deleted: number) => void;
}

/**
 * Render the delete confirmation.
 * @param props - target rows and the two outcomes.
 * @returns the dialog, or null while closed.
 */
export function AssetDeleteDialog({ targets, type, onCancel, onDeleted }: AssetDeleteDialogProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = targets?.length ?? 0;
  const preview = (targets ?? [])
    .slice(0, 3)
    .map((target) => target.label)
    .join("、");

  const confirm = (): void => {
    if (targets === null || busy) return;
    setBusy(true);
    setError(null);
    deleteAssetsByIds(targets.map((target) => target.id))
      .then((deleted) => {
        setBusy(false);
        onDeleted(deleted);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <Modal
      open={targets !== null}
      onClose={onCancel}
      title="确认删除"
      closeLabel="关闭"
      tone="warning"
      description={`将永久删除 ${count} 条资产记录，此操作不可撤销。`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy} data-asset-delete-cancel="">
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={confirm} disabled={busy} data-asset-delete-confirm="">
            {busy ? "删除中…" : "确认删除"}
          </Button>
        </>
      }
    >
      <div data-asset-delete-count={count} className={css.body}>
        <p className={css.note}>
          当前查看：{assetTypeCaption(type)}。{count > 1 ? "这些资产" : "该资产"}：{preview}
          {count > 3 ? ` 等 ${count} 条` : ""}
        </p>
        {error !== null ? <p className={css.error}>删除失败：{error}</p> : null}
      </div>
    </Modal>
  );
}
