"use client";

/**
 * 发现页的勾选工具条（对照表 P2:B13：批量勾选 / 已选计数 / 本页全选）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/findings/page.tsx:251-277（`selectedIds` 用
 * `finding_id` 记录、跨页保留的 `toggleSelected` / `toggleSelectedPage`）、
 * :954-961（「已选 N 条」+ 导出按钮）、`_components/findings-table.tsx:152-189`（行内勾选框）。
 * DSH 依据：DSH 无表格批量条，按「主区整页」内的页内工具条扩展（总表 §6 组件集）；
 * 确认弹窗照 `components/v2/data-pages/AssetDeleteDialog.tsx:68-97` 与总表 §5.5。
 * 对照表行：P2:B13 P2:B14
 *
 * 批量改状态：后端**没有**批量改状态接口（`api.ts` 里 grep `batch` 只有任务分类 /
 * 任务控制 / 归档 / 会话删除；`ARTEX/server/server.go` 也没有 findings 的批量路由），
 * 所以这里按条逐一对 `api.setFindingStatus`（api.ts:760）发一个 PATCH，经适配器
 * `v2/data/findings-page.ts` 的 `setFindingStatus` 转发。不做乐观更新：先二次确认，
 * 改完再 toast + 刷新，失败条数如实报出。
 *
 * 导出走 `api.exportFindings`（api.ts:654-686），范围 / 格式与旧页 :1206-1260 一致
 * （当前筛选 / 全部 / 勾选 × md-single / md-zip / csv / json）；后端按筛选条件导出
 * **全部命中行**（server.go:2228-2260 不分页），不是当前页。
 */
import { type ReactNode, useCallback, useState } from "react";

