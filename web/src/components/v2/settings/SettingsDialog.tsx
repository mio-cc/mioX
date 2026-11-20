"use client";

/**
 * Settings dialog: pages laid out like the live DSH settings modal —
 * 188px nav rail, label+hint rows separated by hairlines, provider summary
 * rows above a settings card, and the full provider editor inside it.
 */
import * as React from "react";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { SelectMenu } from "./SelectMenu";
import { LlmRetrySection } from "./LlmRetrySection";
import {
  ModelProfileExtraFields,
  extraDraftFromProfile,
  maxTokensFieldToStore,
  thinkingToStore,
  type ProfileExtraDraft,
} from "./ModelProfileFields";
import { ModelsAddProvider } from "./ModelsAddProvider";
import { InterceptPage } from "./InterceptRulesPage";
import { McpPage } from "./McpPage";
import { SkillsPage } from "./SkillsPage";
import { NotifyPage } from "./NotifyPage";
import { UpdateSection, UpdateSectionView } from "./UpdateSection";
import { RuntimeSection } from "./RuntimeSection";
import {
  AboutRecheckSection,
  ConstraintInjectSection,
  ModelQuickSwitchBox,
  NewTaskRow,
  UpdateRestartRow,
} from "./SettingsExtras";
import { SettingsRow } from "./SettingsRow";
import { TaskCategorySettings } from "./TaskCategorySettings";
import { AgentPresetsPage } from "./AgentPresetsPage";
import { ToolsPage } from "../tools/ToolsPage";
// 修改密码弹窗由 P3-B13 交付（components/v2/auth/ChangePasswordDialog.tsx）；
// 本单元（B14）只在通用页加入口与挂载。
import { ChangePasswordDialog } from "../auth/ChangePasswordDialog";
import { isAuthDisabled } from "@/lib/auth";
import { probeAuthMode } from "@/v2/data/auth";

