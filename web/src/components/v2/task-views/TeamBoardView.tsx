"use client";

/**
 * 团队任务板（会话视图 tab「团队」，对照表 P1:C13–C15）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/team-tab.tsx:57-336
 * DSH 依据：DSH 无此页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2、ui-conversation/src/client/apply.ts:216,403）。
 *
 * 只渲染真实后端数据：读取 `GET /tasks/{id}/team`，写操作全部转发到 api。
 * 团队模式未开启的提示与旧页一致（team-tab.tsx:154-162：DSH TeamBoard.tsx:86 直接不渲染）。
 *
 * D2 版式：未开启 → 诚实空态（图标 + 标题 + 开启指引）。开启 → PageHead（进度摘要 + 新建 + 刷新）→
 * 进度指标格 → 按状态分组的看板卡（进行中 / 待处理 / 已完成），每条任务一行：状态点 + 标题 +
 * 元信息，点开展开说明、Facts（负责人 / 依赖 / 来源）与动作（主动作按钮 + ⋯ 菜单收纳派发 / 删除）。
 */
import { type ReactNode, useMemo, useState } from "react";

import type { Task, TeamTask } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import {
  Badge,
  Card,
  Dot,
  Empty,
  Facts,
  IconButton,
  type KitTone,
  kit,
  Meta,
  Metrics,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Menu, MenuItemButton } from "@/vendor/dsh/primitives/Menu";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  IconChevronDownOutlineRegular,
  IconEllipsisOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconUsersOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  claimTeamTask,
  completeTeamTask,
  createTeamTask,
  deleteTeamTask,
  dependencyText,
  dispatchTeamTask,
  progressLabel,
  teamStatusLabel,
  useTeamBoard,
} from "@/v2/data/team-board";

import css from "./TeamBoardView.module.css";

/** 一次待确认的危险操作：派发或删除。 */
type ConfirmAction = { kind: "dispatch" | "delete"; item: TeamTask } | null;

/** 看板分组：顺序即页面上的顺序。 */
const GROUPS: readonly { status: TeamTask["status"]; title: string }[] = [
  { status: "in_progress", title: "进行中" },
  { status: "pending", title: "待处理" },
  { status: "completed", title: "已完成" },
];

/**
 * 一条团队任务的状态点色调。
 * @param item - 团队任务。
 * @returns kit 色调。
 */
function itemTone(item: TeamTask): KitTone {
  if (item.status === "completed") return "success";
  if (item.status === "in_progress") return "info";
  if (item.status === "pending" && !item.ready) return "warning";
  return "neutral";
}

/**
 * 渲染团队任务板。
 * @param props.task - 当前选中的任务，由会话视图注册表传入。
 * @returns 团队任务板。
 */
