"use client";

/**
 * 插话栈（W-2）：输入区上方对运行中会话的问答条目。
 *
 * DSH 的 `queue/QueueDock.tsx` 是排队消息的栈；插话（steer）在本仓库由旁路问答通道
 * 承载，所以这里是**问答栈**：一条问题一行，回答中显示实时态（由历史 2s 轮询喂，
 * SSE 归 Phase-2 内联），终态后答案就地展开——不会再被关进弹窗。取消走
 * `POST /side-questions/{id}/cancel`。旧页这条历史拉出来后是一整块面板
 * （`SideQuestionsPanel`，W-2 退役）；DSH 里 steer 消息内联进正文流（`records.ts:91`
 * `kind:'steering'`），那是 Phase-2 的形态。
 * 样式与 `SideQuestionNotice` 共用 `SideQuestions.module.css`。
 */
import * as React from "react";

import { IconCloseOutlineRegular, IconQuestionOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { SideExchange, SideHistoryState } from "@/v2/data/side-questions";

import css from "./SideQuestions.module.css";

/** 终态在右侧的动作文案与语气色（running 不在这张表里，见行渲染）。 */
const DONE_LABEL: Record<Exclude<SideExchange["status"], "running">, string> = {
  completed: "已回答",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

/**
 * 渲染插话问答栈。
 * @param props.history - 当前车道的历史（`useSideHistory`，2s 轮询含实时态）。
 * @param props.onCancel - 取消一条回答中的问答；返回是否成功。
 * @returns 栈；空历史时为 null。
 */
export function SteeringDock({
  history,
  onCancel,
}: {
  readonly history: SideHistoryState;
  readonly onCancel: (id: string) => Promise<boolean>;
}): React.ReactNode {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // 只有一条时答案默认展开（用户刚问完就想看）；多条时最新一条默认展开。
  const items = history.items;
  React.useEffect(() => {
    if (items.length === 0) return;
    setOpenId((current) => current ?? (items.length === 1 ? (items[0]?.id ?? null) : (items[items.length - 1]?.id ?? null)));
  }, [items]);

  if (items.length === 0 && history.phase !== "loading") return null;

  const runningId = items.find((item) => item.status === "running")?.id ?? null;

  return (
    <div className={css.dock} data-steer-dock="" data-steer-count={items.length}>
      {history.phase === "loading" && items.length === 0 ? (
        <div className={css.dockHint} role="status">
          读取插话…
        </div>
      ) : null}
      {history.phase === "offline" ? (
        <div className={css.dockError} role="alert">
          读取插话失败：{history.error ?? "未知原因"}
        </div>
      ) : null}
      {items.map((item) => {
        const isRunning = item.status === "running";
        const expandable = !isRunning && item.answer !== "";
        const open = openId === item.id;
        return (
          <div key={item.id} className={css.dockRow} data-steer-item={item.id} data-steer-status={item.status}>
            <span className={css.dockLead} aria-hidden="true">
              <IconQuestionOutlineRegular size={14} />
            </span>
            <button
              type="button"
              className={css.steerToggle}
              aria-expanded={expandable ? open : undefined}
              disabled={!expandable}
              title={expandable ? (open ? "收起答案" : "展开答案") : undefined}
              onClick={() => {
                if (!expandable) return;
                setOpenId((current) => (current === item.id ? null : item.id));
              }}
            >
              <span className={css.steerQ} title={item.question}>
                {item.question}
              </span>
              <span
                className={isRunning ? css.steerRunning : css.dockState}
                role={isRunning ? "status" : undefined}
              >
                {isRunning ? "回答中…" : DONE_LABEL[item.status]}
              </span>
            </button>
            {isRunning ? (
              <button
                type="button"
                className={css.steerCancel}
                aria-label="取消这条插话"
                title="取消这条插话"
                disabled={busyId !== null}
                onClick={() => {
                  setBusyId(item.id);
                  void onCancel(item.id).finally(() => setBusyId(null));
                }}
              >
                <IconCloseOutlineRegular size={13} />
              </button>
            ) : null}
            {open && item.answer !== "" ? <p className={css.steerA}>{item.answer}</p> : null}
            {!isRunning && item.error !== undefined && item.error !== "" ? (
              <p className={css.dockError} role="alert">
                {item.error}
              </p>
            ) : null}
          </div>
        );
      })}
      {/* 键盘可达：栈本身不是一个整体控件，行按钮与取消按钮各自可达即可；这行只是
          给屏幕阅读器一个运行态的存在感。 */}
      {runningId !== null ? <span className={css.dockLive} aria-hidden="true" /> : null}
    </div>
  );
}
