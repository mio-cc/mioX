"use client";

/**
 * Settings dialog: pages laid out like the live DSH settings modal —
 * 188px nav rail, label+hint rows separated by hairlines, provider summary
 * rows above a settings card, and the full provider editor inside it.
 */
import * as React from "react";

import { isAuthDisabled } from "@/lib/auth";
import type { LLMProfile } from "@/lib/types";
import { probeAuthMode } from "@/v2/data/auth";
import { resetLlmPoolMember, useLlmPool } from "@/v2/data/llm-pool";
import {
  activateLlmProfile,
  deleteLlmProfile,
  formatContextWindow,
  formatMaxTokens,
  parseContextWindow,
  parseMaxTokens,
  saveLlmProfile,
  testLlmConnection,
  useLlmProfiles,
} from "@/v2/data/llm-profiles";
import { useSettings } from "@/v2/data/settings";
import { useUpdate } from "@/v2/data/update";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconAgentPresetOutlineRegular,
  IconCloseOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconGaugeOutlineRegular,
  IconLayersOutlineRegular,
  IconMailUnreadOutlineRegular,
  IconPlusOutlineRegular,
  IconQueueOutlineRegular,
  IconRefreshOutlineRegular,
  IconSettingsOutlineRegular,
  IconShieldOutlineRegular,
  IconSlidersTwoOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  AddSlot,
  AddSlots,
  Badge,
  Card,
  Chain,
  ChainAdd,
  ChainArrow,
  ChainStep,
  Disclosure,
  Dot,
  Editor,
  EditorActions,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  FilterBar,
  kit,
  Meta,
  Notice,
  PageHead,
  Row as KitRow,
  Section,
  SettingsPage as KitSettingsPage,
  Skeleton,
  TextInput,
} from "@/components/v2/design/Kit";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";

// 修改密码弹窗由 P3-B13 交付（components/v2/auth/ChangePasswordDialog.tsx）；
// 本单元（B14）只在通用页加入口与挂载。
import { ChangePasswordDialog } from "../auth/ChangePasswordDialog";
import { ToolsPage } from "../tools/ToolsPage";
import { AgentPresetsPage } from "./AgentPresetsPage";
import { InterceptPage } from "./InterceptRulesPage";
import { LlmRetrySection } from "./LlmRetrySection";
import { McpPage } from "./McpPage";
import {
  extraDraftFromProfile,
  ModelProfileExtraFields,
  maxTokensFieldToStore,
  type ProfileExtraDraft,
  thinkingToStore,
} from "./ModelProfileFields";
import { ModelIdField } from "./ModelIdField";
import { ModelsAddProvider } from "./ModelsAddProvider";
import { NotifyPage } from "./NotifyPage";
import { RuntimeSection } from "./RuntimeSection";
import { SelectMenu } from "./SelectMenu";
import css from "./SettingsDialog.module.css";
import {
  AboutRecheckSection,
  ConstraintInjectSection,
  ModelQuickSwitchBox,
  NewTaskRow,
  UpdateRestartRow,
} from "./SettingsExtras";
import { SettingsRow } from "./SettingsRow";
import { SkillsPage } from "./SkillsPage";
import { TaskCategorySettings } from "./TaskCategorySettings";
import { toast } from "./Toast";
import { UpdateSection, UpdateSectionView } from "./UpdateSection";

const PAGES = [
  { id: "general", label: "通用设置", Icon: IconSettingsOutlineRegular },
  { id: "models", label: "模型", Icon: IconLayersOutlineRegular },
  { id: "llm", label: "LLM 池", Icon: IconQueueOutlineRegular },
  { id: "runtime", label: "运行时", Icon: IconGaugeOutlineRegular },
  { id: "intercept", label: "拦截规则", Icon: IconShieldOutlineRegular },
  { id: "notify", label: "通知推送", Icon: IconMailUnreadOutlineRegular },
  { id: "plugins", label: "内置插件", Icon: IconCordisPluginOutlineRegular },
  { id: "presets", label: "Agent 预设", Icon: IconAgentPresetOutlineRegular },
  { id: "tools", label: "工具", Icon: IconSlidersTwoOutlineRegular },
  { id: "mcp", label: "MCP", Icon: IconCordisPluginOutlineRegular },
  { id: "skills", label: "技能", Icon: IconLayersOutlineRegular },
] as const;

type PageId = (typeof PAGES)[number]["id"];

/** 设置分节 id，供外壳指定初始分节（B14：「插件」行 → mcp，更新徽标 → general）。 */
export type SettingsSectionId = PageId;

/** 行容器（C22 起抽到 SettingsRow.tsx，通用页与本单元新增分区共用同一份）。 */
const Row = SettingsRow;

function SettingsPage(): React.ReactNode {
  // 一个页面只开一次 GET /settings：通用页原有分区与 C11 的「任务并发」分区共用这份状态。
  const server = useSettings();
  return (
    <KitSettingsPage data={{ "data-settings-general": "" }}>
      <GeneralContent server={server} />
      <OtherSettingsPage server={server} />
    </KitSettingsPage>
  );
}

/**
 * 通用设置页内容（原本就是这个组件，C22 起由 SettingsPage 包一层，
 * 因为 C22 要在同一页末尾追加「模型」与「关于」两组零散项）。
 * C11 起 `server` 由 SettingsPage 持有并传下来，本节不再自己开一次 GET /settings。
 */