import { toast } from "./Toast";
import {
  IconSettingsOutlineRegular,
  IconLayersOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconAgentPresetOutlineRegular,
  IconCloseOutlineRegular,
  IconGaugeOutlineRegular,
  IconShieldOutlineRegular,
  IconMailUnreadOutlineRegular,
  IconQueueOutlineRegular,
  IconRefreshOutlineRegular,
  IconSlidersTwoOutlineRegular,
  IconTrashOutlineRegular,
  IconPlusOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { LLMProfile } from "@/lib/types";
import { useSettings } from "@/v2/data/settings";
import {
  useLlmProfiles,
  saveLlmProfile,
  deleteLlmProfile,
  activateLlmProfile,
  testLlmConnection,
  formatContextWindow,
  parseContextWindow,
  formatMaxTokens,
  parseMaxTokens,
} from "@/v2/data/llm-profiles";
import { resetLlmPoolMember, useLlmPool } from "@/v2/data/llm-pool";
import { useUpdate } from "@/v2/data/update";
import css from "./SettingsDialog.module.css";

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
    <>
      <GeneralContent server={server} />
      <OtherSettingsPage server={server} />
    </>
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
      <h2 className={css.pageTitle}>通用设置</h2>
      <ServerStatusRow server={server} />
      <ServerSwitches server={server} />
      <ConstraintInjectSection server={server} />
      <UpdateSectionWithRestart />
      <ChangePasswordRow />
      <NewTaskRow />
      <PermissionLevelsNote />
      <Row label="语言">
        <SelectMenu
          value={language}
          onChange={setLanguage}
          options={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />
      </Row>

      <div className={css.group}>
        <div className={css.groupLabel}>外观</div>
        <SegmentedControl
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
      </div>

      <Row label="字号大小" hint="仅影响会话内容的字号">
        <span className={css.numberField}>14<span className={css.unit}>px</span></span>
      </Row>
      <Row label="工作步骤展示" hint="选择希望看到多少工具调用细节">
        <SelectMenu
          value={stepDetail}
          onChange={setStepDetail}
          options={[
            { value: "detailed", label: "详细" },
            { value: "compact", label: "精简" },
            { value: "hidden", label: "隐藏" },
          ]}
        />
      </Row>
      <Row label="工作步骤收起时机" hint="选择何时自动收起工作步骤">
        <SelectMenu
          value={collapseTiming}
          onChange={setCollapseTiming}
          options={[
            { value: "after-answer", label: "回答结束后" },
            { value: "turn-end", label: "每轮结束" },
            { value: "never", label: "从不" },
          ]}
        />
      </Row>
      <Row label="收起后显示的回复" hint="工作步骤收起后，保留哪些助手回复">
        <SelectMenu
          value={keptReplies}
          onChange={setKeptReplies}
          options={[
            { value: "all", label: "全部回复" },
            { value: "final", label: "仅最终回复" },
          ]}
        />
      </Row>
      <Row label="显示代码工作视图" hint="开启后，显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换">
        <Switch checked={codeView} onChange={setCodeView} label="显示代码工作视图" />
      </Row>
      <Row label="快捷键" hint="查看和编辑当前可用的快捷键和输入操作">
        <Button variant="outline" size="sm" onClick={() => toast("快捷键编辑器：Ctrl+Alt+N 新建会话，Ctrl+, 打开设置")}>编辑快捷键</Button>
      </Row>
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

function PermissionLevelsNote(): React.ReactNode {
  return (
    <div className={css.group} data-field="permission-levels">
      <div className={css.groupLabel}>权限档（任务级命令）</div>
      <div className={css.rowHint}>
        没有全局默认权限档：在任务对话输入框的「权限」chip 里切换本会话档位，下一轮生效。显式拦截规则始终优先于档位预设。
      </div>
      <div className={css.levelList} role="list" aria-label="权限档说明">
        {PERMISSION_LEVELS.map((level) => (
          <div className={css.levelRow} key={level.value} role="listitem" data-permission-level={level.value}>
            <span>{level.label}</span>
            <span className={css.rowHint}>{level.desc}</span>
            <span>{`（${level.value}）`}</span>
          </div>
        ))}
      </div>
    </div>
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
      <Row label="修改密码" hint="用于本机登录口令；修改后已签发的登录 token 仍有效直至过期">
        <Button variant="outline" size="sm" data-change-password-open="" onClick={() => setOpen(true)}>
          修改密码
        </Button>
      </Row>
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
            <Button variant="outline" size="sm" onClick={() => toast("配置文件：data/config.json（已复制路径）")}>打开配置文件</Button>
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
            {page === "plugins" ? <NotWiredPage title="内置插件" reason="插件清单接口尚未移植到 /v2" /> : null}
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
  const label =
    server.phase === "loading" ? "读取中…" : server.phase === "ready" ? "已连接" : "未连接（后端不可达）";
  return (
    <div className={css.serverRow}>
      <span className={css.serverLabel}>服务端设置</span>
      <span className={css.serverValue}>{label}</span>
      {server.data !== null ? (
        <span className={css.serverDetail}>
          流量采集 {server.data.traffic_capture ? "开" : "关"} · LLM 录制 {server.data.llm_record ? "开" : "关"} ·
          搜索 {server.data.web_search_backend}
        </span>
      ) : null}
      {server.error !== null ? <span className={css.serverError}>{server.error}</span> : null}
      <button type="button" className={css.serverRetry} onClick={server.reload}>重新读取</button>
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
          <Row key={row.key} label={row.label} hint={row.hint}>
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
          </Row>
        );
      })}
      {failure !== null ? <div className={css.serverError}>保存失败：{failure}</div> : null}
    </>
  );
}

/** Shown instead of controls whose backend does not exist yet. */
function NotWiredPage({ title, reason }: { title: string; reason: string }): React.ReactNode {
  return (
    <>
      <h2 className={css.pageTitle}>{title}</h2>
      <p className={css.pageLead}>此页尚未接入后端，因此不渲染任何控件。</p>
      <p className={css.pageLead}>{reason}</p>
    </>
  );
}