export function TeamBoardView({ task }: { task: Task }): ReactNode {
  const board = useTeamBoard(task.id);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ subject: string; detail: string; dependsOn: number[] }>({
    subject: "",
    detail: "",
    dependsOn: [],
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const summary = progressLabel(board.progress);
  const openTasks = useMemo(() => board.tasks.filter((item) => item.status !== "completed"), [board.tasks]);
  const grouped = useMemo(() => {
    const known = new Set<string>(GROUPS.map((group) => group.status));
    const sections = GROUPS.map((group) => ({
      key: group.status as string,
      title: group.title,
      items: board.tasks.filter((item) => item.status === group.status),
    }));
    const other = board.tasks.filter((item) => !known.has(item.status));
    if (other.length > 0) sections.push({ key: "other", title: "其他", items: other });
    return sections.filter((section) => section.items.length > 0);
  }, [board.tasks]);

  /** 写操作统一包一层：置忙、失败提示、成功后重读。 */
  const runWrite = async (id: number, label: string, action: () => Promise<unknown>): Promise<void> => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await action();
      board.reload();
    } catch (reason: unknown) {
      toast(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusyId(null);
    }
  };

  const submitCreate = (): void => {
    const subject = form.subject.trim();
    if (subject === "" || creating) return;
    setCreating(true);
    setCreateError(null);
    createTeamTask(task.id, {
      subject,
      detail: form.detail.trim() === "" ? undefined : form.detail.trim(),
      dependsOn: form.dependsOn.length > 0 ? form.dependsOn : undefined,
    })
      .then(() => {
        setCreating(false);
        setCreateOpen(false);
        setForm({ subject: "", detail: "", dependsOn: [] });
        board.reload();
      })
      .catch((reason: unknown) => {
        setCreating(false);
        setCreateError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const toggleDepend = (id: number): void => {
    setForm((current) => ({
      ...current,
      dependsOn: current.dependsOn.includes(id)
        ? current.dependsOn.filter((value) => value !== id)
        : [...current.dependsOn, id],
    }));
  };

  const runConfirm = (): void => {
    if (confirm === null || confirmBusy) return;
    const { kind, item } = confirm;
    setConfirmBusy(true);
    const action = kind === "dispatch" ? () => dispatchTeamTask(item.id) : () => deleteTeamTask(item.id);
    action()
      .then(() => {
        setConfirmBusy(false);
        setConfirm(null);
        if (kind === "dispatch") toast("已派发，worker 会领取这条任务");
        board.reload();
      })
      .catch((reason: unknown) => {
        setConfirmBusy(false);
        setConfirm(null);
        toast(`${kind === "dispatch" ? "派发" : "删除"}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  if (task.team_mode !== true) {
    return (
      <Page data={{ "data-team-board": "off" }}>
        <PageHead title="团队" lead="多个 agent 共用的任务看板：拆分、认领、依赖与派发。" />
        <Card>
          <Empty
            icon={<IconUsersOutlineRegular size={18} />}
            title="团队模式未开启"
            text="在会话头部的模式菜单里打开「团队模式」，这个任务才会出现共享任务板；之后 planner 拆出的子任务与手动新建的任务都会汇总在这里。"
          />
        </Card>
      </Page>
    );
  }

  /**
   * 渲染一条团队任务（行 + 可展开详情）。
   * @param item - 团队任务。
   * @returns 列表项。
   */
  const renderItem = (item: TeamTask): ReactNode => {
    const blocked = item.status === "pending" && !item.ready;
    const open = expanded === item.id;
    const busy = busyId === item.id;
    const toggle = (): void => setExpanded(open ? null : item.id);
    const canDispatch = item.status === "pending" && item.source_intent_id === null;
    return (
      <div key={item.id} className={css.item} data-team-id={item.id} data-status={item.status}>
        <Row
          onClick={toggle}
          lead={<Dot tone={itemTone(item)} pulse={item.status === "in_progress"} />}
          label={<span title={item.subject}>{item.subject}</span>}
          labelAdornment={blocked ? <Badge tone="warning">被阻塞</Badge> : null}
          description={
            <Meta
              items={[
                <span key="id" className={kit.mono}>
                  #{item.id}
                </span>,
                item.owner === "" ? "未分配" : item.owner,
                item.depends_on.length > 0 ? `依赖 ${item.depends_on.length} 项` : null,
                item.source_intent_id === null ? "手动添加" : `来自意图 #${item.source_intent_id}`,
              ]}
            />
          }
        >
          <IconButton
            label={open ? "收起详情" : "展开详情"}
            aria-expanded={open}
            data-team-row-toggle=""
            className={css.chevron}
            data-open={open ? "true" : "false"}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            <IconChevronDownOutlineRegular size={14} />
          </IconButton>
        </Row>

        {open ? (
          <div className={css.body} data-team-row-detail="">
            <p className={item.detail === "" ? `${css.detail} ${css.detailEmpty}` : css.detail}>
              {item.detail === "" ? "没有补充说明。" : item.detail}
            </p>
            <div className={css.facts}>
              <Facts
                columns={3}
                items={[
                  { key: "owner", label: "负责人", value: item.owner === "" ? "未分配" : item.owner },
                  {
                    key: "deps",
                    label: "依赖",
                    value: item.depends_on.length > 0 ? dependencyText(item.depends_on, board.tasks) : "无",
                    wrap: true,
                  },
                  {
                    key: "source",
                    label: "来源",
                    value: item.source_intent_id === null ? "手动添加" : `意图 #${item.source_intent_id}`,
                  },
                ]}
              />
            </div>
            <div className={css.actions}>
              {item.status === "pending" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!item.ready || busy}
                  title={item.ready ? "认领这条任务" : "依赖未完成，暂不可认领"}
                  data-team-claim=""
                  onClick={() => {
                    void runWrite(item.id, "认领", () => claimTeamTask(item.id));
                  }}
                >
                  认领
                </Button>
              ) : null}
              {item.status !== "completed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  data-team-complete=""
                  onClick={() => {
                    void runWrite(item.id, "完成", () => completeTeamTask(item.id));
                  }}
                >
                  标记完成
                </Button>
              ) : null}
              <Menu
                open={menuFor === item.id}
                onClose={() => setMenuFor(null)}
                align="end"
                portal
                anchor={
                  <IconButton
                    label="更多操作"
                    aria-haspopup="menu"
                    aria-expanded={menuFor === item.id}
                    disabled={busy}
                    data-team-more=""
                    onClick={() => setMenuFor(menuFor === item.id ? null : item.id)}
                  >
                    <IconEllipsisOutlineRegular size={15} />
                  </IconButton>
                }
              >
                {canDispatch ? (
                  <MenuItemButton
                    data-team-dispatch=""
                    onSelect={() => {
                      setMenuFor(null);
                      setConfirm({ kind: "dispatch", item });
                    }}
                  >
                    派发给 worker…
                  </MenuItemButton>
                ) : null}
                <MenuItemButton
                  danger
                  separatorBefore={canDispatch}
                  data-team-delete=""
                  onSelect={() => {
                    setMenuFor(null);
                    setConfirm({ kind: "delete", item });
                  }}
                >
                  删除…
                </MenuItemButton>
              </Menu>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const progress = board.progress;

  return (
    <Page data={{ "data-team-board": "" }}>
      <PageHead
        title="团队"
        lead={
          <span data-team-summary="">
            {summary === "" ? "还没有团队任务" : summary}
            {progress.blocked > 0 ? <span className={css.blocked}>{`\u2002·\u2002${progress.blocked} 项被阻塞`}</span> : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              icon={<IconPlusOutlineRegular size={14} />}
              onClick={() => setCreateOpen(true)}
              data-team-create-open=""
            >
              新建团队任务
            </Button>
            <IconButton label="刷新" spinning={board.phase === "loading"} onClick={board.reload}>
              <IconRefreshOutlineRegular size={14} />
            </IconButton>
          </>
        }
      />

      {board.phase === "offline" ? (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={board.reload}>
              重试
            </Button>
          }
        >
          团队任务读取失败：{board.error}
        </Notice>
      ) : null}

      {board.phase === "loading" && board.tasks.length === 0 ? (
        <Card>
          <Skeleton label="加载团队任务" />
        </Card>
      ) : null}

      {board.phase === "ready" && board.tasks.length === 0 ? (
        <Card>
          <Empty
            icon={<IconUsersOutlineRegular size={18} />}
            title="团队任务板是空的"
            text="新建一条团队任务，或让 planner 拆解目标后自动写入。任务之间可以设置依赖，依赖完成后才能认领。"
            action={
              <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular size={14} />} onClick={() => setCreateOpen(true)}>
                新建团队任务
              </Button>
            }
          />
        </Card>
      ) : null}

      {board.tasks.length > 0 ? (
        <>
          <Section title="进度">
            <Metrics
              items={[
                { key: "total", label: "全部", value: progress.total },
                { key: "active", label: "进行中", value: progress.active, tone: "info", muted: progress.active === 0 },
                { key: "pending", label: "待处理", value: progress.pending, tone: "neutral", muted: progress.pending === 0 },
                {
                  key: "blocked",
                  label: "被阻塞",
                  value: progress.blocked,
                  tone: "warning",
                  muted: progress.blocked === 0,
                  foot: progress.blocked > 0 ? "等待依赖完成" : undefined,
                },
                {
                  key: "done",
                  label: "已完成",
                  value: progress.completed,
                  tone: "success",
                  muted: progress.completed === 0,
                  foot: progress.total > 0 ? `${Math.round((progress.completed / progress.total) * 100)}%` : undefined,
                },
              ]}
            />
          </Section>

          {grouped.map((group) => (
            <Section key={group.key} title={group.title} count={group.items.length}>
              <Card className={css.list}>{group.items.map(renderItem)}</Card>
            </Section>
          ))}
        </>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
        title="新建团队任务"
        closeLabel="关闭"
        description="这条任务只写进本任务的共享看板，不会自动派发。"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={creating}
              onClick={() => {
                setCreateOpen(false);
                setCreateError(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={creating || form.subject.trim() === ""}
              data-team-create-submit=""
              onClick={submitCreate}
            >
              {creating ? "创建中…" : "创建"}
            </Button>
          </>
        }
      >
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.fieldLabel}>标题</span>
            <Input
              value={form.subject}
              placeholder="要做什么"
              data-team-create-subject=""
              onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>说明（可选）</span>
            <textarea
              className={css.textarea}
              rows={3}
              value={form.detail}
              data-team-create-detail=""
              onChange={(event) => setForm((current) => ({ ...current, detail: event.target.value }))}
            />
          </label>
          {openTasks.length > 0 ? (
            <div className={css.field}>
              <span className={css.fieldLabel}>依赖（可选，勾选后要等这些任务完成）</span>
              <div className={css.dependList}>
                {openTasks.map((item) => (
                  <label key={item.id} className={css.dependRow}>
                    <input
                      type="checkbox"
                      checked={form.dependsOn.includes(item.id)}
                      data-team-create-depends={item.id}
                      onChange={() => toggleDepend(item.id)}
                    />
                    <span className={css.dependText}>
                      #{item.id} {item.subject}
                    </span>
                    <span className={css.dependState}>{teamStatusLabel(item.status)}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {createError !== null ? <Notice tone="danger">创建失败：{createError}</Notice> : null}
        </div>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        title={confirm?.kind === "dispatch" ? "确认派发" : "确认删除"}
        closeLabel="关闭"
        tone="warning"
        description={
          confirm?.kind === "dispatch"
            ? "派发后这条任务会变成意图，由 worker 领取执行，会消耗模型额度。"
            : "删除后这条团队任务不再出现在看板上，此操作不可撤销。"
        }
        footer={
          <>
            <Button variant="outline" size="sm" disabled={confirmBusy} onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={confirmBusy} data-team-confirm="" onClick={runConfirm}>
              {confirmBusy ? "处理中…" : confirm?.kind === "dispatch" ? "确认派发" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className={css.confirmText}>{confirm === null ? "" : confirm.item.subject}</p>
      </Modal>
    </Page>
  );
}
