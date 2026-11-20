"use client";

/**
 * 按目标管理流量（A09，对照表 P2:E2、P2:E3、P2:E4）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:367-481（目标列表 + 按目标删除 + 清空全部）、
 * :785-793（清空确认文案，含 reclaimed 压实提示）。
 * 接口：api.ts:910 trafficHosts、:911 trafficDeleteHost、:912 trafficDeleteHosts、:915 trafficDeleteAll。
 */
import { type ReactNode, useMemo, useState } from "react";

import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  deleteAllTraffic,
  deleteTrafficHost,
  deleteTrafficHosts,
  useTrafficHosts,
} from "@/v2/data/traffic";

import css from "./traffic.module.css";

/**
 * 渲染「按目标管理」与「清空全部」两个入口及其确认弹窗。
 * @param props.onChanged - 删除成功后通知外层刷新列表。
 * @returns 两个按钮与两个确认弹窗。
 */
export function TrafficHostsDialog({ onChanged }: { onChanged: () => void }): ReactNode {
  const hosts = useTrafficHosts();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);

  const sorted = useMemo(() => [...hosts.hosts].sort((a, b) => b.count - a.count), [hosts.hosts]);

  const toggle = (host: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  };

  const removeSelected = (): void => {
    const list = [...selected];
    if (list.length === 0 || busy) return;
    setBusy(true);
    deleteTrafficHosts(list)
      .then((result) => {
        setBusy(false);
        setSelected(new Set());
        toast(`已删除 ${result.deleted} 条流量`);
        hosts.reload();
        onChanged();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        toast(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const clearAll = (): void => {
    if (busy) return;
    setBusy(true);
    deleteAllTraffic()
      .then((result) => {
        setBusy(false);
        setClearing(false);
        const mb = (result.reclaimed / 1024 / 1024).toFixed(1);
        toast(`已清空 ${result.deleted} 条流量，回收索引 ${mb} MB`);
        hosts.reload();
        onChanged();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        toast(`清空失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  return (
    <div className={css.hostActions} data-traffic-hosts="">
      <Button variant="outline" size="sm" data-traffic-hosts-open="" onClick={() => setOpen(true)}>
        按目标管理
      </Button>
      <Button variant="outline" size="sm" data-traffic-clear-all="" onClick={() => setClearing(true)}>
        清空全部
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="按目标管理流量"
        closeLabel="关闭"
        description="按目标（host）查看包数并批量删除；删除只影响流量记录，已绑定到漏洞的证据会保留。"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || selected.size === 0}
              data-traffic-hosts-delete=""
              onClick={removeSelected}
            >
              {busy ? "删除中…" : `删除选中（${selected.size}）`}
            </Button>
          </>
        }
      >
        <div className={css.hostList} data-traffic-hosts-count={sorted.length}>
          {hosts.phase === "loading" ? <div className={css.hintLine}>读取目标列表…</div> : null}
          {hosts.phase === "offline" ? (
            <div className={css.errorLine} role="alert">
              <span>目标列表读取失败：{hosts.error}</span>
              <Button variant="outline" size="sm" onClick={hosts.reload}>
                重试
              </Button>
            </div>
          ) : null}
          {hosts.phase === "ready" && sorted.length === 0 ? (
            <div className={css.hintLine}>还没有记录到任何目标。</div>
          ) : null}
          {sorted.map((item) => (
            <label key={item.host} className={css.hostRow}>
              <input
                type="checkbox"
                checked={selected.has(item.host)}
                data-traffic-host-item={item.host}
                onChange={() => toggle(item.host)}
              />
              <span className={css.hostName} title={item.host}>
                {item.host === "" ? "（无 Host）" : item.host}
              </span>
              <Tag tone="neutral">{item.count} 包</Tag>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || item.host === ""}
                data-traffic-host-delete={item.host}
                onClick={() => {
                  setBusy(true);
                  deleteTrafficHost(item.host)
                    .then((result) => {
                      setBusy(false);
                      toast(`已删除 ${result.deleted} 条流量`);
                      hosts.reload();
                      onChanged();
                    })
                    .catch((reason: unknown) => {
                      setBusy(false);
                      toast(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
                    });
                }}
              >
                删除该目标
              </Button>
            </label>
          ))}
        </div>
      </Modal>

      <Modal
        open={clearing}
        onClose={() => {
          if (!busy) setClearing(false);
        }}
        title="确认清空全部流量"
        closeLabel="关闭"
        tone="warning"
        description="将删除全部流量记录并压实索引，此操作不可撤销；已绑定到漏洞的证据会保留。"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setClearing(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={busy} data-traffic-clear-confirm="" onClick={clearAll}>
              {busy ? "清空中…" : "确认清空"}
            </Button>
          </>
        }
      />
    </div>
  );
}
