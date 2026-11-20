"use client";

/**
 * 流量详情抽屉（A10，对照表 P2:E12）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:729-773（请求/响应两个页签）。
 * 数据：`GET /traffic/exchange?id=`（api.ts:909），完整请求/响应原文。
 * W-3：每个方向的原件下载走 `GET /api/traffic/blob?hash=`（server.go:837，attachment
 * 无损原件，与 `/traffic/exchange` 的拼装文本互补）；hash 为空的方向不画链接。
 */
import { type ReactNode, useEffect, useState } from "react";

import type { TrafficExchange } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { trafficBlobUrl, trafficExchange } from "@/v2/data/traffic";

import css from "./traffic.module.css";

/** 侧页签。 */
type Side = "req" | "resp";

/**
 * 超阈值正文里 `@blob sha256:<hash>` 指针（后端 `getTrafficBlob` 的注释：
 * 大到不内联的正文以 preview + 指针返回，按 sha256 从 blob 取完整原件）。
 * @param body - 当前方向的拼装正文。
 * @returns 指针里的 sha256；没有指针时返回 null（原文即全部，无原件可下）。
 */
function parseBlobPointer(body: string): string | null {
  const match = /@blob sha256:([0-9a-f]{16,128})/.exec(body);
  return match === null ? null : match[1];
}

/**
 * 渲染一条流量的详情。
 * @param props.row - 要查看的流量行；null 表示关闭。
 * @param props.onClose - 关闭。
 * @returns 详情弹窗。
 */
export function TrafficDetail({ row, onClose }: { row: TrafficExchange | null; onClose: () => void }): ReactNode {
  const [side, setSide] = useState<Side>("req");
  const [detail, setDetail] = useState<{ req: string; resp: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (row === null) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    trafficExchange(row.id)
      .then((value) => {
        if (!alive) return;
        setDetail(value);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [row, tick]);

  const body = side === "req" ? (detail?.req ?? "") : (detail?.resp ?? "");
  // W-3：只有正文里带 `@blob` 指针的方向才有原件可下（超阈值才落 blob）。
  const blobUrl = loading || error !== null ? null : trafficBlobUrl(parseBlobPointer(body));

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={row === null ? "流量详情" : `${row.method} ${row.url}`}
      closeLabel="关闭"
      description={row === null ? undefined : `${row.host} · ${row.content_type === "" ? "无 Content-Type" : row.content_type}`}
      footer={
        <>
          <a
            className={css.blobBtn}
            href={blobUrl ?? undefined}
            download
            aria-disabled={blobUrl === null}
            title={blobUrl === null ? "这个方向的正文没有超大原件（超出内联阈值才会落 blob）" : "下载这个方向的完整原件（正文超过内联阈值的部分在 blob 里）"}
            data-traffic-blob={side}
            onClick={(event) => {
              if (blobUrl === null) event.preventDefault();
            }}
          >
            下载完整原件
          </a>
          <Button variant="outline" size="sm" disabled={loading} onClick={onClose}>
            关闭
          </Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => setTick((n) => n + 1)}>
            重新读取
          </Button>
        </>
      }
    >
      <div className={css.detailWrap} data-traffic-detail={row?.id ?? ""}>
        <SegmentedControl
          id="traffic-detail-side"
          label="请求或响应"
          value={side}
          options={[
            { value: "req", label: "请求" },
            { value: "resp", label: "响应" },
          ]}
          onChange={(next) => setSide(next as Side)}
        />
        {loading ? <div className={css.hintLine}>读取报文…</div> : null}
        {error !== null ? (
          <div className={css.errorLine} role="alert">
            <span>读取失败：{error}</span>
            <Button variant="outline" size="sm" onClick={() => setTick((n) => n + 1)}>
              重试
            </Button>
          </div>
        ) : null}
        {!loading && error === null && body === "" ? (
          <div className={css.hintLine}>这条流量没有记录该方向的原文。</div>
        ) : null}
        {body === "" ? null : <pre className={css.rawBox} data-traffic-raw={side}>{body}</pre>}
      </div>
    </Modal>
  );
}