/** 模型：真实 LLM profile 列表；每条可展开为编辑器，写入只在显式点击时发生。 */
function ModelsPage(): React.ReactNode {
  const profiles = useLlmProfiles();
  const [adding, setAdding] = React.useState(false);
  const [preset, setPreset] = React.useState(false);
  if (profiles.phase === "loading") return <p className={css.pageLead}>读取模型配置…</p>;
  if (profiles.phase === "offline") return <p className={css.pageLead}>未连接后端（读不到模型配置）</p>;
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
  return (
    <>
      <h2 className={css.pageTitle}>模型</h2>
      <p className={css.pageLead}>来自 GET /llm/profiles，共 {profiles.profiles.length} 个配置。</p>
      {profiles.profiles.map((profile) => (
        <ProfileCard key={profile.id} profile={profile} onSaved={profiles.reload} />
      ))}
      <button
        type="button"
        className={css.addProvider}
        onClick={() => {
          setPreset(true);
          setAdding(true);
        }}
      >
        <IconPlusOutlineRegular size={13} /> OpenCode 公开免费
      </button>
      <button
        type="button"
        className={css.addProvider}
        onClick={() => {
          setPreset(false);
          setAdding(true);
        }}
      >
        <IconPlusOutlineRegular size={13} /> 添加模型提供商
      </button>
    </>
  );
}

const PROFILE_FORMATS = [
  { value: "openai", label: "OpenAI Chat Completions" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "openai-responses", label: "OpenAI Responses" },
] as const;

