"use client";

/**
 * 旁路问题面板：显示某个车道正在运行的会话的旁路问答，并可取消/清空。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1972-1976
 *   （主 Agent 运行中输入 `/btw …` 时出现「发送旁路问题」按钮）、:2038-2042（worker 运行时同款按钮）、
 *   :1494-1527（`/btw` 先被 handleCommand 接管再分流发送）、:1262-1268（各车道的父路径）。
 *   `hooks/use-side-questions.ts:120-149`（历史每 2 秒刷新、运行中的问答可取消）、:194-218（清空历史）。
 * DSH 无，按输入区扩展（DSH 的 `ui-conversation` 输入 facade 没有旁路提问通道）。
 * 对照表行：P1:D12
 */
import * as React from "react";

import type { SideExchange, SideHistoryState, SideQuestionChannel } from "@/v2/data/side-questions";
import { mutateSideQuestions } from "@/v2/data/side-questions";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";

import css from "./SideQuestions.module.css";

/** 历史行状态的中文与色调。 */
const STATUS: Record<
  SideExchange["status"],
  {
    readonly label: string;
    readonly tone: "outline" | "solid" | "neutral" | "quiet" | "success" | "info" | "warning" | "danger";
  }
> = {
  running: { label: "回答中", tone: "info" },
  completed: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
  interrupted: { label: "已中断", tone: "warning" },
};

/**
 * 一条旁路问答的时间。
 * @param value - 后端 `created_at`。
 * @returns `M/D HH:mm`；解析不了时返回原串。
 */
function stampOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 渲染旁路问题历史与操作。
 * @param props.open - 面板是否打开。
 * @param props.taskId - 当前任务 id。
 * @param props.channel - 提问通道（决定历史接口与取消路径）。
 * @param props.history - 历史数据：加载中/失败/空/有数据四态。
 * @param props.live - 历史是否需要每 2 秒刷新（有正在回答的条目时）。
 * @param props.onClose - 关闭面板。
 * @returns 旁路问题对话框。
 */
export function SideQuestionsPanel({
  open,
  taskId,
  channel,
  history,
  onClose,
}: {
  readonly open: boolean;
  readonly taskId: string;
  readonly channel: SideQuestionChannel;
  readonly history: SideHistoryState;
  readonly onClose: () => void;
}): React.ReactNode {
  /** 进行中的清除/取消动作 id，避免连点。 */
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // 换任务或换车道后，上一次的失败提示不该留在新会话上。
  React.useEffect(() => {
    setActionError(null);
    setBusyId(null);
  }, [taskId, channel]);

  const runAction = (id: string, action: () => Promise<string | null>): void => {
    setBusyId(id);
    setActionError(null);
    action()
      .then((failure) => {
        if (failure !== null) setActionError(failure);
      })
      .finally(() => {
        setBusyId(null);
        history.reload();
      });
  };

  const running = history.items.find((item) => item.status === "running") ?? null;
  const loading = history.phase === "loading";

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel="关闭"
      title="旁路问题"
      description="给正在运行的会话提一条追问，不打断它当前的工作。"
      footer={
        <>
          <Button
            variant="outline"
            disabled={busyId !== null || loading || history.items.length === 0}
            onClick={() => runAction("clear", () => mutateSideQuestions(taskId, channel, "clear"))}
          >
            清空历史
          </Button>
          <Button variant="primary" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {loading ? (
        <div className={css.state} role="status">
          加载中…
        </div>
      ) : history.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          读取失败：{history.error}
          <Button variant="outline" size="sm" onClick={history.reload}>
            重试
          </Button>
        </div>
      ) : history.items.length === 0 ? (
        <div className={css.state}>暂无旁路问题。在输入区用 /btw 提问。</div>
      ) : (
        <ul className={css.list}>
          {history.items.map((item) => {
            const status = STATUS[item.status];
            return (
              <li key={item.id} className={css.row}>
                <div className={css.rowHead}>
                  <Tag tone={status.tone}>{status.label}</Tag>
                  <span className={css.time}>{stampOf(item.created_at)}</span>
                  {item.status === "running" ? (
                    <button
                      type="button"
                      className={css.linkBtn}
                      disabled={busyId !== null}
                      onClick={() =>
                        runAction(item.id, () => mutateSideQuestions(taskId, channel, "cancel", item.id))
                      }
                    >
                      取消
                    </button>
                  ) : null}
                </div>
                <div className={css.question}>{item.question}</div>
                {item.answer !== "" ? <div className={css.answer}>{item.answer}</div> : null}
                {item.error !== undefined && item.error !== "" ? (
                  <div className={css.rowError} role="alert">
                    {item.error}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {running !== null && busyId === null ? <div className={css.state}>正在回答：{running.question}</div> : null}
      {actionError !== null ? (
        <div className={css.stateError} role="alert">
          {actionError}
        </div>
      ) : null}
    </Modal>
  );
}
