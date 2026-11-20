"use client";

/**
 * 右栏「证据」页签（单元 C23，对照表 P1:E8 的证据部分）。
 * 旧页面依据：ARTEX/web/src/components/layout/right-panel.tsx:23-31（右栏六个页签含「证据」）、
 * :344-386（`EvidenceTab`：没有打开任务的空态、加载态、段标题 + 条数、发现行 = 名称 + 严重级/状态、
 * 页脚说明「证据在主区发现页看」）。新口径按 100a-单元卡片 C23：列当前任务发现**已绑定的流量证据**，
 * 按用途分组，每行显示 method / status / url，点行跳到 `?page=findings&finding=<id>`。
 * DSH 依据：DSH 无流量证据视图，按「右栏 tab 扩展」实现（100-实施计划总表 §4）。
 * 数据：`v2/data/right-panel-evidence.ts` 的 `useRightPanelEvidence`（内部走 `api.findings` api.ts:636
 * 与 `api.findingTraffic` api.ts:691，都是只读）。
 */
import * as React from "react";

import type { Task, TrafficEvidenceRole } from "@/lib/types";
import { TRAFFIC_ROLE_LABEL } from "@/v2/data/finding-traffic";
import { EVIDENCE_FINDING_LIMIT, openFindingEvidence, useRightPanelEvidence } from "@/v2/data/right-panel-evidence";
import {
  IconLinkOutlineRegular,
  IconNewChatOutlineRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { TagTone } from "@/vendor/dsh/primitives/Tag";
import { Tag } from "@/vendor/dsh/primitives/Tag";

import { EmptyState, LoadingRows, PaneHeader, ToolButton } from "./pane-chrome";
import css from "./Panes.module.css";

/** 用途标签的色调：漏洞证明最重，正常对照最轻（沿用发现页「越重要越醒目」的口径）。 */
const ROLE_TONE: Record<TrafficEvidenceRole, TagTone> = {
  proof: "danger",
  verification: "info",
  baseline: "success",
  supporting: "outline",
};

export interface EvidencePaneProps {
  /** 当前选中任务；null/undefined 时显示「先选择一个任务」。 */
  readonly task?: Task | null;
}

/**
 * 右栏证据页签：当前任务发现已绑定的流量证据，按用途分组。
 * @param props.task - 当前选中的任务。
 * @returns the page.
 */
export function EvidencePane({ task = null }: EvidencePaneProps): React.ReactNode {
  const taskId = task === null || task === undefined ? null : String(task.id);
  const state = useRightPanelEvidence(taskId);

  return (
    <div className={css.page}>
      <PaneHeader
        actions={(
          <ToolButton label="刷新流量证据" onClick={state.reload}>
            <IconRefreshOutlineRegular size={15} />
          </ToolButton>
        )}
      >
        <span className={css.count}>
          {taskId === null
            ? "证据"
            : state.phase === "ready"
              ? (state.count === 0 ? "无流量证据" : `${state.count} 条流量证据`)
              : "证据"}
        </span>
      </PaneHeader>

      {taskId === null ? (
        <EmptyState
          icon={<IconNewChatOutlineRegular size={26} />}
          title="先选择一个任务"
          hint="在左侧会话列表选中任务后，这里列出它发现已绑定的流量证据"
        />
      ) : null}

      {taskId !== null && state.phase === "loading" ? <LoadingRows count={4} /> : null}

      {taskId !== null && state.phase === "offline" ? (
        <EmptyState
          icon={<IconWarningOutlineRegular size={26} />}
          title="未连接后端（流量证据不可用）"
          hint={
            state.error === null || state.error === ""
              ? "GET /exploration/findings 与 /traffic 读取失败，后端恢复后点刷新重试"
              : `读取失败：${state.error}`
          }
        />
      ) : null}

      {taskId !== null && state.phase === "ready" && state.count === 0 ? (
        <EmptyState
          icon={<IconShieldOutlineRegular size={26} />}
          title="暂无已绑定的流量证据"
          hint={`当前任务的发现都还没有绑定流量请求；在发现详情里绑定后会出现在这里。本页最多展开 ${EVIDENCE_FINDING_LIMIT} 条发现`}
        />
      ) : null}

      {taskId !== null && state.phase === "ready" && state.count > 0 ? (
        <>
          {state.error === null ? null : <p className={css.notice}>{state.error}</p>}
          {state.skippedFindings === 0 ? null : (
            <p className={css.notice}>
              另有 {state.skippedFindings} 条发现未展开（本页最多展开 {EVIDENCE_FINDING_LIMIT} 条发现）
            </p>
          )}
          <div className={css.scroll}>
            <div className={css.list}>
              {state.groups.map((group) => (
                <section key={group.role} className={css.evidenceSection} data-rp-evidence-role={group.role}>
                  <div className={css.evidenceCaption}>
                    <Tag tone={ROLE_TONE[group.role]}>{TRAFFIC_ROLE_LABEL[group.role]}</Tag>
                    <span className={css.evidenceCaptionCount}>{group.rows.length} 条</span>
                  </div>
                  <ul className={css.fileList}>
                    {group.rows.map((row) => (
                      <li key={row.bindingId} className={css.listItem}>
                        <button
                          type="button"
                          className={css.row}
                          data-rp-evidence={row.bindingId}
                          title={`在发现页查看 ${row.findingTitle}`}
                          onClick={() => {
                            openFindingEvidence(row.findingId);
                          }}
                        >
                          <span className={css.rowTop}>
                            <span className={css.evidenceLine}>
                              <span className={css.evidenceMethod}>{row.method === "" ? "—" : row.method}</span>
                              <span className={css.evidenceStatus}>{row.status === 0 ? "—" : row.status}</span>
                              <span className={css.rowTitle}>{row.url === "" ? "（无地址）" : row.url}</span>
                            </span>
                          </span>
                          <span className={css.rowMeta}>
                            <span className={css.detailClass}>
                              <span aria-hidden="true"><IconLinkOutlineRegular size={11} /></span>
                              {" "}
                              {row.findingTitle}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
