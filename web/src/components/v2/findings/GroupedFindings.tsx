"use client";

/**
 * 发现页「按任务分组」视图（对照表 P2:B20）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/findings/page.tsx:1020-1130（分组卡：组头
 * 折叠按钮 + 任务名/编号 + 任务描述 + 任务状态 + 各级严重度计数 + 最近时间；展开后组内
 * 列表与组内分页；组间分页 5/10/20，默认 10）、:371-393（`refreshGroups` 取分组页）、
 * :395-461（`loadGroup` 逐组按 task 取组内分页）、:463-475（`toggleGroup` 展开时惰性取组内第一页）。
 * DSH 依据：DSH 无可折叠分组卡原语，按「主区整页」内的自绘列表 + `Tag` 扩展（总表 §6）；
 * 组头折叠按钮与页面筛选条同一套原生 button + `--dsw-*` 变量写法。
 * 对照表行：P2:B20
 *
 * 取数全部在 `v2/data/findings-page.ts`：组页 `useFindingGroups`（`api.findingGroups`，
 * api.ts:643）、组内行 `useFindingGroupRows`（`api.findingsPage`，api.ts:637）。
 * 分组视图只按任务聚合，不画「查看任务」跳转（v2 没有 `/function/tasks/detail` 路由，
 * 旧页 :1077-1086 那个按钮在这里会是假链接）。
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";

import type { Finding } from "@/lib/types";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconChevronRightOutlineRegular, IconShieldOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import {
  FINDING_GROUPS_PAGE_SIZE,
  FINDING_GROUP_ROWS_PAGE_SIZE,
  UNASSIGNED_TASK,
  findingGroupKey,
  findingGroupTitle,
  findingStatusLabel,
  findingTitle,
  formatFindingTime,
  severityLabel,
  useFindingGroupRows,
  useFindingGroups,
  type FindingsSort,
} from "@/v2/data/findings-page";

import css from "./GroupedFindings.module.css";

/** 组头展示严重等级分布的顺序（严重 → 低危，旧页 :1064 的 `SEVERITIES`）。 */
const GROUP_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** 分组视图的组间分页可选条数（旧页 :1127 的 `pageSizeOptions={[5,10,20]}`）。 */
const GROUP_PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 20];

/** 取一个分组的某一级严重度计数（字段名与 `FindingGroup` 一致；缺省按 0）。 */
function groupSeverityCount(group: Record<string, unknown>, level: (typeof GROUP_SEVERITIES)[number]): number {
  const value = group[level];
  return typeof value === "number" ? value : 0;
}

/**
 * 组头「严重度 + 计数」徽章：某级计数为 0 时不画（旧页 :1066-1073 只在 `count > 0` 时渲染）。
 * @param props.group - 后端分组。
 * @returns 徽章列表。
 */
