"use client";

/**
 * 流量选择器：给发现绑定流量用（A12，对照表 P2:K1）。
 * 旧页面依据：ARTEX/web/src/components/traffic-picker-dialog.tsx:29-269
 *   （host / 方法 / 关键词三个筛选 + 分页 + 跨页保留已选 + 已绑定行禁用 + 确认后 bindFindingTraffic）。
 * DSH 依据：DSH 无流量选择页；按「发现详情里的页内弹窗」扩展（100-实施计划总表 §4 决策表最后一列），
 *   弹窗用 `Modal`，筛选用 `Input` / `SelectMenu`，行选用 `Checkbox`，用途用 `SegmentedControl`。
 * 对照表行：P2:K1
 *
 * 取数一律走适配器：列表读 `v2/data/traffic.ts` 的 `useTrafficPage`（api.ts:880-907），
 * 写入走 `v2/data/finding-traffic.ts` 的 `bindFindingTraffic`（api.ts:695）。
 * 已选项由父组件持有（选择在弹窗内跨翻页保留），组件本身只收到值与变更回调。
 */
import { type ReactNode, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { FilterBar } from "@/components/v2/design/Kit";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconSearchOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { TrafficEvidenceRef, TrafficEvidenceRole, TrafficExchange } from "@/lib/types";
import { bindFindingTraffic, boundTrafficIds, TRAFFIC_ROLE_LABEL, TRAFFIC_ROLE_ORDER } from "@/v2/data/finding-traffic";
import { TRAFFIC_PAGE_SIZES, type TrafficPageQuery, useTrafficPage } from "@/v2/data/traffic";

import css from "./traffic.module.css";
import { TrafficDetail } from "./TrafficDetail";

/** 方法下拉（旧页 traffic-picker-dialog.tsx:27 METHODS 的同口径，外加「其他」）。 */
const METHOD_OPTIONS = [
  { value: "all", label: "全部方法" },
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "DELETE", label: "DELETE" },
  { value: "PATCH", label: "PATCH" },
];

/** 用途的分段控件选项（默认值在父组件里取 proof）。 */
const ROLE_OPTIONS = TRAFFIC_ROLE_ORDER.map((role) => ({ value: role, label: TRAFFIC_ROLE_LABEL[role] }));

/**
 * 未在该页出现的查询字段一律取中性值：选择器只暴露 host / 方法 / 关键词三个筛选。
 * @param page - 1 基页码。
 * @param size - 每页条数。
 * @param host - host 筛选（空串不过滤）。
 * @param method - 方法筛选（`all` 不过滤）。
 * @param q - 关键词（空串不过滤）。
 * @returns 完整筛选参数。
 */
function buildQuery(page: number, size: number, host: string, method: string, q: string): TrafficPageQuery {
  return {
    page,
    size,
    host,
    method,
    q,
    body: "",
    path: "",
    status: "all",
    respMin: "",
    respMax: "",
    sort: "ts",
    order: "desc",
  };
}

export interface TrafficPickerDialogProps {
  /** 发现 id。 */
  readonly findingId: string;
  /** 是否显示。 */
  readonly open: boolean;
  /** 可选的上下文任务 id。 */
  readonly contextTask?: string;
  /** 已绑定的源流量 id（这些行显示「已绑定」且不可选）。 */
  readonly boundIds: ReadonlySet<string>;
  /** 当前已选的源流量 id（跨翻页保留，由父组件持有）。 */
  readonly selected: ReadonlySet<string>;
  /** 已选流量的用途，同一批统一设置。 */
  readonly role: TrafficEvidenceRole;
  /** 筛选与分页状态（父组件持有，关闭后不清）。 */
  readonly filter: TrafficPickerFilter;
  /** 写入中。 */
  readonly busy: boolean;
  /** 失败原因；null 表示无。 */
  readonly error: string | null;
  /** 改勾选：`next` 为 true 表示加入已选。 */
  readonly onToggle: (trafficId: string, next: boolean) => void;
  /** 整页加入 / 移出已选（只作用于本页可选行；第二个参数是本页可选的源流量 id）。 */
  readonly onTogglePage: (next: boolean, trafficIds: readonly string[]) => void;
  /** 改用途。 */
  readonly onRole: (role: TrafficEvidenceRole) => void;
  /** 改筛选或分页（父组件同时把页码重置为 1 的地方由这里自觉处理）。 */
  readonly onFilter: (patch: Partial<TrafficPickerFilter>) => void;
  /** 关闭弹窗（取消）。 */
  readonly onClose: () => void;
  /** 写入成功：父组件刷新面板并关闭。 */
  readonly onBound: (count: number) => void;
  /** 置忙 / 解除置忙与错误（写入由本组件发起，父组件只持有状态）。 */
  readonly onBusy: (busy: boolean, error: string | null) => void;
}