function GeneralContent({ server }: { server: ReturnType<typeof useSettings> }): React.ReactNode {
  const [appearance, setAppearance] = React.useState("system");
  const [codeView, setCodeView] = React.useState(true);
  const [language, setLanguage] = React.useState("zh");
  const [stepDetail, setStepDetail] = React.useState("detailed");
  const [collapseTiming, setCollapseTiming] = React.useState("after-answer");
  const [keptReplies, setKeptReplies] = React.useState("all");

  return (
    <>
      <PageHead title="通用设置" lead="服务端开关、Agent 约束、版本更新与界面偏好。" />
      <ServerStatusRow server={server} />

      <Section title="服务端">
        <Card>
          <ServerSwitches server={server} />
        </Card>
      </Section>

      <ConstraintInjectSection server={server} />

      <Section title="版本">
        <UpdateSectionWithRestart />
      </Section>

      <Section title="账户与任务">
        <Card>
          <ChangePasswordRow />
          <NewTaskRow />
        </Card>
      </Section>

      <PermissionLevelsNote />

      <Section title="界面">
        <Card>
          <KitRow label="外观" description="浅色、深色，或跟随系统设置。">
            <FilterBar
              id="appearance"
              label="外观"
              value={appearance}
              onChange={setAppearance}
              options={[
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
                { value: "system", label: "跟随系统" },
              ]}
            />
          </KitRow>
          <KitRow label="语言">
            <SelectMenu
              value={language}
              onChange={setLanguage}
              ariaLabel="语言"
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
            />
          </KitRow>
          <KitRow label="字号大小" description="仅影响会话内容的字号。">
            <span className={css.numberField}>
              14<span className={css.unit}>px</span>
            </span>
          </KitRow>
        </Card>
      </Section>

      <Section title="会话">
        <Card>
          <KitRow label="工作步骤展示" description="希望看到多少工具调用细节。">
            <SelectMenu
              value={stepDetail}
              onChange={setStepDetail}
              ariaLabel="工作步骤展示"
              options={[
                { value: "detailed", label: "详细" },
                { value: "compact", label: "精简" },
                { value: "hidden", label: "隐藏" },
              ]}
            />
          </KitRow>
          <KitRow label="工作步骤收起时机" description="何时自动收起工作步骤。">
            <SelectMenu
              value={collapseTiming}
              onChange={setCollapseTiming}
              ariaLabel="工作步骤收起时机"
              options={[
                { value: "after-answer", label: "回答结束后" },
                { value: "turn-end", label: "每轮结束" },
                { value: "never", label: "从不" },
              ]}
            />
          </KitRow>
          <KitRow label="收起后显示的回复" description="工作步骤收起后保留哪些助手回复。">
            <SelectMenu
              value={keptReplies}
              onChange={setKeptReplies}
              ariaLabel="收起后显示的回复"
              options={[
                { value: "all", label: "全部回复" },
                { value: "final", label: "仅最终回复" },
              ]}
            />
          </KitRow>
          <KitRow label="显示代码工作视图" description="显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换。">
            <Switch checked={codeView} onChange={setCodeView} label="显示代码工作视图" />
          </KitRow>
          <KitRow label="快捷键" description="查看和编辑当前可用的快捷键和输入操作。">
            <Button variant="outline" size="sm" onClick={() => toast("快捷键编辑器：Ctrl+Alt+N 新建会话，Ctrl+, 打开设置")}>
              编辑快捷键
            </Button>
          </KitRow>
        </Card>
      </Section>
    </>
  );
}

/**
 * 更新卡片 + 重启等待行（P3:S4）。
 * `UpdateSection` 与这一行必须共用同一个 `useUpdate()` 订阅（同一个 SSE 流），
 * 所以两者放在同一个包装组件里，而不是各自开一次 UPDATE 流。
 */
function UpdateSectionWithRestart(): React.ReactNode {
  const update = useUpdate();
  return (
    <>
      <UpdateSectionView update={update} />
      <UpdateRestartRow update={update} />
    </>
  );
}

/** 通用页末尾的「模型快捷切换」与「初始化状态」两组（P3:B7 / P3:B6）。 */
function OtherSettingsPage({ server }: { server: ReturnType<typeof useSettings> }): React.ReactNode {
  const profiles = useLlmProfiles();
  return (
    <>
      <ModelQuickSwitchBox profiles={profiles} />
      <AboutRecheckSection />
      <TaskCategorySettings server={server} />
    </>
  );
}

/**
 * 权限档是任务级命令，后端没有「全局默认权限档」字段（旧设置页
 * components/settings/settings-dialog.tsx:444-470 的 D10-T4 结论相同）。
 * 会话内切换由 composer 权限 chip 承载：Composer.tsx:77-82 四档 →
 * Composer.tsx:654-679 chip → Shell.tsx:592-595 → v2/data/task-actions.ts:90-91
 * 调 PATCH /tasks/{id}/permission-level。这里只做说明，不放会误导的假开关。
 */
const PERMISSION_LEVELS = [
  { value: "auto", label: "自动", desc: "规则 + LLM 裁决（默认）" },
  { value: "read-only", label: "仅可查看", desc: "状态变更工具全部拒绝" },
  { value: "workspace-write", label: "工作区内修改", desc: "工作区可写，全局副作用工具拒绝" },
  { value: "danger-full", label: "完全权限", desc: "不拦截（不可逆操作仍要人工确认）" },
] as const;

/** Tone per permission level: the dot reads as how much the level lets through. */
const PERMISSION_TONE: Record<(typeof PERMISSION_LEVELS)[number]["value"], "info" | "success" | "warning" | "danger"> = {
  auto: "info",
  "read-only": "success",
  "workspace-write": "warning",
  "danger-full": "danger",
};