function GroupSeverityTags({ group }: { group: { critical: number; high: number; medium: number; low: number } }): ReactNode {
  const shown = GROUP_SEVERITIES.filter((level) => groupSeverityCount(group, level) > 0);
  if (shown.length === 0) return null;
  return (
    <span className={css.severityTags}>
      {shown.map((level) => (
        <span key={level} className={css.severityPair}>
          <Tag tone={severityTone(level)}>{severityLabel(level)}</Tag>
          <span className={css.severityCount}>{groupSeverityCount(group, level)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * 严重等级对应的 Tag 色调（与 `TaskFindingsView.tsx:53-59` 的 `severityTone` 同口径）。
 * @param severity - 后端严重等级。
 * @returns Tag 的 tone。
 */
function severityTone(severity: string): "danger" | "warning" | "info" | "neutral" | "outline" {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "neutral";
  return "outline";
}

/** 组内一行（标题 + 严重度 + 摘要 + 状态 + 时间；点行打开详情）。 */
function GroupFindingRow({ finding, onOpen }: { finding: Finding; onOpen: (id: string) => void }): ReactNode {
  const id = String(finding.finding_id ?? finding.id);
  const title = findingTitle(finding);
  return (
    <li
      className={css.groupRow}
      role="button"
      tabIndex={0}
      aria-label={`打开发现详情：${title}`}
      data-findings-group-row={id}
      onClick={() => onOpen(id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(id);
      }}
    >
      <Tag tone={severityTone(finding.severity)}>{severityLabel(finding.severity)}</Tag>
      <span className={css.groupRowMain}>
        <span className={css.groupRowTitle}>{title}</span>
        <span className={css.groupRowSub}>{finding.summary || finding.vulnclass}</span>
      </span>
      <span className={css.groupRowMeta}>
        <span className={css.groupRowClass}>{finding.vulnclass}</span>
        <span className={css.groupRowStatus}>{findingStatusLabel(finding.status)}</span>
        <span className={css.groupRowTime}>{formatFindingTime(finding.ts)}</span>
      </span>
    </li>
  );
}

/**
 * 一个已展开分组的组内发现（自带组内页码与四态；页码变化由本组件持有）。
 * @param props.taskKey - 组 key（`findingGroupKey`）。
 * @param props.query - 分组视图共用的搜索词与排序。
 * @param props.filters - 分组视图共用的四类筛选。
 * @param props.onOpen - 打开某条发现详情。
 * @returns 组内列表 + 组内分页，或加载 / 失败 / 空三态。
 */
function GroupRows({
  taskKey,
  query,
  sort,
  severity,
  status,
  vulnclass,
  onOpen,
}: {
  taskKey: string;
  query: string;
  sort: FindingsSort;
  severity: GroupedFindingsFilters["severity"];
  status: GroupedFindingsFilters["status"];
  vulnclass: string;
  onOpen: (id: string) => void;
}): ReactNode {
  const [page, setPage] = useState(1);
  const state = useFindingGroupRows({ taskKey, page, query, sort, severity, status, vulnclass });
  const pageCount = Math.max(1, Math.ceil(state.total / FINDING_GROUP_ROWS_PAGE_SIZE));

  if (state.phase === "loading") return <div className={css.groupState}>加载中…</div>;
  if (state.phase === "offline") {
    return (
      <div className={css.groupStateError} role="alert">
        <span>读取失败：{state.error}</span>
        <Button variant="outline" size="sm" onClick={state.reload}>
          重试
        </Button>
      </div>
    );
  }
  if (state.items.length === 0) return <div className={css.groupState}>本组暂无匹配的发现。</div>;

  return (
    <>
      <ul className={css.groupList} data-findings-group-rows={taskKey}>
        {state.items.map((finding) => (
          <GroupFindingRow key={finding.finding_id ?? finding.id} finding={finding} onOpen={onOpen} />
        ))}
      </ul>
      <div className={css.groupPager}>
        <span>
          第 {page} / {pageCount} 页 · 共 {state.total} 条
        </span>
        <span className={css.groupPagerActions}>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            data-findings-group-page="prev"
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            data-findings-group-page="next"
          >
            下一页
          </Button>
        </span>
      </div>
    </>
  );
}

/** 分组视图共用的筛选条件（与平铺列表同一份 state，由页面持有）。 */
export interface GroupedFindingsFilters {
  severity: "all" | "critical" | "high" | "medium" | "low";
  status: "all" | Finding["status"];
  vulnclass: string;
  task: string;
}

/**
 * 「按任务分组」视图。
 * @param props.query - 页面搜索框里已防抖的搜索词。
 * @param props.sort - 页面排序键。
 * @param props.filters - 页面四类筛选（与平铺视图同一份 state）。
 * @param props.seed - 页面数据版本号；变化时清空已展开的组与组内页码。
 * @param props.onOpen - 打开某条发现详情（由页面接地址参数）。
 * @returns 分组列表 + 组间分页，或加载 / 失败 / 空三态。
 */
export function GroupedFindings({
  query,
  sort,
  filters,
  seed,
  onOpen,
}: {
  query: string;
  sort: FindingsSort;
  filters: GroupedFindingsFilters;
  /** 筛选指纹（页面用 `JSON.stringify` 拼的稳定串）；变化即回第 1 页并收起分组。 */
  seed: string;
  onOpen: (id: string) => void;
}): ReactNode {
  // 组间页码由本视图持有；筛选/搜索/排序一变就回第 1 页（旧页 :509-522 的清空口径）。
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FINDING_GROUPS_PAGE_SIZE);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [appliedSeed, setAppliedSeed] = useState(seed);

  // 渲染期内的条件重置（React 官方「按 props 变化调整 state」写法，比 effect 少一次旧数据渲染）。
  if (appliedSeed !== seed) {
    setAppliedSeed(seed);
    setPage(1);
    setExpandedKeys(new Set<string>());
  }

  const state = useFindingGroups({
    page,
    pageSize,
    query,
    sort,
    severity: filters.severity,
    status: filters.status,
    vulnclass: filters.vulnclass,
    task: filters.task,
  });

  const groupPageCount = Math.max(1, Math.ceil(state.total / pageSize));

  const toggleGroup = useCallback((key: string): void => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pageKeys = useMemo(() => state.items.map((group) => findingGroupKey(group)), [state.items]);

  if (state.phase === "loading") return <div className={css.state}>加载中…</div>;
  if (state.phase === "offline") {
    return (
      <div className={css.stateError} role="alert" data-findings-groups="offline">
        <span>读取失败：{state.error}</span>
        <Button variant="outline" size="sm" onClick={state.reload} data-findings-groups-retry="">
          重试
        </Button>
      </div>
    );
  }
  if (state.items.length === 0) {
    return (
      <div className={css.empty} data-findings-groups="empty">
        <IconShieldOutlineRegular size={20} />
        <span className={css.emptyTitle}>{query === "" ? "还没有发现" : "没有匹配的发现"}</span>
        <span className={css.emptyText}>
          {query === ""
            ? "任务执行确认漏洞后会按所属任务聚到这里。"
            : "换个关键词或筛选条件，或清空搜索后重试。"}
        </span>
      </div>
    );
  }

  return (
    <div className={css.wrap} data-findings-groups="ready" data-findings-groups-count={state.items.length}>
      <ul className={css.groupListRoot}>
        {state.items.map((group) => {
          const key = findingGroupKey(group);
          const open = expandedKeys.has(key);
          const title = findingGroupTitle(group);
          return (
            <li key={key} className={css.groupCard} data-findings-group={key}>
              <div className={css.groupHead}>
                <button
                  type="button"
                  className={css.groupToggle}
                  aria-expanded={open}
                  aria-label={`${open ? "折叠" : "展开"}分组：${title}`}
                  onClick={() => toggleGroup(key)}
                  data-findings-group-toggle={key}
                >
                  <IconChevronRightOutlineRegular size={12} className={open ? css.groupToggleOpen : undefined} />
                  <span className={css.groupText}>
                    <span className={css.groupTitle} title={title}>
                      {title}
                    </span>
                    <span className={css.groupDesc} title={group.task_description}>
                      {group.task_description === "" ? "来源任务不可用" : group.task_description}
                    </span>
                  </span>
                </button>
                <span className={css.groupMeta}>
                  {group.task_status === "" ? null : (
                    <Tag tone="quiet" className={css.groupStatus}>
                      {group.task_status}
                    </Tag>
                  )}
                  <GroupSeverityTags group={group} />
                  <span className={css.groupCount} title={`共 ${group.count} 条发现`}>
                    {group.count} 条
                  </span>
                  <span className={css.groupTime}>{formatFindingTime(group.last_found_at)}</span>
                </span>
              </div>
              {open ? (
                <div className={css.groupBody} data-findings-group-body={key}>
                  <GroupRows
                    taskKey={key}
                    query={query}
                    sort={sort}
                    severity={filters.severity}
                    status={filters.status}
                    vulnclass={filters.vulnclass}
                    onOpen={onOpen}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className={css.pager} data-findings-groups-pager="">
        <span>
          {state.total} 个分组 · {state.findingTotal} 条发现 · 每页 {pageSize} 组
        </span>
        <span className={css.pagerActions}>
          <SelectMenu
            value={String(pageSize)}
            ariaLabel="每组数"
            options={GROUP_PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `每页 ${size} 组` }))}
            onChange={(next) => {
              setPageSize(Number(next));
              setPage(1);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            data-findings-groups-page="prev"
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= groupPageCount}
            onClick={() => setPage((current) => Math.min(groupPageCount, current + 1))}
            data-findings-groups-page="next"
          >
            下一页
          </Button>
        </span>
      </div>
      {pageKeys.length === 0 && page > 1 ? <span className={css.muted}>本页无分组。</span> : null}
    </div>
  );
}