import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import type { Finding, FindingStatus } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { FilterBar } from "@/components/v2/design/Kit";
import { IconDownloadOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import {
  STATUS_FILTER_ORDER,
  exportFindings,
  findingStatusLabel,
  setFindingStatus,
  type FindingsExportFormat,
  type FindingsQuery,
  type FindingsExportScope,
} from "@/v2/data/findings-page";

import wcss from "./FindingWrite.module.css";

/** 导出格式选项：文案逐条照旧页 :1237-1248。 */
const EXPORT_FORMAT_OPTIONS: ReadonlyArray<{ value: FindingsExportFormat; label: string }> = [
  { value: "md-single", label: "Markdown 汇总（单个 .md）" },
  { value: "md-zip", label: "Markdown 分文件（.zip）" },
  { value: "csv", label: "CSV 表格（.csv）" },
  { value: "json", label: "JSON（.json）" },
];

/**
 * 一行明细的 id：优先 `finding_id`（独立 findings 表的行 id，后端写状态/导出用它），
 * 取不到时退回 `id`（旧页面同一口径，`findings/page.tsx:251` 的注释）。
 * @param finding - 后端返回的发现行。
 * @returns 稳定的行 id 字符串。
 */
export function findingRowId(finding: Finding): string {
  return String(finding.finding_id ?? finding.id);
}

/**
 * 批量改状态的二次确认弹窗（总表 §5.5：Modal + tone="warning" + 写清影响条数）。
 * @param props.count - 将受影响的行数（= 勾选数）。
 * @param props.status - 目标状态。
 * @param props.busy - 请求进行中，两个按钮都禁用。
 * @param props.failure - 失败原因，留在弹窗里。
 * @param props.onCancel - 取消。
 * @param props.onConfirm - 确认。
 * @returns 弹窗。
 */
export function FindingBulkStatusDialog({
  count,
  status,
  busy,
  failure,
  onCancel,
  onConfirm,
}: {
  count: number;
  status: FindingStatus;
  busy: boolean;
  failure: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  return (
    <Modal
      open
      onClose={onCancel}
      title="确认批量修改处理状态"
      closeLabel="关闭批量状态确认"
      tone="warning"
      description={`将把已选的 ${count} 条发现改为「${findingStatusLabel(status)}」。`}
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel} data-findings-bulk-cancel="status">
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
            data-findings-bulk-submit="status"
          >
            {busy ? "修改中…" : "确认修改"}
          </Button>
        </>
      }
    >
      <div className={wcss.dialogBody} data-findings-bulk-dialog="status">
        <p className={wcss.warnText}>
          这 {count} 条发现的处置状态会被逐条写入后端（后端没有批量接口，按条调用同一状态更新）。
          修改会立即生效，可在每行的状态列看到新值。
        </p>
        {failure === null ? null : (
          <p className={wcss.errorLine} data-findings-bulk-dialog-error="status">
            修改失败：{failure}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * 导出弹窗（旧页 :1206-1260）：范围 × 格式，确认后调后端导出并下载。
 * 当前筛选的范围写明「全部筛选结果，不是当前页」。
 * @param props.selectedCount - 已勾选条数（为 0 时「勾选」不可选）。
 * @param props.filteredTotal - 当前筛选命中总条数（来自列表适配器的 `total`）。
 * @param props.filters - 当前筛选条件，`scope=filtered` 时交给后端。
 * @param props.selectedIds - 已勾选行的 id。
 * @param props.onClose - 关闭。
 * @returns 弹窗。
 */
export function FindingsExportDialog({
  selectedCount,
  filteredTotal,
  filters,
  selectedIds,
  onClose,
}: {
  selectedCount: number;
  filteredTotal: number;
  filters: Omit<FindingsQuery, "page">;
  selectedIds: readonly string[];
  onClose: () => void;
}): ReactNode {
  const [scope, setScope] = useState<FindingsExportScope>(selectedCount > 0 ? "selected" : "filtered");
  const [format, setFormat] = useState<FindingsExportFormat>("md-single");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = useCallback((): void => {
    if (busy) return;
    if (scope === "selected" && selectedIds.length === 0) return;
    setBusy(true);
    setFailure(null);
    exportFindings(
      scope === "selected"
        ? { format, scope, ids: [...selectedIds] }
        : scope === "all"
          ? { format, scope }
          : { format, scope, filters },
    )
      .then(() => {
        setBusy(false);
        onClose();
        toast("已开始下载导出文件");
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setFailure(reason instanceof Error ? reason.message : String(reason));
      });
  }, [busy, filters, format, onClose, scope, selectedIds]);

  return (
    <Modal
      open
      onClose={onClose}
      title="导出发现"
      closeLabel="关闭导出"
      description="选择导出范围与格式，生成后浏览器会自动下载。"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose} data-findings-export-cancel="">
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || (scope === "selected" && selectedCount === 0)}
            onClick={run}
            data-findings-export-submit=""
          >
            <IconDownloadOutlineRegular size={13} />
          {busy ? "导出中…" : "导出"}
          </Button>
        </>
      }
    >
      <div className={wcss.dialogBody} data-findings-export-dialog="">
        <span className={wcss.fieldLabel}>导出范围</span>
        <FilterBar
          id="findings-export-scope"
          label="导出范围"
          value={scope}
          options={[
            { value: "filtered", label: `当前筛选（${filteredTotal}）` },
            { value: "all", label: "全部" },
            {
              value: "selected",
              label: `勾选（${selectedCount}）`,
              disabled: selectedCount === 0,
              title: selectedCount === 0 ? "先在列表里勾选至少一条" : undefined,
            },
          ]}
          onChange={(next) => setScope(next)}
        />
        <p className={wcss.fieldHint} data-findings-export-scope-hint={scope}>
          {scope === "filtered"
            ? `按当前筛选条件导出全部 ${filteredTotal} 条命中结果（后端导出全部命中行，不只当前页）。`
            : scope === "all"
              ? "忽略所有筛选，导出后端全部发现。"
              : `只导出勾选的 ${selectedCount} 条。`}
        </p>

        <span className={wcss.fieldLabel}>导出格式</span>
        <FilterBar
          id="findings-export-format"
          label="导出格式"
          value={format}
          options={EXPORT_FORMAT_OPTIONS}
          onChange={(next) => setFormat(next)}
        />

        {failure === null ? null : (
          <p className={wcss.errorLine} data-findings-export-error="">
            导出失败：{failure}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * 勾选工具条：已选计数、批量改状态、导出、本页全选 / 清空。
 * 勾选本身由列表持有（`FindingsDataPage` 的 `selectedIds`），这里只发指令。
 * @param props.selectedCount - 已选条数。
 * @param props.pageCount - 当前页行数。
 * @param props.pageAllSelected - 当前页是否已全选。
 * @param props.busy - 批量写进行中（全部按钮禁用）。
 * @param props.failure - 批量写失败原因（留在页面上，独立路由没有 toast）。
 * @param props.onSelectPage - 本页全选。
 * @param props.onClear - 清空勾选。
 * @param props.onBulkStatus - 选好目标状态后的确认回调。
 * @param props.onExport - 打开导出弹窗。
 * @returns 工具条。
 */
export function FindingsBulkBar({
  selectedCount,
  pageCount,
  pageAllSelected,
  busy,
  failure,
  onSelectPage,
  onClear,
  onBulkStatus,
  onExport,
}: {
  selectedCount: number;
  pageCount: number;
  pageAllSelected: boolean;
  busy: boolean;
  failure: string | null;
  onSelectPage: () => void;
  onClear: () => void;
  onBulkStatus: (status: FindingStatus) => void;
  onExport: () => void;
}): ReactNode {
  const [status, setStatus] = useState<FindingStatus>("resolved");

  return (
    <div className={wcss.panel} data-findings-bulk-bar="" data-findings-bulk-selected={selectedCount}>
      <div className={wcss.panelHead}>
        <span className={wcss.panelTitle}>批量操作</span>
        <span className={wcss.meta} data-findings-bulk-count="">
          已选 {selectedCount} 条
        </span>
        <div className={wcss.actions}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pageCount === 0 || pageAllSelected}
            onClick={onSelectPage}
            data-findings-bulk-action="select-page"
          >
            本页全选
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || selectedCount === 0}
            onClick={onClear}
            data-findings-bulk-action="clear"
          >
            清空
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onExport}
            data-findings-bulk-action="export"
          >
            <IconDownloadOutlineRegular size={13} />
            导出
          </Button>
        </div>
      </div>
      <div className={wcss.panelBody}>
        <div className={wcss.retestHead}>
          <label className={wcss.fieldLabel} htmlFor="findings-bulk-status">
            批量改处理状态
          </label>
          <SelectMenu
            id="findings-bulk-status"
            value={status}
            ariaLabel="批量改处理状态的目标状态"
            options={STATUS_FILTER_ORDER.map((value) => ({ value, label: findingStatusLabel(value) }))}
            disabled={busy || selectedCount === 0}
            onChange={(next) => setStatus(next as FindingStatus)}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={busy || selectedCount === 0}
            onClick={() => onBulkStatus(status)}
            data-findings-bulk-action="status"
          >
            {busy ? "修改中…" : "修改状态"}
          </Button>
        </div>
        <p className={wcss.muted}>
          勾选跨页保留。后端没有批量改状态接口，确认后按条调用同一条状态更新接口，
          结果如实提示成功 / 失败条数。
        </p>
        {failure === null ? null : (
          <p className={wcss.errorLine} data-findings-bulk-error="">
            批量修改失败：{failure}
          </p>
        )}
      </div>
    </div>
  );
}
