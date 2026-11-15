"use client";

/**
 * Harness-level settings dialog (DSH parity).
 *
 * A centered 800×800 modal with a section rail on the left and an independently
 * scrolling options column on the right. Escape, the mask, and the close button
 * all dismiss it; Tab/Shift+Tab are trapped inside the panel and focus returns to
 * the control that opened it.
 *
 * Every control here is backed by a real write path:
 *  - 外观    → the existing preference store + cookie (`data-theme-mode`), and the
 *              `--ax-font-size-*` / `--ax-font-family-code` tokens on `<html>`.
 *  - 模型    → `GET /api/llm/profiles` + `GET /api/llm`, `POST /api/llm/profiles/active`.
 *  - 权限    → the backend exposes no global approval-mode field, so the controls
 *              are explicitly disabled and link to the rule pages that own them.
 *  - 通知    → `PUT /api/settings` (`notify_enabled`); channels stay on /system/notify.
 *  - 关于    → `GET /api/auth/status` + `GET /api/llm` connectivity check.
 */
import * as React from "react";

import { createPortal } from "react-dom";

import Link from "next/link";

import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Check,
  Cpu,
  Info,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Sun,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { APP_CONFIG } from "@/config/app-config";
import { api } from "@/lib/api";
import { persistPreference } from "@/lib/preferences/preferences-storage";
import type { ThemeMode } from "@/lib/preferences/theme";
import type { LLMProfile } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import {
  applyCodeFont,
  applyFontSize,
  applyStoredAppearance,
  CODE_FONT_OPTIONS,
  DEFAULT_CODE_FONT,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_LEVELS,
  persistCodeFont,
  persistFontSize,
  readCodeFont,
  readFontSize,
  type CodeFontId,
  type FontSizeLevel,
} from "./settings-preferences";
import styles from "./settings-dialog.module.css";

/** Section rail entries, in panel order. */
const SECTIONS = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "models", label: "模型", icon: Cpu },
  { id: "permissions", label: "权限", icon: Shield },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "about", label: "关于", icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** Theme cubes: the persisted preference, never the resolved theme. */
const THEME_OPTIONS = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
] as const satisfies ReadonlyArray<{ id: ThemeMode; label: string; icon: typeof Sun }>;

/** Everything tabbable inside the panel, for the focus trap. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Loaded<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

type EffectiveLLM = Awaited<ReturnType<typeof api.getLLM>>;
type EffectiveSettings = Awaited<ReturnType<typeof api.settings>>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "未知错误");
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

/* ── Appearance ─────────────────────────────────────────────────────────── */

