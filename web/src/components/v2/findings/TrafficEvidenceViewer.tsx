"use client";

/**
 * 流量证据查看器：弹窗内看一条已绑定流量的请求 / 响应正文，可按 offset 分页加载、可下载完整正文。
 * 旧页面依据：ARTEX/web/src/components/traffic-evidence-viewer.tsx:16-124。
 * DSH 依据：DSH 无报文查看页；按「发现详情里的页内弹窗」扩展（100-实施计划总表 §4 决策表最后一列）。
 * 对照表行：P2:K2
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";

import type { EvidenceBodyPreview, FindingTrafficBinding } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import {
  downloadFindingTrafficBody,
  findingTrafficDetail,
  findingTrafficBody,
  type TrafficBodySide,
} from "@/v2/data/finding-traffic";

import css from "./TrafficEvidenceViewer.module.css";

/** 两个页签的固定顺序。 */
const SIDE_OPTIONS: readonly { value: TrafficBodySide; label: string }[] = [
  { value: "request", label: "请求" },
  { value: "response", label: "响应" },
];

/** 两侧正文的本地累积状态；null 表示该侧还没读到第一页。 */
type SideBodies = Record<TrafficBodySide, EvidenceBodyPreview | null>;

/** 空累积。 */
const EMPTY_BODIES: SideBodies = { request: null, response: null };

/**
 * 渲染流量证据查看弹窗。
 * @param props.open - 是否显示。
 * @param props.findingId - 发现 id。
 * @param props.bindingId - 要查看的绑定 id；null 时不请求。
 * @param props.contextTask - 可选的上下文任务 id。
 * @param props.onClose - 关闭动作。
 * @returns 弹窗；未打开时返回 null。
 */
export function TrafficEvidenceViewer({
  open,
  findingId,
  bindingId,
  contextTask,
  onClose,
}: {
  open: boolean;
  findingId: string;
  bindingId: string | null;
  contextTask?: string;
  onClose: () => void;
}): ReactNode {
  const [side, setSide] = useState<TrafficBodySide>("request");
  const [phase, setPhase] = useState<"loading" | "ready" | "offline">("loading");
  const [binding, setBinding] = useState<FindingTrafficBinding | null>(null);
  const [bodies, setBodies] = useState<SideBodies>(EMPTY_BODIES);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 打开或换绑定时，重新读绑定信息与两侧正文首页。
  useEffect(() => {
    if (!open || bindingId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    setBinding(null);
    setBodies(EMPTY_BODIES);
    setSide("request");
    findingTrafficDetail(findingId, bindingId, contextTask)
      .then((value) => {
        if (!alive) return;
        setBinding(value.binding);
        setBodies({ request: value.request, response: value.response });
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [open, findingId, bindingId, contextTask]);

  /** 读取当前页签的下一页正文并拼到已加载内容后面。 */
  const loadMore = useCallback((): void => {
    if (bindingId === null) return;
    const current = bodies[side];
    if (current === null || busy) return;
    setBusy(true);
    findingTrafficBody(findingId, bindingId, side, current.next_offset, contextTask)
      .then((next) => {
        setBusy(false);
        setBodies((prev) => {
          const base = prev[side];
          if (base === null) return prev;
          return { ...prev, [side]: { ...next, content: base.content + next.content } };
        });
      })
      .catch((reason: unknown) => {
        setBusy(false);
        toast(`加载正文失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [bindingId, bodies, side, busy, findingId, contextTask]);

  /** 下载当前页签的完整正文。 */
  const download = useCallback((): void => {
    if (bindingId === null || downloading) return;
    setDownloading(true);
    downloadFindingTrafficBody(findingId, bindingId, side, contextTask)
      .then(() => setDownloading(false))
      .catch((reason: unknown) => {
        setDownloading(false);
        toast(`下载失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [bindingId, downloading, findingId, side, contextTask]);

  if (!open) return null;

  const current = bodies[side];
  const head = side === "request" ? binding?.snapshot.req_head : binding?.snapshot.resp_head;
  const raw = current === null ? "" : `${(head ?? "").trimEnd()}\n\n${current.content}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="流量证据正文"
      closeLabel="关闭"
      description={binding === null ? "显示绑定时保存的请求与响应正文。" : binding.snapshot.url}
      contentClassName={css.modalContent}
      footer={
        <>
          <Button variant="outline" size="sm" disabled={downloading || binding === null} onClick={download}>
            {downloading ? "下载中…" : `下载完整${side === "request" ? "请求" : "响应"}正文`}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      <div className={css.wrap} data-traffic-evidence={bindingId ?? ""}>
        <SegmentedControl
          id="traffic-evidence-side"
          label="报文方向"
          value={side}
          options={SIDE_OPTIONS}
          onChange={(next) => setSide(next)}
          disabled={busy}
        />

        {phase === "loading" ? <div className={css.state}>加载正文…</div> : null}

        {phase === "offline" ? (
          <div className={css.stateError} role="alert">
            <span>正文读取失败：{error}</span>
          </div>
        ) : null}

        {phase === "ready" && current === null ? <div className={css.empty}>该侧没有正文字节。</div> : null}

        {phase === "ready" && current !== null ? (
          <>
            <div className={css.metaRow}>
              <span className={css.meta}>
                正文 {current.total.toLocaleString("zh-CN")} 字节 · 已载 {(current.offset + current.content.length).toLocaleString("zh-CN")}
                {current.truncated ? " · 尚有未载内容" : " · 已全部载入"}
                {current.binary ? " · 二进制内容" : ""}
              </span>
            </div>
            <pre className={css.body} data-traffic-evidence-body="" aria-label="正文">
              {raw}
            </pre>
            {current.truncated ? (
              <div className={css.metaRow}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  data-traffic-evidence-more=""
                  onClick={loadMore}
                >
                  {busy ? "加载中…" : "加载更多"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
