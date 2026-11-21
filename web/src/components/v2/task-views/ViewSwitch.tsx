"use client";

/**
 * U2 容器视图的子切换条：kit `FilterBar`，选中项写回 `?view=<容器>.<子>`。
 *
 * 容器（探索 / 发现 / 资产）只负责「选哪一个子视图」，子视图本身仍是原来的组件，
 * 自带 Page 滚动列与 PageHead；所以切换条放在子视图上方的一条细带里，不改子视图结构。
 */
import { type ReactNode, useCallback } from "react";

import { FilterBar, type FilterOption } from "@/components/v2/design/Kit";
import { setConversationView } from "@/v2/data/conversation-view-url";

import css from "./ViewSwitch.module.css";

/**
 * 解析子视图：URL 里给的合法子视图，否则默认（第一项）。
 * @param sub - `?view=` 里点号后的部分。
 * @param options - 合法子视图。
 * @returns 生效的子视图 id。
 */
export function pickSub<V extends string>(sub: string | undefined, options: readonly FilterOption<V>[]): V {
  const hit = options.find((option) => option.value === sub);
  return (hit ?? options[0]).value;
}

/**
 * 容器视图外壳：顶部子切换条 + 子视图。
 * @param props.container - 容器 id（写 URL 用）。
 * @param props.label - 切换条的无障碍名称。
 * @param props.value - 当前子视图。
 * @param props.options - 子视图选项。
 * @param props.children - 当前子视图内容。
 * @returns 容器视图。
 */
export function ViewSwitch<V extends string>({
  container,
  label,
  value,
  options,
  children,
}: {
  container: string;
  label: string;
  value: V;
  options: readonly FilterOption<V>[];
  children: ReactNode;
}): ReactNode {
  const onChange = useCallback((next: V) => setConversationView(`${container}.${next}`), [container]);
  return (
    <div className={css.hub} data-view-hub={container} data-view-sub={value}>
      <div className={css.switchBand}>
        <FilterBar id={`view-${container}`} label={label} value={value} options={options} onChange={onChange} />
      </div>
      <div className={css.body}>{children}</div>
    </div>
  );
}