const REASONING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;

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

  return (
    <>
      <Row label={profile.name} hint={`${profile.format} · ${profile.base_url ?? ""}`}>
        <div className={css.inlineRow}>
          <span className={css.providerId}>{profile.model}</span>
          <Button
            variant="outline"
            size="sm"
            aria-label="设为当前生效"
            disabled={busy || profile.is_default}
            onClick={activate}
          >
            {profile.is_default ? "当前生效" : "设为当前生效"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "收起" : "编辑"}
          </Button>
        </div>
      </Row>
      {failure === null ? null : <p className={css.serverError}>切换失败：{failure}</p>}
      {open ? <ProfileEditor profile={profile} onSaved={onSaved} /> : null}
    </>
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

  const levelOptions = REASONING_LEVELS.map((level) => ({ value: level, label: level }));

  return (
    <div className={css.modelCard}>
      <div className={css.providerHead}>
        <span className={css.providerName}>{profile.name}</span>
        <span className={css.providerId}>{profile.model}</span>
      </div>

      <label className={css.fieldLabel} htmlFor={`${uid}-provider`}>Provider ID</label>
      <input
        id={`${uid}-provider`}
        className={css.textField}
        value={name}
        placeholder="acme-gateway"
        aria-label="Provider ID"
        disabled={saving}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <p className={css.fieldHint}>该配置的唯一标识（不能与已有配置同名）；只用于区分配置，不写入模型请求。</p>

      <label className={css.fieldLabel} htmlFor={`${uid}-base-url`}>API 地址</label>
      <input
        id={`${uid}-base-url`}
        className={css.textField}
        value={baseUrl}
        placeholder="https://gateway.example/v1"
        aria-label="API 地址"
        disabled={saving}
        onChange={(event) => setBaseUrl(event.currentTarget.value)}
      />

      <label className={css.fieldLabel} htmlFor={`${uid}-format`}>API 协议</label>
      <SelectMenu id={`${uid}-format`} value={format} onChange={setFormat} options={PROFILE_FORMATS} disabled={saving} />

      <label className={css.fieldLabel} htmlFor={`${uid}-key`}>API 密钥</label>
      <input
        id={`${uid}-key`}
        className={css.textField}
        type="password"
        autoComplete="new-password"
        value={apiKey}
        placeholder="留空则保持已存储的密钥"
        aria-label="API 密钥"
        disabled={saving}
        onChange={(event) => setApiKey(event.currentTarget.value)}
      />
      <p className={css.fieldHint}>{profile.api_key_hint ? `已存储：${profile.api_key_hint}` : "未存储密钥（keyless 端点可留空）"}</p>

      <div className={css.catalogRow}>
        <button type="button" className={css.linkBtn} aria-label="高级设置" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
          {advanced ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />} 高级设置
        </button>
      </div>

      {advanced ? (
        <>
          <label className={css.fieldLabel} htmlFor={`${uid}-model-id`}>模型 ID</label>
          <input
            id={`${uid}-model-id`}
            className={css.textField}
            value={model}
            placeholder="模型 ID"
            aria-label="模型 ID"
            disabled={saving}
            onChange={(event) => setModel(event.currentTarget.value)}
          />

          <div className={css.modelGrid}>
            <label className={css.modelField} htmlFor={`${uid}-context`}>
              <span>上下文窗口</span>
              <input
                id={`${uid}-context`}
                className={css.textField}
                value={contextWindow}
                placeholder="1M"
                aria-label="上下文窗口"
                disabled={saving}
                onChange={(event) => setContextWindow(event.currentTarget.value)}
              />
            </label>
            <label className={css.modelField} htmlFor={`${uid}-max-tokens`}>
              <span>最大输出 token 数</span>
              <input
                id={`${uid}-max-tokens`}
                className={css.textField}
                value={maxTokens}
                placeholder="128K"
                aria-label="最大输出 token 数"
                disabled={saving}
                onChange={(event) => setMaxTokens(event.currentTarget.value)}
              />
            </label>
          </div>

          <div className={css.reasonRow}>
            <span className={css.typeLabel}>推理等级</span>
          </div>
          <div className={css.levelList}>
            {levels.map((level, index) => (
              <div key={`${level}-${String(index)}`} className={css.levelRow}>
                <SelectMenu
                  value={level}
                  onChange={(next) => setLevels((prev) => prev.map((item, i) => (i === index ? next : item)))}
                  options={levelOptions}
                  disabled={saving}
                />
                <button
                  type="button"
                  className={css.iconBtnSmall}
                  aria-label="删除档位"
                  title="删除档位"
                  disabled={saving}
                  onClick={() => setLevels((prev) => prev.filter((_, i) => i !== index))}
                >
                  <IconTrashOutlineRegular size={13} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={css.addChip}
              disabled={saving}
              onClick={() => setLevels((prev) => [...prev, "off"])}
            >
              <IconPlusOutlineRegular size={12} /> 添加档位
            </button>
          </div>

          <ModelProfileExtraFields
            value={extra}
            onChange={(patch) => setExtra((prev) => ({ ...prev, ...patch }))}
            disabled={busy}
            format={format}
            uid={uid}
          />
        </>
      ) : null}

      {failure === null ? null : <div className={css.serverError}>操作失败：{failure}</div>}
      {probe === null ? null : <p className={css.fieldHint}>连通：{probe}</p>}

      <div className={css.cardActions}>
        <button type="button" className={css.dangerBtn} aria-label="删除模型" disabled={saving} onClick={remove}>
          删除模型
        </button>
        <Button variant="outline" size="sm" aria-label="撤销改动" disabled={busy || !dirty} onClick={revert}>
          撤销改动
        </Button>
        <Button variant="outline" size="sm" aria-label="测试连接" disabled={busy} onClick={test}>
          {probing ? "测试中…" : "测试连接"}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>
          保存
        </Button>
      </div>
    </div>
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
    <div className={css.block}>
      <div className={css.rowLabel}>{label}</div>
      <div className={css.rowHint}>{hint}</div>
      <div className={css.blockControl}>
        <input
          className={css.textField}
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
          disabled={locked || draft === ""}
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
          保存
        </Button>
      </div>
      {failure === null ? null : <div className={css.serverError}>保存失败：{failure}</div>}
    </div>
  );
}

/** 运行时：GET /settings 的真实字段；新增项走暂存表单，代理与 Key 沿用就地写回。 */
function RuntimePage(): React.ReactNode {
  const server = useSettings();
  if (server.phase === "loading") return <p className={css.pageLead}>读取运行时设置…</p>;
  if (server.phase === "offline") return <p className={css.pageLead}>未连接后端（读不到运行时设置）</p>;
  const backend = server.data?.web_search_backend ?? "";
  const braveConfigured = server.data?.brave_key_set === true;
  const show = (label: string, value: unknown): React.ReactNode => (
    <Row key={label} label={label}>
      <span>{String(value ?? "—")}</span>
    </Row>
  );
  return (
    <>
      <h2 className={css.pageTitle}>运行时</h2>
      <p className={css.pageLead}>来自 GET /settings 的真实字段；改动经「保存修改」写回 PUT /settings。</p>
      {show("任务并发开关", server.data?.task_concurrency_enabled)}
      {show("任务并发上限", server.data?.task_concurrency_limit)}
      <TextSettingBlock
        label="全局代理"
        hint="所有 Agent 的目标流量经此代理出网；支持 http / https / socks5，可带 user:pass 认证。留空=直连。"
        placeholder="socks5://user:pass@host:1080 或 http://host:port"
        value={server.data?.global_proxy ?? ""}
        apply={(next) => server.save({ global_proxy: next })}
      />
      <TextSettingBlock
        label="Brave Search API Key"
        hint={`免费额度约 2,000 次/月。未配置 Key 时搜索工具不会启用。当前 ${backend === "" ? "未知" : backend} · ${braveConfigured ? "已配置（值不回显）" : "未配置"}`}
        placeholder="输入 Brave API Key"
        value=""
        secret
        clearOnSuccess
        apply={(next) => server.save({ brave_search_api_key: next })}
      />
      <RuntimeSection server={server} />
    </>
  );
}

/** LLM 池：故障转移链的真实状态 + 开关。 */
function LlmPoolPage(): React.ReactNode {
  const pool = useLlmPool();
  const server = useSettings();
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (pool.phase === "loading" || server.phase === "loading") return <p className={css.pageLead}>读取池状态…</p>;
  if (pool.phase === "offline" || server.phase === "offline") return <p className={css.pageLead}>未连接后端（读不到池状态）</p>;
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

  return (
    <>
      <h2 className={css.pageTitle}>LLM 池</h2>
      <p className={css.pageLead}>来自 GET /llm/pool 与 GET /settings 的真实状态。</p>
      <Row label="启用故障转移池" hint="链路里前一个模型失败时自动切到下一个">
        <Switch
          checked={enabled}
          disabled={saving !== null}
          onChange={(next) => save({ llm_pool_enabled: next })}
          label="启用故障转移池"
        />
      </Row>
      <Row label="绑定回退配置" hint="切换到回退模型时保持同一 profile 上下文">
        <Switch
          checked={bindFallback}
          disabled={saving !== null}
          onChange={(next) => save({ llm_pool_bind_fallback: next })}
          label="绑定回退配置"
        />
      </Row>
      <div className={css.poolHead}>
        <span className={css.rowLabel}>故障转移链</span>
        <button type="button" className={css.linkBtn} style={{ whiteSpace: "nowrap" }} onClick={resetAll}>
          <IconRefreshOutlineRegular size={12} /> 全部恢复
        </button>
      </div>
      <Row label="池状态">
        <span>{enabled ? "已启用" : "未启用"} · 链路 {pool.pool?.chain.length ?? 0} 个模型</span>
      </Row>
      {pool.pool?.chain.map((link) => (
        <Row
          key={link.profile_id}
          label={link.name}
          hint={link.model + " · " + link.format + " · 优先级 " + link.priority}
        >
          <div className={css.inlineRow}>
            <span>
              {link.active ? "当前" : "备用"} · {link.state} · 失败 {link.fails} 次
              {link.excluded ? " · 已排除" : ""}
            </span>
            <button
              type="button"
              className={css.iconBtnSmall}
              aria-label="立即恢复"
              title="立即恢复：清除熔断并让下一次调用立刻重试"
              disabled={link.state === "ok"}
              onClick={() => reset(link.profile_id)}
            >
              <IconRefreshOutlineRegular size={13} />
            </button>
          </div>
        </Row>
      ))}
      {error === null ? null : <p className={css.pageLead}>保存失败：{error}</p>}
      <LlmRetrySection />
    </>
  );
}