/** 选择器暴露的筛选与分页状态。 */
export interface TrafficPickerFilter {
  page: number;
  size: number;
  host: string;
  method: string;
  q: string;
}

/**
 * 渲染流量选择弹窗。
 * @param props - 发现 id、打开状态、已选与筛选状态、各变更回调。
 * @returns 弹窗；`open` 为 false 时 `Modal` 自身不渲染。
 */
export function TrafficPickerDialog({
  findingId,
  open,
  contextTask,
  boundIds,
  selected,
  role,
  filter,
  busy,
  error,
  onToggle,
  onTogglePage,
  onRole,
  onFilter,
  onClose,
  onBound,
  onBusy,
}: TrafficPickerDialogProps): ReactNode {
  const debouncedQuery = useDebouncedValue(filter.q.trim(), 250);
  const state = useTrafficPage(buildQuery(filter.page, filter.size, filter.host.trim(), filter.method, debouncedQuery));

  /** 正在预览的流量行；null 表示预览关闭（A10 `TrafficDetail`，P2:K1）。 */
  const [preview, setPreview] = useState<TrafficExchange | null>(null);

  const rows = state.data?.exchanges ?? [];
  const total = state.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / filter.size));

  /** 本页可选行（排除已绑定）。 */
  const selectable = useMemo(() => rows.filter((row) => !boundIds.has(row.id)), [rows, boundIds]);
  const pageAllChosen = selectable.length > 0 && selectable.every((row) => selected.has(row.id));

  const close = (): void => {
    if (busy) return;
    onClose();
  };

  const confirm = (): void => {
    if (busy || selected.size === 0) return;
    const refs: TrafficEvidenceRef[] = [...selected].map((trafficId) => ({ traffic_id: trafficId, role }));
    onBusy(true, null);
    bindFindingTraffic(findingId, refs, contextTask)
      .then(() => {
        onBusy(false, null);
        toast(`已绑定 ${refs.length} 条流量`);
        onBound(refs.length);
      })
      .catch((reason: unknown) => {
        onBusy(false, reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="绑定流量"
      closeLabel="关闭"
      description="筛选并多选请求/响应，已选记录会跨页保留；已绑定过的流量不可重复选择。"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={close} data-traffic-picker-cancel="">
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || selected.size === 0}
            onClick={confirm}
            data-traffic-picker-confirm=""
          >
            {busy ? "绑定中…" : `绑定 ${selected.size} 条流量`}
          </Button>
        </>
      }
    >
      <div className={css.pickerWrap} data-traffic-picker={selected.size}>
        <div className={css.filterRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>目标 host</span>
            <Input
              value={filter.host}
              placeholder="域名或 IP"
              aria-label="目标 host"
              data-traffic-picker-host=""
              onChange={(event) => onFilter({ host: event.currentTarget.value, page: 1 })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>请求方法</span>
            <SelectMenu
              ariaLabel="请求方法筛选"
              value={filter.method}
              options={METHOD_OPTIONS}
              onChange={(next) => onFilter({ method: next, page: 1 })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>关键词</span>
            <Input
              value={filter.q}
              placeholder="URL / 正文关键词"
              aria-label="关键词"
              icon={<IconSearchOutlineRegular size={14} />}
              data-modal-autofocus
              data-traffic-picker-query=""
              onChange={(event) => onFilter({ q: event.currentTarget.value, page: 1 })}
            />
          </label>
        </div>

        <div className={css.filterRow}>
          <SelectMenu
            ariaLabel="每页条数"
            value={String(filter.size)}
            options={TRAFFIC_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }))}
            onChange={(next) => onFilter({ size: Number(next), page: 1 })}
          />
          <span className={css.fieldLabel}>用途</span>
          <FilterBar
            id="traffic-picker-role"
            label="绑定用途"
            value={role}
            options={ROLE_OPTIONS}
            disabled={busy}
            onChange={(next) => onRole(next)}
          />
        </div>

        {error !== null ? (
          <div className={css.errorLine} role="alert" data-traffic-picker-error="">
            <span>绑定失败：{error}</span>
          </div>
        ) : null}

        <div className={css.scrollX} aria-busy={state.phase === "loading"}>
          <table className={css.table} data-traffic-picker-table="">
            <thead>
              <tr>
                <th className={css.checkCell}>
                  <Checkbox
                    label=""
                    checked={pageAllChosen}
                    disabled={busy || state.phase !== "ready" || selectable.length === 0}
                    title="选择本页未绑定的流量"
                    onChange={(next) => onTogglePage(next, selectable.map((row) => row.id))}
                  />
                </th>
                <th>方法 / URL</th>
                <th>时间</th>
                <th className={css.num}>状态码</th>
                <th className={css.num}>响应长度</th>
                <th className={css.actionCell}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const already = boundIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className={selected.has(row.id) ? css.rowSelected : undefined}
                    data-traffic-picker-row={row.id}
                  >
                    <td className={css.checkCell}>
                      <Checkbox
                        label=""
                        checked={already || selected.has(row.id)}
                        disabled={busy || already}
                        title={already ? "该流量已绑定到这个漏洞" : undefined}
                        onChange={(next) => onToggle(row.id, next)}
                      />
                    </td>
                    <td className={css.urlCell}>
                      <span className={css.mono}>
                        {row.method} {row.url}
                      </span>
                      {already ? (
                        <Tag tone="neutral" className={css.pickerTag}>
                          已绑定
                        </Tag>
                      ) : null}
                    </td>
                    <td className={css.time}>{new Date(row.ts).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className={css.num}>{row.status}</td>
                    <td className={css.num}>{row.resp_len}</td>
                    <td className={css.actionCell}>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`预览流量 ${row.id} 的报文`}
                        data-traffic-picker-preview={row.id}
                        onClick={(event) => {
                          // 预览只读：阻止冒泡，绝不动勾选（P2:K1）。
                          event.stopPropagation();
                          setPreview(row);
                        }}
                      >
                        预览
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {state.phase !== "loading" && rows.length === 0 && state.phase === "ready" ? (
                <tr>
                  <td colSpan={6}>
                    <div className={css.hintLine} data-traffic-picker-empty="">
                      {filter.q.trim() === "" && filter.host.trim() === "" && filter.method === "all"
                        ? "流量库还没有记录到任何请求/响应。"
                        : "没有匹配的流量。"}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {state.phase === "loading" ? (
          <div className={css.hintLine} data-traffic-picker-loading="">
            读取流量…
          </div>
        ) : null}
        {state.phase === "offline" ? (
          <div className={css.errorLine} role="alert">
            <span>流量列表读取失败：{state.error}</span>
            <Button variant="outline" size="sm" onClick={state.reload}>
              重试
            </Button>
          </div>
        ) : null}

        <div className={css.pager} data-traffic-picker-pager="">
          <Button
            variant="outline"
            size="sm"
            aria-label="上一页"
            disabled={state.phase !== "ready" || filter.page <= 1}
            onClick={() => onFilter({ page: Math.max(1, filter.page - 1) })}
            data-traffic-picker-prev=""
            icon={<IconChevronLeftOutlineRegular size={13} />}
          />
          <span className={css.pageInfo}>
            第 {filter.page} / {pageCount} 页 · 共 {total} 条
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="下一页"
            disabled={state.phase !== "ready" || filter.page >= pageCount}
            onClick={() => onFilter({ page: Math.min(pageCount, filter.page + 1) })}
            data-traffic-picker-next=""
            icon={<IconChevronRightOutlineRegular size={13} />}
          />
          <span className={css.pageInfo} data-traffic-picker-selected={selected.size}>
            已选 {selected.size} 条
          </span>
        </div>
      </div>

      {/*
        P2:K1 逐行预览报文：复用 A10 `TrafficDetail`（按流量 id 读 `trafficExchange`，只读）。
        挂在选择器上方一层（`useModalLayer` 栈支持嵌套），关掉预览回到选择器，已选不变。
      */}
      <TrafficDetail row={preview} onClose={() => setPreview(null)} />
    </Modal>
  );
}
