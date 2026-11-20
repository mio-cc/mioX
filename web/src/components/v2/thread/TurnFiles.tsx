"use client";

/**
 * 回合末尾的改动文件块（P1:B31「回合变更文件 / 交付物条」）。
 *
 * 每个主 Agent 回合的收尾 result 下面挂一块：卡头报「本轮改动 N 个文件 · M 次写入」，
 * 每行一个文件（路径 + 变更类型 + 改写次数），点行展开该文件的对比。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/detail/task-workspace-dsh.tsx:667-761`
 *   （`ChangedFilesCard`：`TURN_FILE_OPS` 译名、卡头总数、行 `aria-expanded` +
 *   展开后按 `call.seq` 拉 `api.activityDetail` 用 `DiffBody` 画对比）、`:1556`
 *   （`changed.length > 0` 才渲染，没改文件的回合不留空壳）、`:1574`
 *   （位置在助手回答与 Like/Dislike 之后、Turn 结束行之前）。
 * DSH 依据：`dsh-upstream/packages/client/ui-deliverables/src/client/ChangedFiles.tsx:37-106`
 *   （回合末改动卡：卡头总数、每行路径、超过 4 行折叠并可展开全部）、
 *   `turn-deliverables.ts:162-170`（没产出文件就不挂 turn-tail）。
 * 对照表行：P1:B31
 */
