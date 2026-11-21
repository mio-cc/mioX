"use client";

/**
 * 发现详情的「关联流量」面板（对照表 P2:C8、P2:K4）。
 * 旧页面依据：ARTEX/web/src/components/finding-traffic-panel.tsx:90-285
 *   （P2:C8 逐行「查看报文」= 旧页 :146-152 的 URL 链接 + :159-161 的「查看报文」按钮，
 *    再看 :225-230 挂载的 TrafficEvidenceViewer；只读时按钮同样保留，旧页 :162 也只挡写操作）。
 * DSH 依据：DSH 无关联流量页；面板挂在发现详情的概览里（100-实施计划总表 §4 的页内区块）。
 *
 * 只读写真实接口：列表 GET …/{id}/traffic，排序 / 编辑说明 / 解除绑定分别走对应写接口，
 * 每次写都用读取时的 `version`，成功后用返回的新快照替换本地数据。
 */
import { type ReactNode, useMemo, useState } from "react";

import { TrafficEvidenceViewer } from "./TrafficEvidenceViewer";

import { TrafficPickerDialog, type TrafficPickerFilter } from "../traffic/TrafficPickerDialog";

import type { FindingTrafficBinding, TrafficEvidenceRole } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { FilterBar } from "@/components/v2/design/Kit";
import {
  boundTrafficIds,
  editFindingTraffic,
  orderFindingTraffic,
  removeFindingTraffic,
  TRAFFIC_ROLE_LABEL,
  TRAFFIC_ROLE_ORDER,
  useFindingTraffic,
} from "@/v2/data/finding-traffic";

import css from "./FindingTrafficPanel.module.css";

/** 编辑弹窗状态。 */
interface EditTarget {
  binding: FindingTrafficBinding;
  role: TrafficEvidenceRole;
  note: string;
}

/** 选择器初始筛选与分页（每页 50，卡片要求可切换）。 */
const PICKER_FILTER_INIT: TrafficPickerFilter = { page: 1, size: 50, host: "", method: "all", q: "" };

/**
 * 渲染关联流量面板。
 * @param props.findingId - 发现 id。
 * @param props.readOnly - 继承的发现只读，不渲染写操作。
 * @param props.contextTask - 可选的上下文任务 id。
 * @returns 面板。
 */