function AppearanceSection() {
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const resolvedThemeMode = usePreferencesStore((state) => state.resolvedThemeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);
  const [fontSize, setFontSizeState] = React.useState<FontSizeLevel>(DEFAULT_FONT_SIZE);
  const [codeFont, setCodeFontState] = React.useState<CodeFontId>(DEFAULT_CODE_FONT);

  // Hydrate from storage after mount: the static export prerender has no
  // localStorage, and reading it during render would break hydration.
  React.useEffect(() => {
    setFontSizeState(readFontSize());
    setCodeFontState(readCodeFont());
  }, []);

  const chooseTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    void persistPreference("theme_mode", mode);
  };

  const chooseFontSize = (level: FontSizeLevel) => {
    setFontSizeState(level);
    applyFontSize(level);
    persistFontSize(level);
  };

  const chooseCodeFont = (id: CodeFontId) => {
    setCodeFontState(id);
    applyCodeFont(id);
    persistCodeFont(id);
  };

  const fontSizeDetail = FONT_SIZE_LEVELS.find((level) => level.id === fontSize)?.detail ?? "";

  return (
    <div className={styles.section}>
      <div className={styles.sectionIntro}>
        <h2 className={styles.sectionTitle}>外观</h2>
        <p className={styles.sectionDesc}>主题、字号与代码字体即时生效，并保存在本机浏览器中。</p>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>主题</h3>
        </div>
        <p className={styles.groupDesc}>
          {themeMode === "system"
            ? `跟随系统设置，当前解析为${resolvedThemeMode === "dark" ? "深色" : "浅色"}。`
            : "固定使用所选配色，不随系统变化。"}
        </p>
        <div className={styles.cubeRow} role="group" aria-label="主题">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = themeMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`${styles.cube} ${selected ? styles.selected : ""}`}
                aria-pressed={selected}
                data-testid={`theme-${option.id}`}
                onClick={() => chooseTheme(option.id)}
              >
                <Icon className={styles.cubeIcon} size={18} aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>字号</h3>
          <span className={styles.badge}>{fontSizeDetail}</span>
        </div>
        <p className={styles.groupDesc}>
          写入界面排版令牌（<span className={styles.mono}>--ax-font-size-*</span>），正文、次要文字与代码块同步缩放。
        </p>
        <div className={styles.segmented} role="group" aria-label="字号档位">
          {FONT_SIZE_LEVELS.map((level) => {
            const active = fontSize === level.id;
            return (
              <button
                key={level.id}
                type="button"
                className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
                aria-pressed={active}
                data-testid={`font-size-${level.id}`}
                onClick={() => chooseFontSize(level.id)}
              >
                {level.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>代码字体</h3>
        </div>
        <p className={styles.groupDesc}>
          等宽族写入 <span className={styles.mono}>--ax-font-family-code</span>，代码块与行内代码立即切换。
        </p>
        <div className={styles.segmented} role="group" aria-label="代码字体">
          {CODE_FONT_OPTIONS.map((option) => {
            const active = codeFont === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
                aria-pressed={active}
                data-testid={`code-font-${option.id}`}
                onClick={() => chooseCodeFont(option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.preview}>
          <span className={styles.previewLabel}>预览</span>
          <p className={styles.previewText} data-testid="appearance-preview-text">
            自主渗透 agent 会按此排版渲染正文、任务与会话内容。
          </p>
          <code className={styles.previewCode}>{`const task = await api.createTask({ goal, category_id })`}</code>
        </div>
      </div>
    </div>
  );
}

/* ── Models ─────────────────────────────────────────────────────────────── */

function ModelsSection() {
  const [state, setState] = React.useState<Loaded<{ profiles: LLMProfile[]; effective: EffectiveLLM | null }>>({
    status: "loading",
  });
  const [activating, setActivating] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    Promise.all([api.llmProfiles(), api.getLLM().catch(() => null)])
      .then(([profiles, effective]) => {
        if (cancelled) return;
        setState({ status: "ready", data: { profiles, effective } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const activate = React.useCallback(async (profile: LLMProfile) => {
    setActivating(profile.id);
    try {
      await api.activateLLMProfile(profile.id);
      toast.success(`已设为默认：${profile.name}`);
      setReloadToken((token) => token + 1);
    } catch (error) {
      toast.error(`设为默认失败：${errorMessage(error)}`);
    } finally {
      setActivating(null);
    }
  }, []);

  const effective = state.status === "ready" ? state.data.effective : null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionIntro}>
        <h2 className={styles.sectionTitle}>模型</h2>
        <p className={styles.sectionDesc}>
          当前生效的模型配置来自后端 LLM 配置表；「设为默认」会切换后端正在使用的配置。
        </p>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>当前生效</h3>
          {effective ? (
            <span className={`${styles.badge} ${effective.configured ? styles.badgeActive : styles.badgeWarn}`}>
              {effective.configured ? "已配置" : "未配置"}
            </span>
          ) : null}
        </div>
        {effective ? (
          <div className={styles.modelMeta}>
            <span className={styles.metaItem}>
              provider <span className={styles.mono}>{effective.provider || "-"}</span>
            </span>
            <span className={styles.dim}>·</span>
            <span className={styles.metaItem}>
              model <span className={styles.mono}>{effective.model || "-"}</span>
            </span>
            <span className={styles.dim}>·</span>
            <span className={styles.metaItem}>
              key <span className={styles.mono}>{effective.key_set ? "已设置" : "未设置"}</span>
            </span>
          </div>
        ) : (
          <p className={styles.groupDesc}>未能读取当前生效配置（后端未返回 /api/llm）。</p>
        )}
        {effective?.base_url ? (
          <div className={styles.modelMeta}>
            <span className={styles.metaItem} title={effective.base_url}>
              base_url <span className={styles.mono}>{effective.base_url}</span>
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>已配置的模型</h3>
          {state.status === "ready" ? <span className={styles.badge}>{state.data.profiles.length} 个</span> : null}
        </div>

        {state.status === "loading" ? (
          <div className={styles.stateBox} role="status" data-testid="models-loading">
            <Loader2 size={14} className={styles.spin} aria-hidden="true" />
            正在读取 LLM 配置…
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={`${styles.stateBox} ${styles.stateError}`} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span>读取失败：{state.message}</span>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <RefreshCw size={13} aria-hidden="true" />
              重试
            </button>
          </div>
        ) : null}

        {state.status === "ready" && state.data.profiles.length === 0 ? (
          <div className={styles.stateBox}>
            后端还没有任何 LLM 配置，请先到「LLM 配置」页新增一条。
          </div>
        ) : null}

        {state.status === "ready" && state.data.profiles.length > 0 ? (
          <div className={styles.modelList} data-testid="model-list">
            {state.data.profiles.map((profile) => {
              const isActive = profile.is_default;
              const busy = activating === profile.id;
              return (
                <div
                  key={profile.id}
                  className={`${styles.modelCard} ${isActive ? styles.modelCardActive : ""}`}
                  data-profile-id={profile.id}
                  data-default={isActive ? "true" : "false"}
                >
                  <div className={styles.modelMain}>
                    <div className={styles.modelHead}>
                      <span className={styles.modelName} title={profile.name}>
                        {profile.name}
                      </span>
                      {isActive ? (
                        <span className={`${styles.badge} ${styles.badgeActive}`} data-testid="model-default-badge">
                          <Check size={10} aria-hidden="true" />
                          当前默认
                        </span>
                      ) : null}
                      <span
                        className={`${styles.badge} ${profile.api_key_hint ? "" : styles.badgeWarn}`}
                        data-testid="model-key-badge"
                      >
                        {profile.api_key_hint ? "已设 key" : "未设 key"}
                      </span>
                    </div>
                    <div className={styles.modelMeta}>
                      <span className={`${styles.metaItem} ${styles.mono}`}>{profile.model}</span>
                      <span className={styles.dim}>·</span>
                      <span className={styles.metaItem} title={profile.base_url ?? ""}>
                        {profile.base_url || "默认端点"}
                      </span>
                      <span className={styles.dim}>·</span>
                      <span className={styles.metaItem}>{profile.format}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.modelAction}
                    data-action="activate-profile"
                    data-testid={`model-activate-${profile.id}`}
                    disabled={isActive || activating !== null}
                    title={isActive ? "该配置已是默认" : `把「${profile.name}」设为默认配置`}
                    onClick={() => void activate(profile)}
                  >
                    {busy ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : null}
                    {isActive ? "已是默认" : busy ? "切换中…" : "设为默认"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className={styles.note}>
          <Info className={styles.noteIcon} size={14} aria-hidden="true" />
          <span>
            新增、编辑、删除配置与轮询顺序在 LLM 配置页维护；此处只切换当前默认，不修改配置内容。
          </span>
        </div>
        <div className={styles.linkRow}>
          <Link href="/system/llm" className={styles.inlineLink}>
            打开 LLM 配置
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Permissions ────────────────────────────────────────────────────────── */

function PermissionsSection() {
  return (
    <div className={styles.section}>
      <div className={styles.sectionIntro}>
        <h2 className={styles.sectionTitle}>权限</h2>
        <p className={styles.sectionDesc}>
          审批与工具拦截目前是「按规则」生效的：后端没有全局审批模式字段，因此这里的开关显式禁用，避免出现无效控件。
        </p>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>审批模式</h3>
          <span className={styles.badge}>后端未提供</span>
        </div>
        <p className={styles.groupDesc}>
          审批由拦截规则与工具拦截范围逐条决定（询问 / 自动允许写在规则里），没有可切换的全局档位。
        </p>
        <div className={`${styles.segmented} ${styles.segmentedDisabled}`} role="group" aria-label="审批模式（不可用）">
          <button type="button" className={styles.segment} disabled aria-describedby="permission-note">
            仅询问
          </button>
          <button type="button" className={styles.segment} disabled aria-describedby="permission-note">
            自动允许
          </button>
        </div>
        <div className={styles.note} id="permission-note">
          <Shield className={styles.noteIcon} size={14} aria-hidden="true" />
          <span>要改审批行为，请在「拦截规则」页按规则配置；已发生的审批见「审批记录」。</span>
        </div>
        <div className={styles.linkRow}>
          <Link href="/system/intercept" className={styles.inlineLink}>
            拦截规则
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
          <Link href="/system/intercept/approvals" className={styles.inlineLink}>
            审批记录
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>工具拦截范围</h3>
          <span className={styles.badge}>后端未提供</span>
        </div>
        <div className={styles.switchRow}>
          <div className={styles.switchText}>
            <span className={styles.switchLabel}>全局拦截所有工具调用</span>
            <span className={styles.switchDesc}>当前只能按工具逐个勾选，没有全局开关。</span>
          </div>
          <button
            type="button"
            className={styles.switch}
            role="switch"
            aria-checked={false}
            aria-label="全局拦截所有工具调用（后端未提供）"
            disabled
          >
            <span className={styles.switchKnob} />
          </button>
        </div>
        <div className={styles.note}>
          <Info className={styles.noteIcon} size={14} aria-hidden="true" />
          <span>工具拦截范围在拦截规则页按工具维护，改完即时对之后的执行生效。</span>
        </div>
      </div>
    </div>
  );
}

/* ── Notifications ──────────────────────────────────────────────────────── */

function NotificationsSection() {
  const [state, setState] = React.useState<Loaded<EffectiveSettings>>({ status: "loading" });
  const [saving, setSaving] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api
      .settings()
      .then((settings) => {
        if (!cancelled) setState({ status: "ready", data: settings });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const toggle = React.useCallback(
    async (current: EffectiveSettings) => {
      const next = !current.notify_enabled;
      setSaving(true);
      try {
        const saved = await api.setSettings({ notify_enabled: next });
        setState({ status: "ready", data: { ...current, ...saved } });
        toast.success(next ? "已开启全局推送" : "已暂停全局推送");
      } catch (error) {
        toast.error(`保存失败：${errorMessage(error)}`);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const enabled = state.status === "ready" ? Boolean(state.data.notify_enabled) : false;

  return (
    <div className={styles.section}>
      <div className={styles.sectionIntro}>
        <h2 className={styles.sectionTitle}>通知</h2>
        <p className={styles.sectionDesc}>全局推送开关写入后端设置并即时生效；推送渠道本身是独立资源。</p>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>全局推送</h3>
          <span className={styles.badge}>PUT /api/settings</span>
        </div>

        {state.status === "loading" ? (
          <div className={styles.stateBox} role="status" data-testid="notify-loading">
            <Loader2 size={14} className={styles.spin} aria-hidden="true" />
            正在读取通知设置…
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={`${styles.stateBox} ${styles.stateError}`} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span>读取失败：{state.message}</span>
            <button type="button" className={styles.actionButton} onClick={() => setReloadToken((t) => t + 1)}>
              <RefreshCw size={13} aria-hidden="true" />
              重试
            </button>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <>
            <div className={styles.switchRow}>
              <div className={styles.switchText}>
                <span className={styles.switchLabel}>漏洞 IM 推送总开关</span>
                <span className={styles.switchDesc}>
                  {enabled ? "已开启：命中过滤规则的漏洞会推送到已启用渠道。" : "已暂停：所有渠道都不再推送。"}
                </span>
              </div>
              <button
                type="button"
                className={`${styles.switch} ${enabled ? styles.switchOn : ""}`}
                role="switch"
                aria-checked={enabled}
                aria-label="漏洞 IM 推送总开关"
                data-testid="notify-switch"
                disabled={saving}
                onClick={() => void toggle(state.data)}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>

            <div className={styles.statusList}>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>汇总间隔</span>
                <span className={styles.statusValue}>
                  {state.data.notify_digest_interval_min ? `${state.data.notify_digest_interval_min} 分钟` : "未设置"}
                </span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>详情回链地址</span>
                <span className={styles.statusValue} title={state.data.notify_public_base_url ?? ""}>
                  {state.data.notify_public_base_url || "未设置"}
                </span>
              </div>
            </div>
          </>
        ) : null}

        <div className={styles.note}>
          <Bell className={styles.noteIcon} size={14} aria-hidden="true" />
          <span>渠道（钉钉 / 飞书 / Webhook 等）、过滤规则与投递记录在「通知推送」页管理。</span>
        </div>
        <div className={styles.linkRow}>
          <Link href="/system/notify" className={styles.inlineLink}>
            通知推送
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── About ──────────────────────────────────────────────────────────────── */

type HealthState =
  | { status: "checking" }
  | {
      status: "ok";
      authDisabled: boolean;
      configured: boolean;
      provider: string;
      model: string;
      checkedAt: string;
    }
  | { status: "error"; message: string; checkedAt: string };

function AboutSection() {
  const [health, setHealth] = React.useState<HealthState>({ status: "checking" });
  const [checkToken, setCheckToken] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setHealth({ status: "checking" });
    Promise.all([api.authStatus(), api.getLLM()])
      .then(([auth, llm]) => {
        if (cancelled) return;
        setHealth({
          status: "ok",
          authDisabled: Boolean(auth.auth_disabled),
          configured: Boolean(llm.configured),
          provider: llm.provider,
          model: llm.model,
          checkedAt: clockLabel(new Date()),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHealth({ status: "error", message: errorMessage(error), checkedAt: clockLabel(new Date()) });
      });
    return () => {
      cancelled = true;
    };
  }, [checkToken]);

  const checking = health.status === "checking";
  const backendOk = health.status === "ok";

  return (
    <div className={styles.section}>
      <div className={styles.sectionIntro}>
        <h2 className={styles.sectionTitle}>关于</h2>
        <p className={styles.sectionDesc}>品牌、版本与后端连通状态。</p>
      </div>

      <div className={styles.aboutHead}>
        <svg className={styles.brandMark} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 12c3.2-5.3 7.1-8 11.8-8 2.4 0 4.1.8 5.2 2.4-1.4.4-2.6 1.1-3.6 2.1 1.5.2 2.8.8 3.8 1.8-2.2 1-3.7 2.8-4.6 5.2-1.2 3.2-3.6 5-7.2 5.5 1.3-1.6 2.2-3.4 2.7-5.3-2.2-.4-4.1-1.3-5.7-2.7-.9-.8-1.7-1.9-2.4-3Z"
            fill="currentColor"
          />
          <circle cx="16.2" cy="8.7" r=".9" fill="var(--ax-bg-elevated)" />
        </svg>
        <div className={styles.aboutIdentity}>
          <span className={styles.brandName}>{APP_CONFIG.name}</span>
          <span className={styles.brandMeta}>LLM 驱动的自主渗透 agent 工作台</span>
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.statusList} data-testid="about-status">
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>版本</span>
            <span className={styles.statusValue}>
              <span className={styles.mono}>v{APP_CONFIG.version}</span>
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>后端 API</span>
            <span className={styles.statusValue} data-testid="about-backend">
              <span className={`${styles.dot} ${backendOk ? styles.dotOk : checking ? "" : styles.dotBad}`} />
              {checking ? "检查中…" : backendOk ? "已连接" : "连接失败"}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>登录方式</span>
            <span className={styles.statusValue}>
              {health.status === "ok"
                ? health.authDisabled
                  ? "已关闭密码登录（本机直连）"
                  : "需要密码登录"
                : health.status === "checking"
                  ? "检查中…"
                  : "未知"}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>模型</span>
            <span className={styles.statusValue} data-testid="about-model">
              {health.status === "ok" ? (
                health.configured ? (
                  <>
                    <span className={`${styles.dot} ${styles.dotOk}`} />
                    已配置 · <span className={styles.mono}>{health.model}</span>
                  </>
                ) : (
                  <>
                    <span className={`${styles.dot} ${styles.dotBad}`} />
                    未配置
                  </>
                )
              ) : health.status === "checking" ? (
                "检查中…"
              ) : (
                "未知"
              )}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>检查时间</span>
            <span className={`${styles.statusValue} ${styles.dim}`}>
              {health.status === "checking" ? "—" : health.checkedAt}
            </span>
          </div>
        </div>

        {health.status === "error" ? (
          <div className={`${styles.stateBox} ${styles.stateError}`} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span>后端不可达：{health.message}</span>
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            data-testid="settings-recheck"
            disabled={checking}
            onClick={() => setCheckToken((token) => token + 1)}
          >
            <RefreshCw size={13} className={checking ? styles.spin : undefined} aria-hidden="true" />
            {checking ? "检查中…" : "重新检查"}
          </button>
        </div>
        <p className={styles.footerNote}>
          {APP_CONFIG.name} · agent harness 设置面板。键盘：Tab 在面板内循环，Esc 关闭。
        </p>
      </div>
    </div>
  );
}

/* ── Dialog shell ───────────────────────────────────────────────────────── */

export interface SettingsDialogProps {
  /** Whether the modal is mounted/visible. */
  readonly open: boolean;
  /** Close request from Escape, the mask, or the close button. */
  readonly onClose: () => void;
  /** Control that opened the dialog; receives focus back after close. */
  readonly returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Render the settings modal into `document.body` while `open`.
 * @param props - open state, close callback, focus-return target.
 * @returns the portalled dialog, or null while closed/unmounted.
 */
export function SettingsDialog({ open, onClose, returnFocusRef }: SettingsDialogProps) {
  const [mounted, setMounted] = React.useState(false);
  const [section, setSection] = React.useState<SectionId>("appearance");
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  // Re-apply persisted font-size / code-font on shell mount so a reload keeps
  // the previous session's appearance before the dialog is ever opened.
  React.useEffect(() => {
    setMounted(true);
    applyStoredAppearance();
  }, []);

  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
      );

    const initial =
      panel.querySelector<HTMLElement>('[data-settings-autofocus="true"]') ?? focusables()[0] ?? panel;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && panel.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const target = returnFocusRef?.current ?? previousFocus;
      if (!target) return;
      // Restore synchronously (the trigger is still in the document) and again on
      // the next frame in case a late mount effect in the page stole focus.
      target.focus?.();
      window.requestAnimationFrame(() => {
        if (document.activeElement !== target) target.focus?.();
      });
    };
  }, [open, returnFocusRef]);

  if (!mounted || !open) return null;

  const activeSection = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <div className={styles.mask} aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="settings-dialog"
      >
        <div className={styles.title} id={titleId} tabIndex={-1}>
          设置
        </div>

        <div className={styles.header}>
          <span className={styles.headerLabel}>{activeSection.label}</span>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭设置"
            title="关闭设置 (Esc)"
            data-testid="settings-close"
            data-settings-autofocus="true"
            onClick={() => closeRef.current()}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <nav className={styles.nav} aria-label="设置分组">
          <div className={styles.navList}>
            {SECTIONS.map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === activeSection.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.navCell} ${active ? styles.active : ""}`}
                  aria-current={active ? "true" : undefined}
                  data-testid={`settings-nav-${entry.id}`}
                  onClick={() => setSection(entry.id)}
                >
                  <span className={styles.navIcon} aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className={styles.navLabel}>{entry.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className={styles.options} data-testid="settings-options">
          {activeSection.id === "appearance" ? <AppearanceSection /> : null}
          {activeSection.id === "models" ? <ModelsSection /> : null}
          {activeSection.id === "permissions" ? <PermissionsSection /> : null}
          {activeSection.id === "notifications" ? <NotificationsSection /> : null}
          {activeSection.id === "about" ? <AboutSection /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
