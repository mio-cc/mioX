"use client";

/**
 * 流量批量关联到漏洞（A13，对照表 P2:E11）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:607-609（选中流量后的「关联到漏洞」入口）、
 * ARTEX/web/src/components/link-traffic-dialog.tsx:78-162（搜索发现 + 分页 + 单选 + 确认关联）。
 * DSH 依据：波段「主区整页」内嵌弹窗，用 `Modal` + `Input` 原子（组件清单见总表 §6）。
 * 接口：搜索复用 `v2/data/findings-page.ts` 的 `useFindingsPage`（GET /exploration/findings），
 * 写入用 `v2/data/finding-traffic.ts` 的 `bindFindingTraffic`（POST /exploration/findings/{id}/traffic，api.ts:695）。
 * 与旧页的差异（已记 overlay）：role 固定 `proof`（旧页不带 role）；每页 20 条（旧 adapter 固定 25）。
 */

import { type ReactNode, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconSearchOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { Finding } from "@/lib/types";
import { bindFindingTraffic } from "@/v2/data/finding-traffic";
import { findingStatusLabel, findingTitle, severityLabel, useFindingsPage } from "@/v2/data/findings-page";

import css from "./traffic.module.css";

/** 本弹窗每页的发现条数（卡片要求 20）。 */
const LINK_PAGE_SIZE = 20;

export interface LinkToFindingDialogProps {
  /** 要绑定的流量 id；null 表示弹窗关闭。 */
  trafficIds: string[] | null;
  /** 关闭（不写入）。 */
  onCancel: () => void;
  /** 写入成功：外层清空勾选并刷新列表。 */
  onBound: () => void;
}

/**
 * 某条发现是否能作为绑定目标：旧页禁用「没有 finding_id」与「继承来的」行，
 * 因为这两类没有可写入的独立发现行。
 * @param finding - 列表里的一条发现。
 * @returns 可绑定时为 true。
 */
function selectable(finding: Finding): boolean {
  return (finding.finding_id ?? "") !== "" && finding.inherited !== true;
}

/**
 * 渲染「关联到漏洞」弹窗。
 * @param props.trafficIds - 要绑定的流量 id；null 时弹窗关闭。
 * @param props.onCancel - 取消。
 * @param props.onBound - 写入成功后回调。
 * @returns 弹窗。
 */
export function LinkToFindingDialog({ trafficIds, onCancel, onBound }: LinkToFindingDialogProps): ReactNode {
  const [rawQuery, setRawQuery] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Finding | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useDebouncedValue(rawQuery.trim(), 250);

  // 弹窗关闭时也要调用（Hook 不能条件调用）：传空搜索词不会因为打开状态变化而重复请求以外的事情。
  const state = useFindingsPage({ page, query, sort: "time" });
  const ids = trafficIds ?? [];
  const pageCount = useMemo(() => Math.max(1, Math.ceil(state.total / LINK_PAGE_SIZE)), [state.total]);

  const close = (): void => {
    if (busy) return;
    onCancel();
  };

  const patchQuery = (value: string): void => {
    setRawQuery(value);
    setPage(1);
    setPicked(null);
  };

  const confirm = (): void => {
    const findingId = picked?.finding_id ?? "";
    if (findingId === "" || ids.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    bindFindingTraffic(
      findingId,
      ids.map((trafficId) => ({ traffic_id: trafficId, role: "proof" as const })),
    )
      .then(() => {
        setBusy(false);
        toast(`已关联 ${ids.length} 条流量到漏洞 #${findingId}`);
        onBound();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <Modal
      open={trafficIds !== null}
      onClose={close}
      title="关联到漏洞"
      closeLabel="关闭"
      description={`将所选 ${ids.length} 条流量保存为已有漏洞的证据（用途：漏洞证明）。`}
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={close} data-traffic-link-cancel="">
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || picked === null}
            onClick={confirm}
            data-traffic-link-confirm=""
          >
            {busy ? "关联中…" : "确认关联"}
          </Button>
        </>
      }
    >
      <div className={css.linkWrap} data-traffic-link-traffic={ids.length}>
        <Input
          aria-label="查找漏洞"
          placeholder="名称 / 摘要 / 漏洞类别"
          value={rawQuery}
          onChange={(event) => patchQuery(event.currentTarget.value)}
          icon={<IconSearchOutlineRegular size={14} />}
          data-modal-autofocus
        />

        {error !== null ? (
          <div className={css.errorLine} role="alert">
            <span>关联失败：{error}</span>
          </div>
        ) : null}

        <div className={css.findingList} data-traffic-link-list="" aria-busy={state.phase === "loading"}>
          {state.phase === "loading" ? <div className={css.hintLine}>读取漏洞列表…</div> : null}
          {state.phase === "offline" ? (
            <div className={css.errorLine} role="alert">
              <span>漏洞列表读取失败：{state.error}</span>
              <Button variant="outline" size="sm" onClick={state.reload}>
                重试
              </Button>
            </div>
          ) : null}
          {state.phase === "ready" && state.items.length === 0 ? (
            <div className={css.hintLine}>
              {query === "" ? "还没有登记漏洞，请先在任务里登记漏洞。" : "没有匹配的漏洞。"}
            </div>
          ) : null}
          {state.items.map((finding) => {
            const key = finding.finding_id ?? finding.id;
            const usable = selectable(finding);
            const active = picked !== null && (picked.finding_id ?? picked.id) === key;
            return (
              <button
                key={key}
                type="button"
                className={active ? `${css.findingRow} ${css.findingRowActive}` : css.findingRow}
                aria-pressed={active}
                disabled={busy || !usable}
                title={usable ? undefined : "继承来的漏洞或被删除的漏洞不能绑定证据"}
                data-traffic-link-pick={key}
                onClick={() => setPicked(finding)}
              >
                <span className={css.findingHead}>
                  <span className={css.findingTitle} title={findingTitle(finding)}>
                    #{key} · {findingTitle(finding)}
                  </span>
                  <span className={css.findingTags}>
                    <Tag tone={finding.severity === "critical" || finding.severity === "high" ? "danger" : "neutral"}>
                      {severityLabel(finding.severity)}
                    </Tag>
                    <Tag tone="outline">{findingStatusLabel(finding.status)}</Tag>
                  </span>
                </span>
                <span className={css.findingSummary}>{finding.summary === "" ? finding.vulnclass : finding.summary}</span>
              </button>
            );
          })}
        </div>

        {state.phase === "ready" ? (
          <div className={css.pager}>
            <Button
              variant="outline"
              size="sm"
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              data-traffic-link-prev=""
              icon={<IconChevronLeftOutlineRegular size={13} />}
            />
            <span className={css.pageInfo} data-traffic-link-page-info="">
              第 {page} / {pageCount} 页 · 共 {state.total} 条
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label="下一页"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              data-traffic-link-next=""
              icon={<IconChevronRightOutlineRegular size={13} />}
            />
          </div>
        ) : null}

        <div className={css.hintLine} data-traffic-link-picked={picked?.finding_id ?? ""}>
          {picked === null
            ? "请选择一个漏洞"
            : `已选漏洞：#${picked.finding_id ?? picked.id} ${findingTitle(picked)}`}
        </div>
      </div>
    </Modal>
  );
}
