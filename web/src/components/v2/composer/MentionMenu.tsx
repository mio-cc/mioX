"use client";

/**
 * 输入区 `@` 补全下拉：工作区真实文件 + 记录候选，带加载/空/失败四态。
 * 旧页面依据：ARTEX/web/src/components/mention-textarea.tsx:233-320（候选列表的
 *   「搜索中…」「搜索失败：<错误>」「没有匹配记录」三种态与键盘漫游）、
 *   app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1944,2010（两处输入区挂载）。
 * DSH 依据：`ui-input-trigger/src/client/MenuView.tsx:1-14`（候选菜单挂在输入框上方、
 *   焦点留在输入框、行用 mousedown 处理、高亮走 aria-activedescendant）。
 * 对照表行：P1:B19
 */
import * as React from "react";

import type { FileMentionCandidate, FileMentionState } from "@/v2/data/file-mentions";
import { Button } from "@/vendor/dsh/primitives/Button";

import css from "./SideQuestions.module.css";
import menu from "./Composer.module.css";

/**
 * 渲染 `@` 候选下拉。
 * @param props.state - 适配器给出的阶段/候选/错误。
 * @param props.activeIndex - 键盘高亮的行号。
 * @param props.onHover - 指针移到某一行时同步高亮。
 * @param props.onPick - 选中一行。
 * @param props.onRetry - 失败时重新读取。
 * @returns 下拉；没有可显示内容时仍是四态之一，不会凭空消失。
 */
export function MentionMenu({
  state,
  activeIndex,
  onHover,
  onPick,
  onRetry,
}: {
  readonly state: FileMentionState;
  readonly activeIndex: number;
  readonly onHover: (index: number) => void;
  readonly onPick: (candidate: FileMentionCandidate) => void;
  readonly onRetry: () => void;
}): React.ReactNode {
  const { phase, candidates, error, stallMs } = state;
  return (
    <div className={menu.triggerMenu} role="listbox" aria-label="引用文件或记录">
      <div className={menu.triggerHead}>
        引用文件或记录<span aria-hidden> · ↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>

      {phase === "loading" ? (
        <div className={css.mentionLoading} role="status">
          搜索中…{stallMs >= 3000 ? `（已等待 ${Math.floor(stallMs / 1000)} 秒）` : ""}
        </div>
      ) : phase === "offline" ? (
        <div className={css.mentionError} role="alert">
          搜索失败：{error}
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        </div>
      ) : phase === "empty" ? (
        <div className={css.mentionEmpty} role="status">
          没有匹配的文件或记录，请更换名称或路径
        </div>
      ) : (
        <>
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`${menu.triggerRow} ${index === activeIndex ? menu.triggerRowActive : ""}`}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(candidate)}
            >
              {candidate.kindLabel !== undefined ? <span className={css.mentionKind}>{candidate.kindLabel}</span> : null}
              <span className={menu.triggerLabel}>{candidate.token}</span>
              <span className={menu.triggerDesc}>{candidate.hint}</span>
            </button>
          ))}
          {error !== null ? (
            <div className={css.mentionFoot} role="alert">
              {error}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