function PermissionLevelsNote(): React.ReactNode {
  return (
    <Section
      title="权限档"
      hint="任务级命令，没有全局默认：在会话输入框的「权限」里切换，下一轮生效"
      data={{ "data-field": "permission-levels" }}
    >
      <Card>
        <div role="list" aria-label="权限档说明">
          {PERMISSION_LEVELS.map((level) => (
            <KitRow
              key={level.value}
              lead={<Dot tone={PERMISSION_TONE[level.value]} />}
              label={level.label}
              description={level.desc}
              data={{ "data-permission-level": level.value }}
            >
              <span className={`${kit.mono} ${css.permValue}`}>{level.value}</span>
            </KitRow>
          ))}
        </div>
      </Card>
      <p className={css.sectionFoot}>显式拦截规则始终优先于档位预设。</p>
    </Section>
  );
}

/**
 * 通用页的「修改密码」入口（P3:C4 / B14）。
 *
 * 只在非免登录模式显示——判定口径与旧页 nav-user.tsx:82 一致：先读 `lib/auth.ts`
 * 的模块开关 `isAuthDisabled()`（由 authStatus 写入），拿不到结论时再经
 * `v2/data/auth.ts` 的 `probeAuthMode()` 真问一次 `/auth/status`；两者都不确定就
 * 按「隐藏」处理，绝不因为读取失败而画出一个后端用不上的按钮。
 * 旧页面依据：app/(main)/_components/sidebar/change-password-dialog.tsx:22-123（弹窗本体，B13）、
 *   nav-user.tsx:82（`!isAuthDisabled()` 才显示「修改密码」）。
 * 对照表行：P3:C4。
 */