import { useEffect, useRef, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { DiffBlock } from "@/vendor/dsh/primitives/DiffBlock";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCodeOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { TurnChangedFile } from "@/lib/types";
import { buildHunk } from "@/v2/data/block-cards";
import {
  loadTurnFileCalls,
  turnCallText,
  turnWriteTotal,
  TURN_FILE_OP_LABEL,
  TURN_FILES_COLLAPSED_ROWS,
  type TurnCallText,
  type TurnFileDetail,
} from "@/v2/data/turn-files";

import { DIFF_LABELS } from "./thread-labels";
import css from "./TurnFiles.module.css";

/** 展开后每个文件最多画几行对比（旧页 `:751` `maxLines={6}`）。 */
const DIFF_MAX_LINES = 6;

export interface TurnFilesProps {
  /** 该回合改动的文件；为空数组时整块不渲染（不留空壳）。 */
  readonly files: readonly TurnChangedFile[];
  /** 任务 id；展开读参数要它。该项由调用方保证非空。 */
  readonly taskId: string;
}

/**
 * 渲染一个回合的改动文件块。
 * @param props.files - 该回合改动的文件（已按首次出现排序、去重）。
 * @param props.taskId - 任务 id，展开时按 `call.seq` 读参数。
 * @returns 卡头 + 文件行（多文件可折叠）+ 展开后的对比。
 */
export function TurnFiles({ files, taskId }: TurnFilesProps): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [details, setDetails] = useState<Readonly<Record<string, TurnFileDetail>>>({});
  /** 已经发过请求的路径，避免重复读取（旧页 `:693`）。 */
  const requested = useRef(new Set<string>());

  // 换任务时旧参数不能再画：路径相同但文件不同。
  useEffect(() => {
    requested.current = new Set<string>();
    setDetails({});
    setOpenPath(null);
    setExpanded(false);
  }, [taskId]);

  if (files.length === 0) return null;

  const foldable = files.length > TURN_FILES_COLLAPSED_ROWS;
  const rows = foldable && !expanded ? files.slice(0, TURN_FILES_COLLAPSED_ROWS) : files;

  /** 点一行：展开 / 收起；首次展开时按 `call.seq` 读参数（旧页 `:690-716`）。 */
  const toggle = (file: TurnChangedFile): void => {
    const next = openPath === file.path ? null : file.path;
    setOpenPath(next);
    if (next === null || requested.current.has(file.path)) return;
    requested.current.add(file.path);
    setDetails((prev) => ({ ...prev, [file.path]: { loading: true, calls: null, error: null } }));
    loadTurnFileCalls(taskId, file)
      .then((calls) => {
        setDetails((prev) => ({ ...prev, [file.path]: { loading: false, calls, error: null } }));
      })
      .catch((reason: unknown) => {
        setDetails((prev) => ({
          ...prev,
          [file.path]: { loading: false, calls: null, error: reason instanceof Error ? reason.message : String(reason) },
        }));
      });
  };

  /** 展开体：读取中 / 失败可重试 / 每条调用一张对比 / 没记录到参数。 */
  const detailBody = (file: TurnChangedFile): React.ReactNode => {
    const detail = details[file.path];
    if (detail === undefined || detail.loading) return <p className={css.stateLine}>读取改动…</p>;
    if (detail.error !== null) {
      return (
        <p className={css.stateError} role="alert">
          读取改动失败：{detail.error}
        </p>
      );
    }
    const calls = (detail.calls ?? []).map((payload) => turnCallText(payload));
    const drawn = calls.filter((call) => call.before !== undefined || call.after !== undefined);
    if (drawn.length === 0) return <p className={css.stateLine}>这一步没有记录可对比的参数</p>;
    return drawn.map((call: TurnCallText, index: number) => (
      <DiffBlock
        key={index}
        diffs={buildHunk(file.path, call.before, call.after)}
        labels={DIFF_LABELS}
        maxLines={DIFF_MAX_LINES}
      />
    ));
  };

  const writes = turnWriteTotal(files);

  return (
    <div className={css.card} data-turn-files="" data-file-count={files.length} data-write-count={writes}>
      <div className={css.head}>
        <IconCodeOutlineRegular size={13} />
        <span className={css.title}>本轮改动 {files.length} 个文件</span>
        <span className={css.meta}>{writes} 次写入</span>
      </div>
      <ul className={css.list}>
        {rows.map((file) => {
          const open = openPath === file.path;
          return (
            <li key={file.path} className={css.item}>
              <button
                type="button"
                className={css.row}
                data-turn-file-row=""
                data-path={file.path}
                data-ops={file.ops.join(",")}
                data-count={file.count}
                aria-expanded={open}
                onClick={() => toggle(file)}
              >
                {open ? <IconChevronUpOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
                <span className={css.path} title={file.path}>
                  {file.path}
                </span>
                <span className={css.ops}>
                  {file.ops.map((op) => (
                    <Tag key={op} tone="quiet">
                      {TURN_FILE_OP_LABEL[op] ?? op}
                    </Tag>
                  ))}
                </span>
                <span className={css.count}>{file.count}</span>
              </button>
              {open ? (
                <div className={css.detail} data-turn-file-detail={file.path}>
                  {detailBody(file)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {foldable ? (
        <Button
          variant="ghost"
          size="sm"
          data-turn-files-toggle=""
          aria-expanded={expanded}
          className={css.toggle}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `显示全部 ${files.length} 个文件`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 回合改动块的四种状态壳（P1:B31 的四态要求）。
 *
 * 没有选中任务、或不在主 Agent 车道时 `phase === "idle"` 返回 null：那些车道没有
 * 回合（旧页 `:2120-2123`），画一行空状态没有意义。
 * @param props.phase - 读取中 / 就绪 / 失败 / 不适用。
 * @param props.error - 失败原因。
 * @param props.onRetry - 失败时的重试动作（真实重取）。
 * @param props.files - 该回合改动的文件（就绪时）。
 * @param props.taskId - 任务 id。
 * @param props.emptyLabel - 就绪但没有文件时是否显示空态（列表区用；回合内不显示）。
 * @returns 状态壳或 `TurnFiles`。
 */
export function TurnFilesSlot({
  phase,
  error,
  onRetry,
  files,
  taskId,
  renderEmpty,
}: {
  readonly phase: "loading" | "ready" | "offline" | "idle";
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly files: readonly TurnChangedFile[];
  readonly taskId: string | null;
  /** 就绪但该回合没改文件时是否要一行空态（回合内传 false：不留空壳）。 */
  readonly renderEmpty: boolean;
}): React.ReactNode {
  if (phase === "idle") return null;
  if (phase === "loading") return <p className={css.stateLine}>读取本轮改动…</p>;
  if (phase === "offline") {
    return (
      <div className={css.failRow} role="alert" data-turn-files-state="offline">
        <span className={css.stateError}>读取本轮改动失败：{error ?? "未知原因"}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }
  if (files.length === 0) {
    return renderEmpty ? (
      <p className={css.stateLine} data-turn-files-state="empty">
        本轮没有改动文件
      </p>
    ) : null;
  }
  if (taskId === null) return null;
  return <TurnFiles files={files} taskId={taskId} />;
}
