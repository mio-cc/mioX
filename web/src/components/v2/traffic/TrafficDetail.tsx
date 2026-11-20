"use client";

/**
 * 流量详情抽屉（A10，对照表 P2:E12）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:729-773（请求/响应两个页签）。
 * 数据：`GET /traffic/exchange?id=`（api.ts:909），完整请求/响应原文。
 */
import { type ReactNode, useEffect, useState } from "react";

import type { TrafficExchange } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { trafficExchange } from "@/v2/data/traffic";

import css from "./traffic.module.css";

/** 侧页签。 */
type Side = "req" | "resp";

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

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={row === null ? "流量详情" : `${row.method} ${row.url}`}
      closeLabel="关闭"
      description={row === null ? undefined : `${row.host} · ${row.content_type === "" ? "无 Content-Type" : row.content_type}`}
      footer={
        <>
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
