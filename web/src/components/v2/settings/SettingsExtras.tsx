"use client";

/**
 * 设置弹窗的「零散项」：操作约束注入两个开关、从设置内快速新建任务、模型快捷切换条、
 * 更新完成后的重启等待与页面刷新、以及「关于 / 初始化状态」复检。
 * 旧页面依据：app/(main)/system/settings/page.tsx:428-454（操作约束注入）、
 *   components/settings/settings-dialog.tsx:243（设置内快速新建任务入口）、
 *   components/settings/settings-dialog.tsx:255-428（模型快捷切换 + 设为默认）、
 *   app/(main)/system/settings/_components/update-card.tsx:81-109（staged 后轮询 /health 再 location.reload()）、
 *   components/settings/settings-dialog.tsx:697-845（关于 / 初始化状态 + 重新检查）。
 * DSH 依据：DSH 无这几个设置项；按 ui-settings 自定义 section 扩展（总表 §4.3）。
 * 对照表行：P3:S11 P3:S12 P3:B4 P3:B7 P3:S4 P3:B6
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import { NewTaskDialog } from "../sidebar/NewTaskDialog";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import { SettingsRow } from "./SettingsRow";
import {
  CONSTRAINT_INJECT_KEYS,
  constraintInjectValue,
  probeAboutStatus,
  saveConstraintInject,
  waitForBackendRestart,
  type AboutProbe,
  type ConstraintInjectTarget,
  type SettingsState,
} from "@/v2/data/settings";
import { activateLlmProfile, useActiveLlm, type ProfilesState } from "@/v2/data/llm-profiles";
import type { UpdateState } from "@/v2/data/update";
import css from "./SettingsDialog.module.css";

/** 行容器来自 SettingsRow（C22 起与 SettingsDialog.tsx 共用同一份，不各写一份）。 */
const Row = SettingsRow;

/**
 * 开关行的四种状态：读取中 / 读取失败可重试 / 就绪且有值 / 保存中或保存失败。
 */
function ConstraintSwitchRow({
  target,
  server,
}: {
  target: ConstraintInjectTarget;
  server: SettingsState;
}): React.ReactNode {
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const label = target === "planner" ? "注入规划者（planner）" : "注入执行者（worker）";
  const value = constraintInjectValue(server.data, target);
  const key = CONSTRAINT_INJECT_KEYS[target];

  const save = (next: boolean): void => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    // 不乐观更新：写成功后用后端返回的整份 Settings 回读（总表 §5.3）。
    void saveConstraintInject(target, next)
      .then(() => {
        server.reload();
        toast(next ? `${label}已开启` : `${label}已关闭`);
      })
      .catch((reason: unknown) => {
        setFailure(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setSaving(false));
  };

  // 读取失败：行还在，但不画一个值未知的开关，只给原因与重试。
  const control =
    server.phase === "loading" ? (
      <span className={css.rowHint} data-field={`${key}-state`}>
        读取中…
      </span>
    ) : value === null ? (
      <span className={css.inlineRow} data-field={`${key}-state`}>
        <span className={css.serverError}>读取失败{server.error === null ? "" : `：${server.error}`}</span>
        <Button variant="outline" size="sm" onClick={server.reload}>
          重试
        </Button>
      </span>
    ) : (
      <span className={css.inlineRow}>
        <span className={css.rowHint} data-field={key}>
          {value ? "已开启" : "已关闭"}
        </span>
        <Switch
          checked={value}
          disabled={saving}
          label={label}
          onChange={(next) => save(next)}
        />
      </span>
    );

  return (
    <Row
      label={label}
      hint={
        target === "planner"
          ? "把任务总览「操作约束」里的 allow / deny 条目拼进规划者的系统提示；默认开启，切换即时生效（下一轮读取）。"
          : "把同一份操作约束拼进执行者的系统提示；默认开启，关闭后执行者不再看到约束。"
      }
    >
      <div className={css.inlineRow}>
        {control}
        {saving ? <Tag tone="neutral">保存中…</Tag> : null}
      </div>
      {failure !== null ? <div className={css.serverError}>保存失败：{failure}</div> : null}
    </Row>
  );
}

/**
 * 「操作约束注入」分区（P3:S11 planner / P3:S12 worker）。
 * @param server - 通用页已经持有的 settings 状态（同一份读取，不重复请求）。
 */
export function ConstraintInjectSection({ server }: { server: SettingsState }): React.ReactNode {
  return (
    <div className={css.subSection} data-field="constraint-inject">
      <div className={css.subSectionTitle}>操作约束注入</div>
      <div className={css.rowHint}>
        开启后，把每个任务的「操作约束」（在任务总览「操作约束」里维护的 allow / deny 条目）拼进对应 Agent
        的系统提示，用来框定探索边界（如「仅测当前端口」「禁止爆破」）。可分别控制注入到规划者与执行者；默认都开。
      </div>
      <ConstraintSwitchRow target="planner" server={server} />
      <ConstraintSwitchRow target="worker" server={server} />
    </div>
  );
}

/**
 * 设置内的「新建任务」入口（P3:B4）。
 * 复用侧栏的新建任务弹窗（A05，`components/v2/sidebar/NewTaskDialog.tsx`，调 api.createTask
 * api.ts:281-310），不另写一份表单；创建成功后提示任务编号并刷新任务列表（调用方给的回调）。
 * @param onCreated - 创建成功后收到新任务 id。
 */
export function NewTaskRow({ onCreated }: { onCreated?: (id: string) => void }): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<string | null>(null);
  return (
    <>
      <Row label="新建任务" hint="与侧栏「新建任务」同一个表单：描述、目标、模型、分类、工作目录、覆盖度">
        <Button
          variant="outline"
          size="sm"
          icon={<IconPlusOutlineRegular size={12} />}
          data-newtask-open=""
          onClick={() => setOpen(true)}
        >
          新建任务
        </Button>
      </Row>
      {created === null ? null : (
        <div className={css.rowHint} data-field="newtask-created">
          已创建任务：{created}
        </div>
      )}
      <NewTaskDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(id) => {
          setCreated(id);
          onCreated?.(id);
        }}
      />
    </>
  );
}