export function FindingTrafficPanel({
  findingId,
  readOnly = false,
  contextTask,
}: {
  findingId: string;
  readOnly?: boolean;
  contextTask?: string;
}): ReactNode {
  const traffic = useFindingTraffic(findingId, contextTask);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [removing, setRemoving] = useState<FindingTrafficBinding | null>(null);
  /** 正在查看报文的绑定 id；null 表示查看器关闭（A11）。 */
  const [viewing, setViewing] = useState<string | null>(null);
  /** 选择器是否打开（A12）。 */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 选择器里已选的源流量 id：存在父组件，翻页后保留。 */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /** 选择器里已选流量的用途（默认 proof）。 */
  const [pickedRole, setPickedRole] = useState<TrafficEvidenceRole>("proof");
  /** 选择器的筛选与分页。 */
  const [pickerFilter, setPickerFilter] = useState<TrafficPickerFilter>(PICKER_FILTER_INIT);
  /** 选择器写入中。 */
  const [picking, setPicking] = useState(false);
  /** 选择器写入失败原因。 */
  const [pickerError, setPickerError] = useState<string | null>(null);

  const data = traffic.data;
  /** 已绑定的源流量 id：选择器据此显示「已绑定」并禁用该行（同一份快照复用，避免每次渲染新建）。 */
  const boundIds = useMemo(() => boundTrafficIds(data === null ? [] : data.bindings), [data]);

  /** 统一写入口：置忙、成功后替换快照、失败提示。 */
  const mutate = (label: string, action: () => Promise<Awaited<ReturnType<typeof editFindingTraffic>>>): void => {
    if (busy) return;
    setBusy(true);
    action()
      .then((next) => {
        setBusy(false);
        traffic.apply(next);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        toast(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const move = (index: number, delta: number): void => {
    if (data === null) return;
    const ids = data.bindings.map((item) => item.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    const moved = next[index];
    next[index] = next[target];
    next[target] = moved;
    mutate("调整顺序", () => orderFindingTraffic(findingId, next, data.version, contextTask));
  };

  return (
    <section className={css.panel} data-finding-section="traffic">
      <div className={css.head}>
        <span className={css.title}>关联流量{data === null ? "" : `（${data.bindings.length}）`}</span>
        {readOnly ? <span className={css.hint}>继承证据 · 只读</span> : null}
      </div>
      <p className={css.caption}>按复现顺序组织请求与响应。清理原始流量后，已绑定的证据仍然保留。</p>

      {traffic.phase === "loading" ? <div className={css.state}>加载关联流量…</div> : null}

      {traffic.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>关联流量读取失败：{traffic.error}</span>
          <Button variant="outline" size="sm" onClick={traffic.reload}>
            重试
          </Button>
        </div>
      ) : null}

      {traffic.phase === "ready" && data !== null && data.bindings.length === 0 ? (
        <p className={css.empty}>暂无关联流量。可绑定正常对照、漏洞证明和补充验证请求。</p>
      ) : null}

      {data !== null && data.bindings.length > 0 ? (
        <ul className={css.list}>
          {data.bindings.map((binding, index) => (
            <li key={binding.id} className={css.row} data-traffic-binding={binding.id}>
              <div className={css.rowHead}>
                <span className={css.index}>
                  {index + 1}. {TRAFFIC_ROLE_LABEL[binding.role]}
                </span>
                <span className={css.method}>
                  {binding.snapshot.method} · {binding.snapshot.status}
                </span>
                <span className={css.bindingId}>证据 #{binding.id}</span>
              </div>
              <p className={css.url} title={binding.snapshot.url}>
                {binding.snapshot.url}
              </p>
              {binding.note === "" ? null : <p className={css.note}>{binding.note}</p>}
              <div className={css.rowFoot}>
                <span className={css.time}>
                  {new Date(binding.snapshot.captured_at * 1000).toLocaleString("zh-CN", { hour12: false })}
                </span>
                <div className={css.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`查看证据 ${binding.id} 的报文`}
                    data-traffic-view={binding.id}
                    onClick={() => setViewing(binding.id)}
                  >
                    查看报文
                  </Button>
                  {readOnly ? null : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`上移证据 ${binding.id}`}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        上移
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`下移证据 ${binding.id}`}
                        disabled={busy || index === data.bindings.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        下移
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        data-traffic-edit={binding.id}
                        onClick={() => setEdit({ binding, role: binding.role, note: binding.note })}
                      >
                        编辑说明
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        data-traffic-remove={binding.id}
                        onClick={() => setRemoving(binding)}
                      >
                        解除绑定
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {readOnly ? null : (
        <div className={css.bindBar}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            data-traffic-picker-open=""
            onClick={() => {
              setPickerError(null);
              setPickerOpen(true);
            }}
          >
            绑定流量
          </Button>
          <span className={css.hint}>从已采集的请求/响应里多选，可设置用途。</span>
        </div>
      )}

      {readOnly ? null : (
        <TrafficPickerDialog
          findingId={findingId}
          open={pickerOpen}
          contextTask={contextTask}
          boundIds={boundIds}
          selected={picked}
          role={pickedRole}
          filter={pickerFilter}
          busy={picking}
          error={pickerError}
          onToggle={(trafficId, next) => {
            setPicked((current) => {
              const grown = new Set(current);
              if (next) grown.add(trafficId);
              else grown.delete(trafficId);
              return grown;
            });
          }}
          onTogglePage={(next, pageIds) => {
            setPicked((current) => {
              const grown = new Set(current);
              for (const id of pageIds) {
                if (next) grown.add(id);
                else grown.delete(id);
              }
              return grown;
            });
          }}
          onRole={(next) => setPickedRole(next)}
          onFilter={(patch) => setPickerFilter((current) => ({ ...current, ...patch }))}
          onClose={() => setPickerOpen(false)}
          onBound={() => {
            setPicked(new Set());
            setPickerFilter(PICKER_FILTER_INIT);
            setPickerOpen(false);
            traffic.reload();
          }}
          onBusy={(next, reason) => {
            setPicking(next);
            setPickerError(reason);
          }}
        />
      )}

      <Modal
        open={edit !== null}
        onClose={() => {
          if (!busy) setEdit(null);
        }}
        title="编辑流量证据"
        closeLabel="关闭"
        description="说明这组请求/响应如何支持漏洞结论。"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || edit === null || data === null}
              data-traffic-edit-save=""
              onClick={() => {
                if (edit === null || data === null) return;
                mutate("保存说明", () =>
                  editFindingTraffic(
                    findingId,
                    edit.binding.id,
                    data.version,
                    { role: edit.role, note: edit.note },
                    contextTask,
                  ),
                );
                setEdit(null);
              }}
            >
              保存说明
            </Button>
          </>
        }
      >
        {edit === null ? null : (
          <div className={css.form}>
            <FilterBar
              id="traffic-role"
              label="用途"
              value={edit.role}
              options={TRAFFIC_ROLE_ORDER.map((role) => ({ value: role, label: TRAFFIC_ROLE_LABEL[role] }))}
              onChange={(next) => setEdit({ ...edit, role: next as TrafficEvidenceRole })}
            />
            <label className={css.field}>
              <span className={css.fieldLabel}>证据说明</span>
              <textarea
                className={css.textarea}
                rows={3}
                value={edit.note}
                data-traffic-edit-note=""
                onChange={(event) => setEdit({ ...edit, note: event.target.value })}
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title="解除流量绑定"
        closeLabel="关闭"
        tone="warning"
        description="解除后这条证据不再挂在这个漏洞上，原始流量记录不受影响。"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || removing === null || data === null}
              data-traffic-remove-confirm=""
              onClick={() => {
                if (removing === null || data === null) return;
                mutate("解除绑定", () => removeFindingTraffic(findingId, removing.id, data.version, contextTask));
                setRemoving(null);
              }}
            >
              确认解除
            </Button>
          </>
        }
      >
        <p className={css.confirmText}>{removing === null ? "" : removing.snapshot.url}</p>
      </Modal>

      <TrafficEvidenceViewer
        open={viewing !== null}
        findingId={findingId}
        bindingId={viewing}
        contextTask={contextTask}
        onClose={() => setViewing(null)}
      />
    </section>
  );
}