function ChangePasswordRow(): React.ReactNode {
  // `null` = 还没拿到结论（本机免登录时不显示，所以先不画行以免布局跳动）。
  const [enabled, setEnabled] = React.useState<boolean | null>(() => (isAuthDisabled() ? false : null));
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (enabled !== null) return;
    let alive = true;
    void probeAuthMode().then((probe) => {
      if (!alive) return;
      // probeAuthMode 成功时已把 authStatus 写进 lib/auth 的开关，这里直接复用同一口径。
      setEnabled(probe.status === null ? false : !isAuthDisabled());
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (enabled !== true) return null;

  return (
    <>
      <KitRow label="修改密码" description="本机登录口令；修改后已签发的登录 token 仍有效直至过期。">
        <Button variant="outline" size="sm" data-change-password-open="" onClick={() => setOpen(true)}>
          修改密码
        </Button>
      </KitRow>
      <ChangePasswordDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PlaceholderPage({ title }: { title: string }): React.ReactNode {
  return (
    <>
      <h2 className={css.pageTitle}>{title}</h2>
      <p className={css.pageLead}>此页在 lab 中尚未实现。</p>
    </>
  );
}

export function SettingsDialog({
  open,
  onClose,
  initialSection,
}: {
  open: boolean;
  onClose: () => void;
  /** 首次渲染/重新打开时分节；外壳的「插件」行用它直接进 MCP。 */
  initialSection?: SettingsSectionId;
}): React.ReactNode {
  const [page, setPage] = React.useState<PageId>(initialSection ?? "models");
  // 每次重新打开都回到调用方指定的分节（同一个弹窗实例会被侧栏反复打开）。
  React.useEffect(() => {
    if (!open) return;
    setPage(initialSection ?? "models");
  }, [open, initialSection]);

  return (
    <Modal open={open} onClose={onClose} title="设置" headless className={css.dialog}>
      <div className={css.frame}>
        <header className={css.header}>
          <h2 className={css.dialogTitle}>设置</h2>
          <div className={css.headerActions}>
            <Button variant="outline" size="sm" onClick={() => toast("配置文件：data/config.json（已复制路径）")}>
              打开配置文件
            </Button>
            <button type="button" className={css.closeBtn} aria-label="关闭" onClick={onClose}>
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
        </header>
        <div className={css.body}>
          <nav className={css.nav}>
            {PAGES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`${css.navItem} ${page === id ? css.navActive : ""}`}
                onClick={() => setPage(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className={css.panel}>
            {page === "general" ? <SettingsPage /> : null}
            {page === "models" ? <ModelsPage /> : null}
            {page === "llm" ? <LlmPoolPage /> : null}
            {page === "runtime" ? <RuntimePage /> : null}
            {page === "intercept" ? <InterceptPage /> : null}
            {page === "notify" ? <NotifyPage /> : null}
            {page === "plugins" ? (
              <NotWiredPage title="内置插件" reason="后端暂未提供插件清单接口（/api/plugin* 路由不存在，已全量核查）" />
            ) : null}
            {page === "presets" ? <AgentPresetsPage /> : null}
            {page === "tools" ? <ToolsPage /> : null}
            {page === "mcp" ? <McpPage /> : null}
            {page === "skills" ? <SkillsPage /> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Proof of the data path: reads the real settings endpoint and reports the phase. */
function ServerStatusRow({ server }: { server: ReturnType<typeof useSettings> }): React.ReactNode {
  const label = server.phase === "loading" ? "读取中…" : server.phase === "ready" ? "已连接" : "未连接（后端不可达）";
  const tone = server.phase === "ready" ? "success" : server.phase === "loading" ? "neutral" : "danger";
  return (
    <div className={css.serverStrip} data-server-status={server.phase}>
      <Dot tone={tone} pulse={server.phase === "loading"} />
      <span className={css.serverStripLabel}>服务端 {label}</span>
      {server.data !== null ? (
        <Meta
          className={css.serverStripMeta}
          items={[
            `流量采集 ${server.data.traffic_capture ? "开" : "关"}`,
            `LLM 录制 ${server.data.llm_record ? "开" : "关"}`,
            `搜索 ${server.data.web_search_backend}`,
          ]}
        />
      ) : null}
      {server.error !== null ? <span className={css.serverError}>{server.error}</span> : null}
      <button type="button" className={css.serverRetry} onClick={server.reload}>
        重新读取
      </button>
    </div>
  );
}

/**
 * Three runtime toggles backed by the real settings endpoint. The switch shows
 * the server value and writes back through the adapter; a failed write leaves
 * the row unchanged and surfaces the error inline.
 */
function ServerSwitches({ server }: { server: ReturnType<typeof useSettings> }): React.ReactNode {
  const [failure, setFailure] = React.useState<string | null>(null);

  const rows: { key: "traffic_capture" | "agent_traffic_binding" | "llm_record"; label: string; hint: string }[] = [
    { key: "traffic_capture", label: "流量采集", hint: "抓取并落库经过代理的请求" },
    { key: "agent_traffic_binding", label: "Agent 自动绑定流量证据", hint: "不影响人工绑定" },
    { key: "llm_record", label: "LLM 录制", hint: "记录每次模型调用的请求与响应" },
  ];

  return (
    <>
      {rows.map((row) => {
        const value = server.data === null ? false : server.data[row.key] === true;
        return (
          <KitRow key={row.key} label={row.label} description={row.hint} data={{ "data-server-switch": row.key }}>
            <Switch
              checked={value}
              disabled={server.data === null}
              label={row.label}
              onChange={(next) => {
                void server.save({ [row.key]: next } as Partial<import("@/lib/types").Settings>).then((error) => {
                  setFailure(error);
                });
              }}
            />
          </KitRow>
        );
      })}
      {failure !== null ? (
        <div className={css.cardNotice}>
          <Notice tone="danger">保存失败：{failure}</Notice>
        </div>
      ) : null}
    </>
  );
}

/** Shown instead of controls whose backend does not exist yet. */
function NotWiredPage({ title, reason }: { title: string; reason: string }): React.ReactNode {
  return (
    <KitSettingsPage data={{ "data-settings-not-wired": "" }}>
      <PageHead title={title} />
      <Card>
        <Empty
          inCard
          icon={<IconCordisPluginOutlineRegular size={18} />}
          title="尚未接入后端"
          text={`此页暂不渲染任何控件，避免出现无效开关。${reason}。`}
        />
      </Card>
    </KitSettingsPage>
  );
}

/** 模型：真实 LLM profile 列表；每条可展开为编辑器，写入只在显式点击时发生。 */
function ModelsPage(): React.ReactNode {
  const profiles = useLlmProfiles();
  const [adding, setAdding] = React.useState(false);
  const [preset, setPreset] = React.useState(false);
  if (adding) {
    return (
      <ModelsAddProvider
        preset={preset}
        onCreated={() => {
          setAdding(false);
          setPreset(false);
          profiles.reload();
        }}
        onCancel={() => {
          setAdding(false);
          setPreset(false);
        }}
      />
    );
  }
  const active = profiles.profiles.find((profile) => profile.is_default);
  return (
    <KitSettingsPage data={{ "data-settings-models": "" }}>
      <PageHead
        title="模型"
        lead={
          profiles.phase === "ready"
            ? `${profiles.profiles.length} 个模型配置${active === undefined ? "" : `，当前生效：${active.name}`}。展开一项即可编辑连接、推理等级与重试。`
            : "管理模型提供商与连接。"
        }
      />
      {profiles.phase === "loading" ? (
        <Card>
          <Skeleton label="读取模型配置" />
        </Card>
      ) : null}
      {profiles.phase === "offline" ? (
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={profiles.reload}>重试</Button>}>
          未连接后端（读不到模型配置）
        </Notice>
      ) : null}
      {profiles.phase === "ready" ? (
        <Section title="提供商" count={profiles.profiles.length}>
          {profiles.profiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} onSaved={profiles.reload} />
          ))}
          <AddSlots>
            <AddSlot
              data={{ "data-models-add": "custom" }}
              onClick={() => {
                setPreset(false);
                setAdding(true);
              }}
            >
              <IconPlusOutlineRegular size={13} /> 添加模型提供商
            </AddSlot>
            <AddSlot
              data={{ "data-models-add": "opencode" }}
              onClick={() => {
                setPreset(true);
                setAdding(true);
              }}
            >
              <IconPlusOutlineRegular size={13} /> OpenCode 公开免费
            </AddSlot>
          </AddSlots>
        </Section>
      ) : null}
    </KitSettingsPage>
  );
}

const PROFILE_FORMATS = [
  { value: "openai", label: "OpenAI Chat Completions" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "openai-responses", label: "OpenAI Responses" },
] as const;

const REASONING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;

/** Display labels for the stored reasoning-effort values (stored values stay the wire strings). */
const REASONING_LEVEL_LABEL: Record<(typeof REASONING_LEVELS)[number], string> = {
  off: "关闭",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/**
 * One configured profile: a summary row that expands into its editor.
 * 设为当前生效 switches the globally active model, so it is a separate button
 * that is disabled for the profile already in effect.
 */
function ProfileCard({ profile, onSaved }: { profile: LLMProfile; onSaved: () => void }): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const activate = (): void => {
    if (busy || profile.is_default) return;
    setBusy(true);
    setFailure(null);
    void activateLlmProfile(profile.id)
      .then(() => {
        toast(`已将 ${profile.name} 设为当前生效`);
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const formatLabel = PROFILE_FORMATS.find((item) => item.value === profile.format)?.label ?? profile.format;
  return (
    <Card selected={open} data={{ "data-model-profile": String(profile.id) }}>
      <KitRow
        lead={<ProviderGlyph name={profile.name} />}
        label={profile.name}
        labelAdornment={
          profile.is_default ? (
            <Badge tone="success">
              <Dot tone="success" />
              当前生效
            </Badge>
          ) : null
        }
        description={
          <Meta
            items={[
              <span key="model" className={kit.mono}>
                {profile.model}
              </span>,
              formatLabel,
              profile.base_url === undefined || profile.base_url === "" ? null : (
                <span key="url" className={kit.mono} title={profile.base_url}>
                  {hostOf(profile.base_url)}
                </span>
              ),
            ]}
          />
        }
      >
        {profile.is_default ? null : (
          <Button variant="ghost" size="sm" aria-label="设为当前生效" disabled={busy} onClick={activate}>
            设为生效
          </Button>
        )}
        <Button
          variant={open ? "ghost" : "outline"}
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "收起" : "编辑"}
        </Button>
      </KitRow>
      {failure === null ? null : (
        <div className={css.cardNotice}>
          <Notice tone="danger">切换失败：{failure}</Notice>
        </div>
      )}
      {open ? <ProfileEditor profile={profile} onSaved={onSaved} /> : null}
    </Card>
  );
}

/** Host part of an API base URL for the compact summary line. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Not an absolute URL (relative or malformed): show it as typed.
    return url;
  }
}

/** Monogram tile for a provider row: first letter of the profile name. */
function ProviderGlyph({ name }: { name: string }): React.ReactNode {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className={css.providerGlyph} aria-hidden="true">
      {letter}
    </span>
  );
}

/** The values an editor draft is compared against (one snapshot per profile). */
function editorBaseline(profile: LLMProfile): {
  name: string;
  baseUrl: string;
  format: string;
  model: string;
  contextWindow: string;
  maxTokens: string;
  levels: string[];
  extra: ProfileExtraDraft;
} {
  return {
    name: profile.name,
    baseUrl: profile.base_url ?? "",
    format: profile.format,
    model: profile.model,
    contextWindow: formatContextWindow(profile.context_window_k),
    maxTokens: formatMaxTokens(profile.max_tokens),
    levels: [...(profile.reasoning_efforts ?? [])],
    extra: extraDraftFromProfile(profile),
  };
}

/**
 * Provider/model editor backed by GET/POST/DELETE /llm/profiles, plus the
 * 测试连接 probe. Draft state stays local; 保存 stays disabled while the draft
 * equals the stored profile, so an untouched editor cannot write.
 */
function ProfileEditor({ profile, onSaved }: { profile: LLMProfile; onSaved: () => void }): React.ReactNode {
  const uid = React.useId();
  const baseline = React.useMemo(() => editorBaseline(profile), [profile]);
  const [name, setName] = React.useState(baseline.name);
  const [baseUrl, setBaseUrl] = React.useState(baseline.baseUrl);
  const [format, setFormat] = React.useState<string>(baseline.format);
  const [model, setModel] = React.useState(baseline.model);
  const [apiKey, setApiKey] = React.useState("");
  const [contextWindow, setContextWindow] = React.useState(baseline.contextWindow);
  const [maxTokens, setMaxTokens] = React.useState(baseline.maxTokens);
  const [levels, setLevels] = React.useState<string[]>(baseline.levels);
  const [extra, setExtra] = React.useState<ProfileExtraDraft>(baseline.extra);
  const [advanced, setAdvanced] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [probing, setProbing] = React.useState(false);
  const [probe, setProbe] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const fail = (reason: unknown): void => setFailure(reason instanceof Error ? reason.message : String(reason));

  const busy = saving || probing;
  const dirty =
    name !== baseline.name ||
    format !== baseline.format ||
    baseUrl !== baseline.baseUrl ||
    model !== baseline.model ||
    apiKey !== "" ||
    contextWindow !== baseline.contextWindow ||
    maxTokens !== baseline.maxTokens ||
    levels.join(",") !== baseline.levels.join(",") ||
    JSON.stringify(extra) !== JSON.stringify(baseline.extra);

  /** Drop every edit: the draft returns to the stored values. */
  const revert = (): void => {
    setName(baseline.name);
    setBaseUrl(baseline.baseUrl);
    setFormat(baseline.format);
    setModel(baseline.model);
    setApiKey("");
    setContextWindow(baseline.contextWindow);
    setMaxTokens(baseline.maxTokens);
    setLevels([...baseline.levels]);
    setExtra(editorBaseline(profile).extra);
    setFailure(null);
    setProbe(null);
  };

  /** POST /llm/test: one real round trip, sends the key to the endpoint. */
  const test = (): void => {
    if (model.trim() === "") {
      setFailure("模型 ID 不能为空。");
      return;
    }
    setProbing(true);
    setFailure(null);
    setProbe(null);
    void testLlmConnection({
      provider: format,
      model: model.trim(),
      baseUrl: baseUrl.trim(),
      apiKey,
      proxy: extra.proxy,
      thinkingType: thinkingToStore(extra.thinkingType),
      reasoningEffort: profile.reasoning_effort ?? "",
      profileId: Number(profile.id),
      streaming: extra.streaming,
      sessionHeaderKey: extra.sessionHeaderKey.trim(),
    })
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error ?? "端点没有返回内容");
          return;
        }
        const latency = result.latencyMs === undefined ? "?" : String(result.latencyMs);
        setProbe(`${result.model ?? model.trim()} · ${latency}ms · ${result.reply ?? ""}`.trim());
      })
      .catch(fail)
      .finally(() => setProbing(false));
  };

  const save = (): void => {
    if (name.trim() === "") {
      setFailure("Provider ID 不能为空。");
      return;
    }
    if (model.trim() === "") {
      setFailure("模型 ID 不能为空。");
      return;
    }
    const windowK = parseContextWindow(contextWindow);
    if (contextWindow.trim() !== "" && windowK === null) {
      setFailure("上下文窗口必须是正数，例如 131072、256K 或 1M。");
      return;
    }
    const tokens = parseMaxTokens(maxTokens);
    if (maxTokens.trim() !== "" && tokens === null) {
      setFailure("最大输出 token 数必须是正数，例如 8192、64K 或 1M。");
      return;
    }
    if (levels.length === 1 && levels[0] === "off") {
      setFailure("至少添加一个 Off 以外的档位；不需要思考请关闭推理等级。");
      return;
    }
    setSaving(true);
    setFailure(null);
    void saveLlmProfile({
      id: Number(profile.id),
      name: name.trim(),
      format,
      model: model.trim(),
      base_url: baseUrl.trim(),
      proxy: extra.proxy.trim(),
      api_key: apiKey,
      rate_per_second: Math.max(0, extra.ratePerSecond),
      rate_per_minute: Math.max(0, extra.ratePerMinute),
      context_window_k: windowK ?? 0,
      thinking_type: thinkingToStore(extra.thinkingType),
      reasoning_effort: profile.reasoning_effort,
      reasoning_efforts: levels,
      priority: extra.priority,
      pool_exclude: extra.poolExclude,
      streaming: extra.streaming,
      max_tokens: tokens ?? 0,
      max_tokens_field: maxTokensFieldToStore(extra.maxTokensField),
      session_header_key: extra.sessionHeaderKey.trim(),
      retry: extra.retry,
    })
      .then(() => {
        // A stored key is never echoed back; drop the typed value after saving.
        setApiKey("");
        toast("模型配置已保存");
        onSaved();
      })
      .catch(fail)
      .finally(() => setSaving(false));
  };

  const remove = (): void => {
    setSaving(true);
    setFailure(null);
    void deleteLlmProfile(profile.id)
      .then(() => {
        toast("已删除模型");
        onSaved();
      })
      .catch(fail)
      .finally(() => setSaving(false));
  };

  const levelOptions = REASONING_LEVELS.map((level) => ({ value: level, label: REASONING_LEVEL_LABEL[level] }));

  return (
    <Editor inCard data={{ "data-model-editor": String(profile.id) }}>
      <EditorGroup title="连接">
        <FieldGrid>
          <Field
            label="Provider ID"
            htmlFor={`${uid}-provider`}
            hint="唯一标识，只用于区分配置，不写入模型请求。"
          >
            <TextInput
              id={`${uid}-provider`}
              value={name}
              placeholder="acme-gateway"
              aria-label="Provider ID"
              disabled={saving}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <Field label="API 协议" htmlFor={`${uid}-format`}>
            <SelectMenu
              id={`${uid}-format`}
              value={format}
              onChange={setFormat}
              options={PROFILE_FORMATS}
              disabled={saving}
            />
          </Field>
          <Field label="API 地址" htmlFor={`${uid}-base-url`} span>
            <TextInput
              id={`${uid}-base-url`}
              mono
              value={baseUrl}
              placeholder="https://gateway.example/v1"
              aria-label="API 地址"
              disabled={saving}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
            />
          </Field>
          <Field
            label="API 密钥"
            htmlFor={`${uid}-key`}
            span
            hint={profile.api_key_hint ? `已存储：${profile.api_key_hint}；留空则保持不变。` : "未存储密钥（keyless 端点可留空）。"}
          >
            <TextInput
              id={`${uid}-key`}
              mono
              type="password"
              autoComplete="new-password"
              value={apiKey}
              placeholder="留空则保持已存储的密钥"
              aria-label="API 密钥"
              disabled={saving}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </Field>
          <Field
            label="模型"
            htmlFor={`${uid}-model-id`}
            span
            hint="「获取模型」向该端点请求可用列表（Key 留空时用已存的 Key）；也可直接输入目录外的模型 ID。"
          >
            <ModelIdField
              id={`${uid}-model-id`}
              value={model}
              onChange={setModel}
              format={format}
              baseUrl={baseUrl}
              apiKey={apiKey}
              proxy={extra.proxy}
              profileId={Number(profile.id)}
              disabled={saving}
            />
          </Field>
        </FieldGrid>
      </EditorGroup>

      <EditorGroup>
        <Disclosure
          open={advanced}
          onToggle={() => setAdvanced((value) => !value)}
          label="高级设置"
          hint="上下文 · 推理等级 · 代理 · 限速 · 重试"
        >
          高级设置
        </Disclosure>

        {advanced ? (
          <>
            <FieldGrid>
              <Field label="上下文窗口" htmlFor={`${uid}-context`} hint="如 131072、256K、1M">
                <TextInput
                  id={`${uid}-context`}
                  value={contextWindow}
                  placeholder="1M"
                  aria-label="上下文窗口"
                  disabled={saving}
                  onChange={(event) => setContextWindow(event.currentTarget.value)}
                />
              </Field>
              <Field label="最大输出 token" htmlFor={`${uid}-max-tokens`} hint="如 8192、64K">
                <TextInput
                  id={`${uid}-max-tokens`}
                  value={maxTokens}
                  placeholder="128K"
                  aria-label="最大输出 token 数"
                  disabled={saving}
                  onChange={(event) => setMaxTokens(event.currentTarget.value)}
                />
              </Field>
            </FieldGrid>

            <Field
              label="推理等级"
              hint="从左到右依次尝试，前一档失败时切到下一档；至少保留一个关闭以外的档位。"
            >
              <Chain label="推理等级失败切换顺序">
                {levels.length === 0 ? <span className={css.chainEmpty}>未设置，按模型默认</span> : null}
                {levels.map((level, index) => (
                  <React.Fragment key={`${level}-${String(index)}`}>
                    {index > 0 ? <ChainArrow /> : null}
                    <ChainStep index={index + 1} data={{ "data-reasoning-level": level }}>
                      <SelectMenu
                        value={level}
                        onChange={(next) => setLevels((prev) => prev.map((item, i) => (i === index ? next : item)))}
                        options={levelOptions}
                        disabled={saving}
                        className={css.chainSelect}
                        ariaLabel={`第 ${String(index + 1)} 档推理等级`}
                      />
                      <button
                        type="button"
                        className={css.chainRemove}
                        aria-label="删除档位"
                        title="删除档位"
                        disabled={saving}
                        onClick={() => setLevels((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <IconCloseOutlineRegular size={10} />
                      </button>
                    </ChainStep>
                  </React.Fragment>
                ))}
                <ChainAdd disabled={saving} onClick={() => setLevels((prev) => [...prev, "off"])}>
                  <IconPlusOutlineRegular size={12} /> 添加档位
                </ChainAdd>
              </Chain>
            </Field>

            <ModelProfileExtraFields
              value={extra}
              onChange={(patch) => setExtra((prev) => ({ ...prev, ...patch }))}
              disabled={busy}
              format={format}
              uid={uid}
            />
          </>
        ) : null}
      </EditorGroup>

      {failure === null ? null : <Notice tone="danger">操作失败：{failure}</Notice>}
      {probe === null ? null : (
        <Notice tone="success" data={{ "data-model-probe": "ok" }}>
          连通：{probe}
        </Notice>
      )}

      <EditorActions
        start={
          <button type="button" className={css.dangerBtn} aria-label="删除模型" disabled={saving} onClick={remove}>
            删除模型
          </button>
        }
      >
        <Button variant="ghost" size="sm" aria-label="撤销改动" disabled={busy || !dirty} onClick={revert}>
          撤销改动
        </Button>
        <Button variant="outline" size="sm" aria-label="测试连接" disabled={busy} onClick={test}>
          {probing ? "测试中…" : "测试连接"}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>
          保存
        </Button>
      </EditorActions>
    </Editor>
  );
}

/**
 * Writable text setting backed by the settings endpoint. The field starts from
 * the server value and writes back through the adapter; a failed write keeps the
 * draft and reports the error inline.
 */
function TextSettingBlock({
  label,
  hint,
  placeholder,
  value,
  disabled,
  secret,
  clearOnSuccess,
  apply,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  secret?: boolean;
  clearOnSuccess?: boolean;
  apply: (next: string) => Promise<string | null>;
}): React.ReactNode {
  const [draft, setDraft] = React.useState(value);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Adopt a new server value (first read, reload, or a write that changed it).
  React.useEffect(() => {
    setDraft(value);
  }, [value]);
  const locked = disabled === true || saving;
  return (
    <KitRow label={label} description={failure === null ? hint : <span className={css.inlineError}>保存失败：{failure}</span>} stacked>
      <div className={css.inlineSave}>
        <TextInput
          mono
          type={secret === true ? "password" : "text"}
          autoComplete={secret === true ? "new-password" : "off"}
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          disabled={locked}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={locked || draft === "" || draft === value}
          onClick={() => {
            setSaving(true);
            setFailure(null);
            void apply(draft)
              .then((error) => {
                if (error !== null) {
                  setFailure(error);
                  return;
                }
                // A stored secret is never echoed back; drop the typed value.
                if (clearOnSuccess === true) setDraft("");
                toast(`${label}已保存`);
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </KitRow>
  );
}

/** 运行时：GET /settings 的真实字段；新增项走暂存表单，代理与 Key 沿用就地写回。 */
function RuntimePage(): React.ReactNode {
  const server = useSettings();
  const head = <PageHead title="运行时" lead="任务并发、网络出口、搜索与解释器。改动经「保存修改」一次写回。" />;
  if (server.phase === "loading") {
    return (
      <KitSettingsPage>
        {head}
        <Card>
          <Skeleton label="读取运行时设置" />
        </Card>
      </KitSettingsPage>
    );
  }
  if (server.phase === "offline") {
    return (
      <KitSettingsPage>
        {head}
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={server.reload}>重试</Button>}>
          未连接后端（读不到运行时设置）
        </Notice>
      </KitSettingsPage>
    );
  }
  const backend = server.data?.web_search_backend ?? "";
  const braveConfigured = server.data?.brave_key_set === true;
  const concurrencyOn = server.data?.task_concurrency_enabled === true;
  return (
    <KitSettingsPage data={{ "data-settings-runtime": "" }}>
      {head}
      <Section title="任务并发" hint="只读，来自服务端配置">
        <Card>
          <KitRow label="任务并发" description="同一时间允许多个任务并行运行。">
            <span className={css.poolState}>
              <Dot tone={concurrencyOn ? "success" : "neutral"} />
              {concurrencyOn ? "开启" : "关闭"}
            </span>
          </KitRow>
          <KitRow label="并发上限" description="同时运行的任务数上限。">
            <span className={`${css.poolState} ${kit.numeric}`}>{String(server.data?.task_concurrency_limit ?? "—")}</span>
          </KitRow>
        </Card>
      </Section>
      <Section title="网络出口">
        <Card>
          <TextSettingBlock
            label="全局代理"
            hint="所有 Agent 的目标流量经此代理出网（http / https / socks5，可带 user:pass）；留空直连。"
            placeholder="socks5://user:pass@host:1080"
            value={server.data?.global_proxy ?? ""}
            apply={(next) => server.save({ global_proxy: next })}
          />
          <TextSettingBlock
            label="Brave Search API Key"
            hint={`免费额度约 2,000 次/月；当前搜索来源 ${backend === "" ? "未知" : backend} · ${braveConfigured ? "Key 已配置（不回显）" : "Key 未配置"}。`}
            placeholder="输入 Brave API Key"
            value=""
            secret
            clearOnSuccess
            apply={(next) => server.save({ brave_search_api_key: next })}
          />
        </Card>
      </Section>
      <RuntimeSection server={server} />
    </KitSettingsPage>
  );
}

/** LLM 池：故障转移链的真实状态 + 开关。 */
function LlmPoolPage(): React.ReactNode {
  const pool = useLlmPool();
  const server = useSettings();
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (pool.phase === "loading" || server.phase === "loading") {
    return (
      <KitSettingsPage>
        <PageHead title="LLM 池" lead="故障转移链与熔断状态。" />
        <Card>
          <Skeleton label="读取池状态" />
        </Card>
      </KitSettingsPage>
    );
  }
  if (pool.phase === "offline" || server.phase === "offline") {
    return (
      <KitSettingsPage>
        <PageHead title="LLM 池" lead="故障转移链与熔断状态。" />
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={() => { pool.reload(); server.reload(); }}>重试</Button>}>
          未连接后端（读不到池状态）
        </Notice>
      </KitSettingsPage>
    );
  }
  const data = server.data as unknown as Record<string, unknown>;
  const enabled = data["llm_pool_enabled"] === true;
  const bindFallback = data["llm_pool_bind_fallback"] === true;

  const save = (patch: Record<string, boolean>): void => {
    setSaving(Object.keys(patch)[0] ?? null);
    setError(null);
    server
      .save(patch as never)
      .then(() => {
        server.reload();
        pool.reload();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(null));
  };

  const reset = (profileId: string): void => {
    setError(null);
    void resetLlmPoolMember(profileId)
      .then(() => {
        pool.reload();
        server.reload();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  /** Clear every breaker at once (backend: reset with no id = 全部清除). */
  const resetAll = (): void => {
    setError(null);
    void resetLlmPoolMember()
      .then(() => {
        pool.reload();
        server.reload();
        toast("已清除全部熔断");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  const chain = pool.pool?.chain ?? [];
  const tripped = chain.filter((link) => link.state !== "ok").length;
  return (
    <KitSettingsPage data={{ "data-settings-llm-pool": "" }}>
      <PageHead
        title="LLM 池"
        lead="前一个模型失败时按链路顺序自动切到下一个；熔断的成员可以手动立即恢复。"
        adornment={
          <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "已启用" : "未启用"}</Badge>
        }
      />

      <Section title="策略">
        <Card>
          <KitRow label="启用故障转移池" description="链路里前一个模型失败时自动切到下一个。">
            <Switch
              checked={enabled}
              disabled={saving !== null}
              onChange={(next) => save({ llm_pool_enabled: next })}
              label="启用故障转移池"
            />
          </KitRow>
          <KitRow label="绑定回退配置" description="切换到回退模型时保持同一 profile 上下文。">
            <Switch
              checked={bindFallback}
              disabled={saving !== null}
              onChange={(next) => save({ llm_pool_bind_fallback: next })}
              label="绑定回退配置"
            />
          </KitRow>
        </Card>
      </Section>

      <Section
        title="故障转移链"
        count={chain.length}
        hint={tripped > 0 ? `${String(tripped)} 个成员处于熔断` : "全部正常"}
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            disabled={tripped === 0}
            onClick={resetAll}
          >
            全部恢复
          </Button>
        }
      >
        <Card>
          {chain.length === 0 ? (
            <Empty inCard title="链路为空" text="在 设置 → 模型 里添加提供商后，它们会按优先级进入这条链。" />
          ) : (
            chain.map((link, index) => {
              const ok = link.state === "ok";
              return (
                <KitRow
                  key={link.profile_id}
                  data={{ "data-pool-link": String(link.profile_id) }}
                  lead={
                    <span className={link.active ? `${css.poolStep} ${css.poolStepActive}` : css.poolStep} aria-hidden="true">
                      {index + 1}
                    </span>
                  }
                  label={link.name}
                  labelAdornment={
                    <>
                      {link.active ? <Badge tone="info">当前</Badge> : null}
                      {link.excluded ? <Badge>已排除</Badge> : null}
                    </>
                  }
                  description={
                    <Meta
                      items={[
                        <span key="m" className={kit.mono}>
                          {link.model}
                        </span>,
                        link.format,
                        `优先级 ${String(link.priority)}`,
                      ]}
                    />
                  }
                >
                  <span className={css.poolState}>
                    <Dot tone={ok ? "success" : "danger"} />
                    {ok ? "正常" : link.state}
                    {link.fails > 0 ? <span className={css.poolFails}>失败 {link.fails}</span> : null}
                  </span>
                  <button
                    type="button"
                    className={css.iconBtnSmall}
                    aria-label="立即恢复"
                    title="立即恢复：清除熔断并让下一次调用立刻重试"
                    disabled={ok}
                    onClick={() => reset(link.profile_id)}
                  >
                    <IconRefreshOutlineRegular size={13} />
                  </button>
                </KitRow>
              );
            })
          )}
        </Card>
        {error === null ? null : <Notice tone="danger">保存失败：{error}</Notice>}
      </Section>

      <LlmRetrySection />
    </KitSettingsPage>
  );
}