/**
 * 模型快捷切换条（P3:B7）。
 * 旧页 components/settings/settings-dialog.tsx:255-428：列出全部配置，当前默认的禁用「设为默认」，
 * 其余点一下走 `api.activateLLMProfile`（api.ts:1103）；这里同样的语义压成一行下拉 + 一个按钮，
 * 失败原因留在条内并可重试。
 * @param profiles - 调用方已持有的模型配置列表（模型页同一份读取）。
 * @param enabled - 是否显示（只在模型已读取成功时显示）。
 */
export function ModelQuickSwitch({ profiles }: { profiles: ProfilesState }): React.ReactNode {
  const [picked, setPicked] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const current = profiles.phase === "ready" ? profiles.profiles.find((item) => item.is_default) ?? null : null;
  const targetId = picked ?? current?.id ?? "";
  const target = profiles.profiles.find((item) => item.id === targetId) ?? null;
  const options = profiles.profiles.map((item) => ({
    value: item.id,
    label: item.is_default ? `${item.name}（当前生效）` : item.name,
  }));

  const activate = (): void => {
    if (target === null || busy || target.is_default) return;
    setBusy(true);
    setFailure(null);
    void activateLlmProfile(target.id)
      .then(() => {
        toast(`已将 ${target.name} 设为当前生效`);
        setPicked(null);
        // 回读：重新读 GET /llm/profiles，勾选状态以服务端为准。
        profiles.reload();
      })
      .catch((reason: unknown) => {
        setFailure(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusy(false));
  };

  // 四种状态：读取中 / 读取失败可重试 / 无配置 / 有配置。
  let body: React.ReactNode;
  if (profiles.phase === "loading") {
    body = (
      <div className={css.rowHint} data-field="model-quick-state">
        读取模型配置…
      </div>
    );
  } else if (profiles.phase === "offline") {
    body = (
      <div className={css.inlineRow} data-field="model-quick-state" role="alert">
        <span className={css.serverError}>读取失败{profiles.error === null ? "" : `：${profiles.error}`}</span>
        <Button variant="outline" size="sm" onClick={profiles.reload}>
          重试
        </Button>
      </div>
    );
  } else if (profiles.profiles.length === 0) {
    body = (
      <div className={css.rowHint} data-field="model-quick-empty">
        还没有配置模型：先在本页下方「添加模型提供商」新增一条。
      </div>
    );
  } else {
    const isCurrent = target !== null && target.is_default;
    const canSubmit = target !== null && !isCurrent;
    body = (
      <>
        <div className={css.rowHint}>
          当前生效：{current === null ? "未指定（按后端默认）" : `${current.name} · ${current.model}`}
        </div>
        <div className={css.inlineRow}>
          <SelectMenu ariaLabel="快速切换生效模型" value={targetId} options={options} onChange={setPicked} disabled={busy} />
          <Button
            variant="primary"
            size="sm"
            data-field="model-quick-activate"
            disabled={busy || !canSubmit}
            onClick={activate}
          >
            {busy ? "切换中…" : isCurrent ? "当前生效" : "设为当前生效"}
          </Button>
          {failure !== null ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={activate}>
              重试
            </Button>
          ) : null}
        </div>
        {failure === null ? null : <div className={css.serverError}>切换失败：{failure}</div>}
      </>
    );
  }

  return (
    <div className={css.subSection} data-field="model-quick-switch">
      <div className={css.subSectionTitle}>快速切换生效模型</div>
      {body}
    </div>
  );
}

/**
 * 更新阶段的中文名。取值严格照 `UpdateProgress.phase`（lib/types.ts:1674）：
 * `idle | downloading | verifying | extracting | staged | failed`，不臆造后端没有的阶段。
 */
const UPDATE_PHASE_LABEL: Record<string, string> = {
  idle: "空闲",
  downloading: "下载中",
  verifying: "校验中",
  extracting: "解压并冒烟测试",
  staged: "已就绪，等待重启",
  failed: "失败",
};

function updatePhaseLabel(phase: string): string {
  return UPDATE_PHASE_LABEL[phase] ?? phase;
}

/**
 * 更新完成后的「等待后端重启 → 刷新页面」。
 * 旧页 update-card.tsx:81-109 在 SSE 收到 staged 后轮询 /api/health 等版本变化再 location.reload()。
 * 这里同样是真实轮询：每次探测都真发 GET /health（api.ts:268），读通才让用户刷新；
 * 不给按钮自动触发，也不伪造进度。
 * @param update - 通用页已持有的更新状态（同一个 SSE 订阅，不重复开流）。
 */
export function UpdateRestartRow({ update }: { update: UpdateState }): React.ReactNode {
  const phase = update.progress?.phase ?? null;
  // 后端阶段只有 staged 表示「新版本已就绪、等重启」（lib/types.ts:1674），
  // 没有 restarting / applied 这类终态，所以只认 staged 这一种「该刷新了」的信号。
  const ready = phase === "staged";
  const [waiting, setWaiting] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const waitRestart = (): void => {
    setWaiting(true);
    setFailure(null);
    setResult(null);
    const before = update.host?.version ?? "";
    void waitForBackendRestart({ before }, () => !alive.current)
      .then((outcome) => {
        if (!alive.current) return;
        if (outcome.outcome === "restarted") {
          setResult(
            `后端已重新响应（版本 ${outcome.version ?? "未知"}${outcome.version === before ? "，与重启前相同：可能回滚或本次未换版本" : "，与重启前不同：新版本已接管"}），共探测 ${outcome.probes} 次。点「刷新页面」加载新前端资源。`,
          );
          return;
        }
        if (outcome.outcome === "timeout") {
          setFailure(`等待超时：${outcome.probes} 次探测都没有连上后端，请检查服务是否已停止，然后点「重新检查」。`);
        }
      })
      .finally(() => {
        if (alive.current) setWaiting(false);
      });
  };

  return (
    <>
      <Row
        label="更新完成后"
        hint="后端换装重启后，自动等待 GET /health 重新连上，再让你刷新页面（不会自动重载你正在看的页面）"
      >
        <div className={css.inlineRow}>
          <span className={css.rowHint} data-field="update-phase">
            {phase === null ? "未收到更新进度" : updatePhaseLabel(phase)}
          </span>
          <Button
            variant="outline"
            size="sm"
            data-field="wait-restart"
            disabled={!ready || waiting}
            title={ready ? "轮询 GET /health 直到后端重新响应" : "只在更新进入「已就绪，等待重启」后可用"}
            onClick={waitRestart}
          >
            {waiting ? "等待后端重启…" : "等待重启"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-field="reload-page"
            disabled={!ready || waiting}
            onClick={() => window.location.reload()}
          >
            刷新页面
          </Button>
        </div>
      </Row>
      {result === null ? null : (
        <div className={css.rowHint} data-field="wait-restart-result">
          {result}
        </div>
      )}
      {failure === null ? null : <div className={css.serverError}>{failure}</div>}
    </>
  );
}

/** 一次复检的时间戳文案（与旧页 clockLabel 一致：24 小时制本地时间）。 */
function clockLabel(at: Date): string {
  return at.toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * 「初始化状态」复检（P3:B6 的补充部分）。
 * `UpdateSection.tsx:187-198` 已经展示登录方式与检查时间（来自 /auth/status + /health），
 * 这里补旧页 AboutSection 的「重新检查」：重新读一次两个接口，把失败原因与最后一次成功的时间都留在页面上。
 */
export function AboutRecheckSection(): React.ReactNode {
  // P3:B6：关于区补「模型」与「品牌」两行。模型读 `GET /llm` 的激活配置
  // （`/llm/profiles` 不返回激活态），没有配置就如实显示「未配置」。
  const activeLlm = useActiveLlm();
  const [probe, setProbe] = React.useState<AboutProbe | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = (): void => {
    setBusy(true);
    void probeAboutStatus()
      .then((next) => {
        if (!alive.current) return;
        setProbe(next);
        setCheckedAt(clockLabel(new Date()));
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  };

  return (
    <div className={css.subSection} data-field="about-recheck">
      <div className={css.subSectionTitle}>初始化状态</div>
      {/* P3:B6：品牌行与「模型」行（模型读 active=true 的真实配置）。 */}
      <div className={css.rowHint} data-field="about-brand">
        单机版 harness · /v2 前端（DSH 骨架）
      </div>
      <div className={css.rowHint} data-field="about-model">
        {activeLlm.phase === "loading"
          ? "读取模型配置…"
          : activeLlm.phase === "offline"
            ? `模型配置读取失败（${activeLlm.error ?? "未知原因"}）`
            : activeLlm.llm === null || activeLlm.llm.configured === false
              ? "当前模型：未配置"
              : `当前模型：${activeLlm.llm.provider} · ${activeLlm.llm.model}`}
      </div>
      <div className={css.rowHint}>
        重新读一次 GET /auth/status 与 GET /health，确认登录方式与后端版本。
      </div>
      <div className={css.inlineRow}>
        <Button variant="outline" size="sm" disabled={busy} onClick={run} icon={<IconRefreshOutlineRegular size={12} />}>
          {busy ? "检查中…" : "重新检查"}
        </Button>
        <span className={css.rowHint} data-field="about-checked-at">
          {checkedAt === null ? "尚未检查" : `检查时间 ${checkedAt}`}
        </span>
      </div>
      {probe === null ? null : probe.error !== null ? (
        <div className={css.serverError} role="alert" data-field="about-error">
          重新检查失败：{probe.error}
        </div>
      ) : (
        <div className={css.rowHint} data-field="about-result">
          {probe.authDisabled === true ? "已关闭密码登录（本机直连）" : "需要密码登录"}
          {probe.initialized === true ? " · 已初始化" : " · 未初始化"}
          {` · 后端版本 ${probe.version ?? "未知"}${probe.service === null ? "" : `（${probe.service}）`}`}
        </div>
      )}
    </div>
  );
}

/**
 * 通用页右侧的「模型快速切换」折叠条：模型列表只在展开时才渲染，
 * 避免通用页一打开就多拉一次 /llm/profiles（用户不点就只显示当前生效名）。
 * @param profiles - 模型页同一份读取结果。
 */
export function ModelQuickSwitchBox({ profiles }: { profiles: ProfilesState }): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const live = profiles.phase === "ready";
  const current = live ? profiles.profiles.find((item) => item.is_default) ?? null : null;
  return (
    <>
      <Row
        label="模型"
        hint={
          profiles.phase === "loading"
            ? "读取模型配置…"
            : profiles.phase === "offline"
              ? "模型配置读取失败（未连接后端）"
              : current === null
                ? "未指定生效模型（按后端默认）"
                : `当前生效：${current.name} · ${current.model}`
        }
      >
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          disabled={!live}
          title={live ? "展开模型快捷切换" : "模型配置还没读取成功"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
          {open ? "收起快捷切换" : "快捷切换"}
        </Button>
      </Row>
      {open ? <ModelQuickSwitch profiles={profiles} /> : null}
    </>
  );
}
