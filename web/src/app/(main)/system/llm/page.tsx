"use client";

import * as React from "react";

import {
  Loader2Icon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
// API Key 的浏览器侧启发式校验，逐条对齐 DSH apiKey.ts（见该文件头注释）：
// 空值不是失败、引号/空格/NAME=value 一律算格式错、且**只在 UI 跑**。
import { apiKeyFailure, apiKeyFailureText, apiKeyWireValue } from "@/lib/api-key";
import {
  clearLLMModelCache,
  formatModelCacheTime,
  loadLLMModelCache,
  saveLLMModelCache,
} from "@/lib/llm-model-cache";
import type { LLMPoolMember, LLMPoolStatus, LLMProfile, LLMRetryOverride } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProfileRetryFields, RetryPolicyPanel, ZERO_OVERRIDE } from "./_components/retry";

// 思考开关(thinking.type)与思考强度(reasoning_effort)是两个【互相独立】的字段，
// 各自单独设置——有些接口没有 thinking 字段、只靠强度参数就能激活思考，故需解耦。
// 存库空字符串 = 该字段【不发送】；Radix Select 不接受空 value，故 UI 用 "none"
// 哨兵表示不发送，存取时与 "" 互转（NONE / fromStore / toStore）。
const NONE = "none";
const fromStore = (v?: string) => (v ? v : NONE);
const toStore = (v: string) => (v === NONE ? "" : v);

// OpenCode Zen 公开免费档：不登录、不申请 Key，固定使用公开密钥 public。
// space-bunny-free 支持工具调用、推理和 1M 上下文，适合直接作为 mioX 的 Agent 模型。
const OPENCODE_PUBLIC_PRESET = {
  name: "OpenCode 公开免费",
  format: "openai" as const,
  model: "space-bunny-free",
  baseUrl: "https://opencode.ai/zen/v1",
  apiKey: "public",
  sessionHeaderKey: "x-opencode-session",
  contextWindowK: "512",
};
const THINKING_TYPES: { value: string; label: string }[] = [
  { value: NONE, label: "不发送（默认）" },
  { value: "disabled", label: "关闭" },
  { value: "enabled", label: "开启" },
];
// 输出上限用哪个请求字段名（仅 openai 格式有意义）。NONE ↔ "" 走同一套哨兵转换。
const MAX_TOKENS_FIELDS: { value: string; label: string }[] = [
  { value: NONE, label: "max_tokens（默认）" },
  { value: "max_completion_tokens", label: "max_completion_tokens" },
];
// 另外两种格式各自定死了字段名，选项对它们无意义，说明文案里直接讲清楚。
const MAX_TOKENS_FIELD_HINTS: Record<string, string> = {
  openai:
    "上限发哪个键。max_tokens 是默认，绝大多数兼容网关只认它；OpenAI 官方推理模型（o 系列 / GPT-5）反过来只认 max_completion_tokens，收到 max_tokens 会直接报 unsupported_parameter。",
  anthropic: "仅 openai 格式可选。Anthropic 的字段名固定为 max_tokens。",
  "openai-responses": "仅 openai 格式可选。Responses API 的字段名固定为 max_output_tokens。",
};
const EFFORT_LEVELS: { value: string; label: string }[] = [
  { value: NONE, label: "不发送（默认）" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

// 每模型声明支持的推理档位（对齐 DSH ModelReasoningEfforts.tsx:15）：
// INITIAL_LEVELS = ['off','low','medium','high'] —— Off 排第一，因为它是「关掉思考」，
// 不是「多一档强度」。xhigh/max 是本项目 reasoning_effort 已支持的扩展档，一并列出。
// 声明非空时，合成器的选档只列这些档位；选 off 时请求体【不带】reasoning_effort
// （ModelReasoningEfforts.tsx:18-20 defaultValue: off → null）。
const DECLARABLE_EFFORT_LEVELS: { value: string; label: string; hint?: string }[] = [
  { value: "off", label: "off", hint: "关闭思考：请求体不带 reasoning_effort" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

function cooldownText(secs: number) {
  if (secs <= 0) return "";
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}min`;
}

// 一个配置在卡片上显示的「是否正常」。没填 Key 的配置不一定是坏的：
// 本地网关 / 公开端点本来就不要鉴权，空 key 是**合法配置**（对齐 DSH
// ProviderEditor.tsx:9-11「a blank key materializes a reference-free profile for
// provider-native authentication」）。所以这里只标注「不带鉴权」，不当故障；
// 真正的故障来自轮询的熔断记录（轮询关着时不会产生新记录，此时「正常」= 没有已知故障）。
type Health = { label: string; cls: string; hint?: string };
function healthOf(p: LLMProfile, m?: LLMPoolMember): Health {
  if (!p.api_key_hint) {
    // 与「Key 缺失」区分开：缺失是输入框没填（表单校验拦），这里是存下来的配置状态。
    const keyless: Health = {
      label: "无 Key · 不带鉴权",
      cls: "border-muted-foreground/40 text-muted-foreground",
      hint: "该配置不带 API Key，请求不发送鉴权头（本地网关 / 公开端点适用）",
    };
    // 熔断/降级状态仍然优先展示：无 Key 不代表一定连得上。
    if (m?.state === "tripped") {
      return {
        label: m.cooldown_secs > 0 ? `已熔断 · ${cooldownText(m.cooldown_secs)}` : "已熔断",
        cls: "border-destructive/50 text-destructive",
        hint: m.last_error,
      };
    }
    if (m?.state === "degraded") {
      return {
        label: `无 Key · 失败 ${m.fails} 次`,
        cls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
        hint: m.last_error,
      };
    }
    return keyless;
  }
  if (m?.state === "tripped") {
    return {
      label: m.cooldown_secs > 0 ? `已熔断 · ${cooldownText(m.cooldown_secs)}` : "已熔断",
      cls: "border-destructive/50 text-destructive",
      hint: m.last_error,
    };
  }
  if (m?.state === "degraded") {
    return {
      label: `异常 · 失败 ${m.fails} 次`,
      cls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
      hint: m.last_error,
    };
  }
  return { label: "正常", cls: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 轮询配置抽屉
// ─────────────────────────────────────────────────────────────────────────────

function PoolSheet({
  open,
  onOpenChange,
  pool,
  onReload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pool: LLMPoolStatus | null;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  // 冷却倒计时是后端算出的剩余秒数——抽屉开着且有配置不正常时才定时拉，让它走起来。
  React.useEffect(() => {
    if (!open || !pool?.enabled || !pool.chain.some((m) => m.state !== "ok")) return;
    const t = setInterval(() => void onReload(), 10_000);
    return () => clearInterval(t);
  }, [open, pool, onReload]);

  async function toggle(patch: { llm_pool_enabled?: boolean; llm_pool_bind_fallback?: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setSettings(patch);
      await onReload();
      if (patch.llm_pool_enabled !== undefined) {
        toast.success(patch.llm_pool_enabled ? "已开启 LLM 轮询" : "已关闭 LLM 轮询");
      } else {
        toast.success("已更新兜底设置");
      }
    } catch (e) {
      toast.error(`设置失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function recover(id?: string) {
    try {
      await api.resetLLMPool(id);
      await onReload();
      toast.success(id ? "已恢复该配置" : "已恢复全部配置");
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message}`);
    }
  }

  const enabled = pool?.enabled ?? false;
  const chain = pool?.chain ?? [];
  // 参与轮询的成员（排除被标记「不参与轮询」的），顺序即后端实际的尝试顺序。
  const inChain = chain.filter((m) => m.active || !m.excluded);
  const tripped = chain.filter((m) => m.state === "tripped");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            <ZapIcon className="size-4" /> LLM 轮询 · 故障转移
          </SheetTitle>
          <SheetDescription>
            开启后，<b>未指定模型</b>的 Agent 在当前配置不可用（余额不足 / Key 失效 / 限流 /
            服务异常）时自动切到下一个配置。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label className="text-sm">启用轮询</Label>
              <p className="text-muted-foreground text-xs">默认关闭。关闭时始终只用激活配置，失败即失败。</p>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggle({ llm_pool_enabled: v })}
              aria-label="LLM 轮询开关"
            />
          </div>

          {enabled && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label className="text-sm">指定模型失败时也兜底</Label>
                  <p className="text-muted-foreground text-xs">
                    默认关闭：Agent 或任务指定了某个配置就只用它，失败即失败（不会悄悄换成别的模型）。
                    开启后，指定的配置失败时也会回落到下面的轮询链。
                  </p>
                </div>
                <Switch
                  checked={pool?.bind_fallback ?? false}
                  disabled={busy}
                  onCheckedChange={(v) => void toggle({ llm_pool_bind_fallback: v })}
                  aria-label="绑定配置失败兜底开关"
                />
              </div>

              <Separator />

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">轮询顺序</Label>
                  {tripped.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => void recover()}>
                      <RotateCcwIcon /> 全部恢复
                    </Button>
                  )}
                </div>
                {inChain.length < 2 && (
                  <p className="text-muted-foreground text-xs">
                    当前只有 {inChain.length} 个可用配置，轮询不会生效——至少需要 2 个已填 API Key 且参与轮询的配置。
                  </p>
                )}
                {chain.map((m) => {
                  const excluded = m.excluded && !m.active;
                  const order = excluded ? null : inChain.findIndex((x) => x.profile_id === m.profile_id) + 1;
                  return (
                    <div
                      key={m.profile_id}
                      className={cn(
                        "grid gap-1 rounded-lg border p-2.5 text-sm",
                        excluded && "opacity-55",
                        m.state === "tripped" && "border-destructive/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="w-5 shrink-0 text-center font-mono text-muted-foreground text-xs">
                          {order ?? "—"}
                        </span>
                        <span className="font-medium">{m.name}</span>
                        {m.active && (
                          <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                            激活
                          </Badge>
                        )}
                        {excluded && <Badge variant="outline">不参与轮询</Badge>}
                        <div className="ml-auto flex items-center gap-2">
                          {m.state === "tripped" && m.cooldown_secs > 0 && (
                            <span className="text-muted-foreground text-xs">冷却 {cooldownText(m.cooldown_secs)}</span>
                          )}
                          {m.state === "degraded" && (
                            <span className="text-muted-foreground text-xs">连续失败 {m.fails} 次</span>
                          )}
                          {m.state !== "ok" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label="立即恢复"
                              title="立即恢复：清除熔断，下次调用重试该配置"
                              onClick={() => void recover(m.profile_id)}
                            >
                              <RotateCcwIcon className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 pl-7 text-muted-foreground text-xs">
                        <code className="truncate font-mono">{m.model}</code>
                        {!m.active && <span>优先级 {m.priority}</span>}
                      </div>
                      {m.last_error && (
                        <p className="truncate pl-7 font-mono text-muted-foreground text-xs" title={m.last_error}>
                          {m.last_error}
                        </p>
                      )}
                    </div>
                  );
                })}
                {chain.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
                    暂无配置
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs leading-relaxed">
                激活配置恒为第 1 顺位，其余按优先级从高到低（在各配置里设置）。某个配置失败后进入冷却 （60s → 5min →
                30min），冷却期内被跳过，恢复后自动切回。上下文窗口装不下当前请求的配置会被跳过。 指定了模型的 Agent
                与任务默认不参与轮询。
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 模型配置抽屉（新建 / 编辑共用同一套表单）
// ─────────────────────────────────────────────────────────────────────────────

function ProfileSheet({
  profile,
  open,
  onOpenChange,
  onSaved,
  preset,
}: {
  profile: LLMProfile | null; // null = 新建
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
  preset: "opencode" | null;
}) {
  const isNew = !profile;
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<"anthropic" | "openai" | "openai-responses">("anthropic");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [proxy, setProxy] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [keyHint, setKeyHint] = React.useState("");
  const [rps, setRps] = React.useState("0");
  const [rpm, setRpm] = React.useState("0");
  const [cw, setCw] = React.useState("0"); // 上下文窗口(K tokens);0=默认200K
  const [thinkingType, setThinkingType] = React.useState(NONE);
  const [effort, setEffort] = React.useState(NONE);
  // 该模型声明支持的推理档位（空 = 不声明，选档列出全部档位）。见 DECLARABLE_EFFORT_LEVELS。
  const [efforts, setEfforts] = React.useState<string[]>([]);
  const [priority, setPriority] = React.useState("0"); // 轮询顺位;越大越先
  const [poolExclude, setPoolExclude] = React.useState(false);
  const [streaming, setStreaming] = React.useState(true); // true=流式(默认);false=非流式
  const [maxTokens, setMaxTokens] = React.useState("0"); // 单次回复输出上限;0=不发送
  const [maxTokensField, setMaxTokensField] = React.useState(NONE); // 上限用哪个字段名;NONE=max_tokens
  const [sessionHeaderKey, setSessionHeaderKey] = React.useState(""); // 自定义会话头名;空=不发送
  const [retry, setRetry] = React.useState<LLMRetryOverride>(ZERO_OVERRIDE); // 本配置的重试覆盖;全 0=跟随全局
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [models, setModels] = React.useState<string[]>([]);
  const [modelFilter, setModelFilter] = React.useState(""); // 只描述"用户正在搜什么"，与 model 的值解耦
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const [modelsUpdatedAt, setModelsUpdatedAt] = React.useState<number | null>(null);
  const [modelsError, setModelsError] = React.useState("");
  const autoFetchRef = React.useRef<string | null>(null);

  const applyOpencodePreset = React.useCallback(() => {
    setName(OPENCODE_PUBLIC_PRESET.name);
    setFormat(OPENCODE_PUBLIC_PRESET.format);
    setModel(OPENCODE_PUBLIC_PRESET.model);
    setBaseUrl(OPENCODE_PUBLIC_PRESET.baseUrl);
    setApiKey(OPENCODE_PUBLIC_PRESET.apiKey);
    setSessionHeaderKey(OPENCODE_PUBLIC_PRESET.sessionHeaderKey);
    setCw(OPENCODE_PUBLIC_PRESET.contextWindowK);
    setKeyHint("public");
  }, []);

  // 每次打开时从传入的 profile 灌一遍表单（新建则重置为默认值）。抽屉关掉再打开
  // 就是一次干净的开始，不会留下上一个配置的残影。
  React.useEffect(() => {
    if (!open) return;
    autoFetchRef.current = null;
    setName(profile?.name ?? "");
    setFormat(profile?.format === "openai" || profile?.format === "openai-responses" ? profile.format : "anthropic");
    setModel(profile?.model ?? "");
    setModelFilter("");
    setBaseUrl(profile?.base_url ?? "");
    setProxy(profile?.proxy ?? "");
    setRps(String(profile?.rate_per_second ?? 0));
    setRpm(String(profile?.rate_per_minute ?? 0));
    setCw(String(profile?.context_window_k ?? 0));
    setThinkingType(fromStore(profile?.thinking_type));
    setEffort(fromStore(profile?.reasoning_effort));
    setEfforts(profile?.reasoning_efforts ?? []);
    setPriority(String(profile?.priority ?? 0));
    setPoolExclude(profile?.pool_exclude ?? false);
    setStreaming(profile?.streaming ?? true);
    setMaxTokens(String(profile?.max_tokens ?? 0));
    setMaxTokensField(fromStore(profile?.max_tokens_field));
    setSessionHeaderKey(profile?.session_header_key ?? "");
    setRetry(profile?.retry ?? ZERO_OVERRIDE);
    setApiKey("");
    setKeyHint(profile?.api_key_hint ?? "");
    if (preset === "opencode") applyOpencodePreset();
  }, [open, profile, preset, applyOpencodePreset]);

  const profileId = profile ? Number(profile.id) : undefined;

  // 输入框当前值的判定（apiKey.ts:51-58）：空 = 不失败（保留已存的 key）。
  // 这是【字段级】判定，只拦提交与测试；已存的配置状态（无 key 合法）不受它影响。
  const keyFailure = apiKeyFailure(apiKey);
  const keyErrorText = keyFailure ? apiKeyFailureText(keyFailure) : "";
  // 只声明了 off 等于没有强度可调，DSH 直接拒绝这种声明
  // （ModelReasoningEfforts.tsx:99 modelReasoningNeedsLevel）。
  const effortsOnlyOff = efforts.length > 0 && efforts.every((level) => level === "off");

  async function loadModels(options: { silent?: boolean; open?: boolean } = {}) {
    if (loadingModels) return;
    const { silent = false, open: openList = true } = options;
    setLoadingModels(true);
    setModelsError("");
    try {
      const r = await api.fetchLLMModels(format, baseUrl, apiKey, proxy, profileId);
      if (r.ok && r.models && r.models.length > 0) {
        const list = Array.from(new Set(r.models)).sort((a, b) => a.localeCompare(b));
        setModels(list);
        const cached = saveLLMModelCache(format, baseUrl, list);
        setModelsUpdatedAt(cached?.updatedAt ?? Date.now());
        if (openList) setModelsOpen(true);
        if (!silent) toast.success(`已拉取并记忆 ${list.length} 个模型`);
        return;
      }
      const message = r.error ?? (r.ok ? "API 返回了空模型列表" : "未获取到模型");
      setModelsError(message);
      if (!silent) toast.error(`拉取模型失败：${message}`);
    } catch (e) {
      const message = (e as Error).message;
      setModelsError(message);
      if (!silent) toast.error(`拉取模型出错：${message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  const loadModelsRef = React.useRef(loadModels);
  loadModelsRef.current = loadModels;

  // 打开抽屉或切换端点时：先读本地记忆；有可用 Key/已存配置时静默刷新一次。
  React.useEffect(() => {
    if (!open) return;
    const cached = loadLLMModelCache(format, baseUrl);
    setModels(cached?.models ?? []);
    setModelsUpdatedAt(cached?.updatedAt ?? null);
    setModelsError("");
    setModelsOpen(false);

    const endpointKey = `${format}|${baseUrl}|${apiKey}|${profile?.id ?? ""}`;
    const canAutoFetch = Boolean(profile) || (preset === "opencode" && baseUrl.trim() !== "") || apiKey.trim() !== "";
    if (!canAutoFetch || autoFetchRef.current === endpointKey) return;
    autoFetchRef.current = endpointKey;
    const timer = window.setTimeout(() => {
      void loadModelsRef.current({ silent: true, open: false });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, format, baseUrl, apiKey, profile, preset]);

  function clearModelMemory() {
    clearLLMModelCache(format, baseUrl);
    setModels([]);
    setModelFilter("");
    setModelsUpdatedAt(null);
    setModelsError("");
    setModelsOpen(false);
    toast.success("已清除模型列表记忆");
  }

  function handleModelsOpenChange(next: boolean) {
    if (!next) {
      setModelsOpen(false);
      return;
    }
    // 用户主动打开（点刷新按钮 / 聚焦输入框）时清掉搜索词，先把完整列表摆出来；
    // 只有真的在输入框里打字才过滤。
    setModelFilter("");
    setModelsOpen(true);
    if (!loadingModels && models.length === 0) {
      void loadModelsRef.current({ silent: true, open: false });
    }
  }

  const canFetchModels = Boolean(profile) || apiKey.trim() !== "" || baseUrl.trim() !== "";

  // 过滤用什么词是独立的一路状态：早先直接用 model 的值当查询词，字段里已经填着
  // "glm-5.3-flash" 时列表会被过滤成空（同名项还被刻意排除），表现就是“拉取成功
  // 但一个都不显示”。现在只要没在打字，就展示全部。
  const filteredModels = React.useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return models;
    return models.filter((item) => item.toLowerCase().includes(q));
  }, [modelFilter, models]);

  async function testConnection() {
    if (testing) return;
    // 格式错的 key 先别发：DSH 的做法是把 probe 一起挡住
    // （ProviderEditor.tsx:635 probeBlocked={...shownKeyFailure}），否则用户会拿到一个
    // 401 而不是「你这行贴错了」。
    if (keyFailure) {
      toast.error(keyErrorText);
      return;
    }
    setTesting(true);
    try {
      // 用配置实际会跑的思考参数来测，这样不支持该字段的模型在这里就失败，
      // 而不是等到跑任务时才炸。传 profile id：Key 输入框留空时用已存的 Key。
      const r = await api.testLLM(
        format,
        model,
        baseUrl,
        apiKey,
        proxy,
        toStore(thinkingType),
        toStore(effort),
        profileId,
        streaming,
        sessionHeaderKey.trim(),
      );
      // 回复内容一并展示：看得见模型确实说了话，才算和会话里跑通是一回事。
      if (r.ok)
        toast.success(`连接成功 · ${r.latency_ms ?? "?"}ms · ${r.model ?? model}`, {
          description: r.reply ? `回复：${r.reply}` : undefined,
        });
      else toast.error(`连接失败：${r.error ?? "未知"}`);
    } catch (e) {
      toast.error(`测试出错：${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!name.trim() || !model.trim()) {
      toast.error("请填写名称与模型");
      return;
    }
    // 空 key 不是失败（本地网关/公开端点合法）；格式错才拦。
    if (keyFailure) {
      toast.error(keyErrorText);
      return;
    }
    if (effortsOnlyOff) {
      toast.error("推理档位至少要有 off 以外的一个档位；不需要思考请留空（不声明）");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { id } = await api.saveLLMProfile({
        ...(profile ? { id: Number(profile.id) } : {}),
        name: name.trim(),
        format,
        model: model.trim(),
        base_url: baseUrl.trim(),
        proxy: proxy.trim(),
        // 粘进来时被包住的空白一并去掉（ProviderEditor.tsx:287 keyText.trim()）：
        // 提交的是「真正要发出去的 key」，不是用户复制粘贴时的边角。
        api_key: apiKeyWireValue(apiKey),
        rate_per_second: Number(rps) || 0,
        rate_per_minute: Number(rpm) || 0,
        context_window_k: Number(cw) || 0,
        thinking_type: toStore(thinkingType),
        reasoning_effort: toStore(effort),
        reasoning_efforts: efforts,
        priority: Number(priority) || 0,
        pool_exclude: poolExclude,
        streaming,
        max_tokens: Math.max(0, Number(maxTokens) || 0),
        // 字段名开关只对 openai(Chat Completions) 有意义，其它格式一律回落到默认；
        // 后端也会再做一次同样的归一化，这里只是别让 UI 送出自相矛盾的值。
        max_tokens_field: format === "openai" ? toStore(maxTokensField) : "",
        session_header_key: sessionHeaderKey.trim(),
        retry,
      });
      if (isNew && preset === "opencode") {
        await api.activateLLMProfile(String(id));
        toast.success("已创建并激活 OpenCode 公开免费 API");
      } else if (isNew) {
        toast.success(`已新建：${name.trim()}（在卡片上「设为激活」以启用）`);
      } else {
        toast.success(profile?.is_default ? "已保存，激活配置即时生效，无需重启" : "已保存");
      }
      onSaved(String(id));
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:min-w-[420px] data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            {isNew ? "新建模型配置" : `编辑：${profile?.name}`}
            {profile?.is_default && (
              <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                激活中
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {preset === "opencode"
              ? "已预填 OpenCode 公开免费 API（固定密钥 public），保存后会创建并自动激活。"
              : isNew
                ? "新建后不会自动激活，请在卡片上「设为激活」以启用。"
                : "修改后点击保存；激活配置保存后对全部 Agent 立即生效。"}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-1">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid gap-0.5">
              <span className="font-medium text-sm">OpenCode 公开免费 API</span>
              <span className="text-muted-foreground text-xs">
                space-bunny-free  Key=public  https://opencode.ai/zen/v1
              </span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={applyOpencodePreset}>
              <SparklesIcon /> 一键填充
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="p-name">名称</Label>
              <Input
                id="p-name"
                placeholder="例如：OpenAI 生产"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>格式</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "anthropic" | "openai" | "openai-responses")}>
                <SelectTrigger>
                  <SelectValue placeholder="选择格式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI (Chat Completions)</SelectItem>
                  <SelectItem value="openai-responses">OpenAI (Responses API)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="p-model">模型</Label>
              <span className="text-[11px] text-muted-foreground">
                {models.length > 0
                  ? `已记忆 ${models.length} 个模型${modelsUpdatedAt ? ` / ${formatModelCacheTime(modelsUpdatedAt)}` : ""}`
                  : canFetchModels
                    ? "打开列表会自动拉取"
                    : "填写 API Key / Base URL 后可拉取"}
              </span>
            </div>
            {/* 不用 modal：modal 模式下 Radix 会给页面其余部分加 pointer-events: none
                并做焦点劫持，输入框恰好是 PopoverAnchor，表现就是"选完模型再也点不进去、
                也改不了字"。这里弹层只当提示列表，输入框必须一直可编辑。 */}
            <Popover open={modelsOpen} onOpenChange={handleModelsOpenChange}>
              <div className="flex items-center gap-2">
                <PopoverAnchor asChild>
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="p-model"
                      className="font-mono"
                      placeholder="claude-opus-4-8"
                      value={model}
                      onFocus={() => {
                        if (!modelsOpen) handleModelsOpenChange(true);
                      }}
                      onChange={(e) => {
                        setModel(e.target.value);
                        // 打字才过滤；点开列表时由 handleModelsOpenChange 清空。
                        setModelFilter(e.target.value);
                        setModelsOpen(true);
                      }}
                    />
                  </div>
                </PopoverAnchor>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={loadingModels}
                    title="拉取并记忆模型列表"
                  >
                    {loadingModels ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                  </Button>
                </PopoverTrigger>
              </div>
              {modelsOpen && (
                <PopoverContent className="max-h-80 w-80 gap-0 overflow-hidden overscroll-contain p-0" align="start" sideOffset={4}>
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium text-xs">模型列表</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {models.length > 0 ? `已记忆 ${models.length} 个模型` : "尚未拉取"}
                        {modelsUpdatedAt ? ` / ${formatModelCacheTime(modelsUpdatedAt)}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      disabled={loadingModels}
                      title="重新拉取"
                      onClick={() => void loadModels({ silent: false, open: true })}
                    >
                      {loadingModels ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="size-3.5" />
                      )}
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
                    {loadingModels ? (
                      <p className="px-2 py-4 text-center text-muted-foreground text-xs">正在拉取模型列表...</p>
                    ) : filteredModels.length > 0 ? (
                      filteredModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="w-full shrink-0 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setModel(m);
                            setModelFilter("");
                            setModelsOpen(false);
                          }}
                        >
                          {m}
                        </button>
                      ))
                    ) : modelsError ? (
                      <div className="px-2 py-4 text-center text-xs">
                        <p className="text-destructive">{modelsError}</p>
                        <button
                          type="button"
                          className="mt-2 underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => void loadModels({ silent: false, open: true })}
                        >
                          重试
                        </button>
                      </div>
                    ) : models.length > 0 ? (
                      <p className="px-2 py-4 text-center text-muted-foreground text-xs">没有匹配的模型</p>
                    ) : (
                      <div className="px-2 py-4 text-center text-xs">
                        <p className="text-muted-foreground">暂无模型列表</p>
                        <button
                          type="button"
                          className="mt-2 underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => void loadModels({ silent: false, open: true })}
                        >
                          拉取模型
                        </button>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              )}
            </Popover>
            {models.length > 0 && (
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>模型列表按当前 API 自动记忆在本机。</span>
                <button
                  type="button"
                  className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
                  onClick={clearModelMemory}
                >
                  清空记忆
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-base-url">Base URL（可选）</Label>
            <Input
              id="p-base-url"
              className="font-mono"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-proxy">代理（可选）</Label>
            <Input
              id="p-proxy"
              className="font-mono"
              placeholder="socks5://user:pass@127.0.0.1:1080 · http://127.0.0.1:8080"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              仅 LLM 出站请求走此代理，支持 http/https/socks5，可带账号密码（如
              socks5://user:pass@host:port，密码含特殊字符需 URL 编码）；留空表示不使用代理（直连）。
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-session-header">自定义会话头（可选）</Label>
            <Input
              id="p-session-header"
              className="font-mono"
              placeholder="如 x-session-id（留空=不发送）"
              value={sessionHeaderKey}
              onChange={(e) => setSessionHeaderKey(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              填写头名后，每次请求都会带上这个 HTTP 头，头值自动填为 <b>当前会话的 session id</b>（chat 会话如
              conv-12、worker 如 exp3-worker-i87）。用于按 session-id 头做提示缓存 /
              粘性路由的网关；同一会话多轮稳定、不同会话互不相同。留空则不发送。
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-api-key">API Key</Label>
            <Input
              id="p-api-key"
              type="password"
              // 空 = 不发送鉴权头，是合法配置（本地网关/公开端点）；这不是错误提示。
              placeholder={keyHint ? `已设置（${keyHint}），留空保持不变` : "留空 = 不带鉴权头（本地网关/公开端点）"}
              value={apiKey}
              aria-invalid={keyFailure !== undefined}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keyFailure ? (
              <p className="text-destructive text-xs" data-testid="profile-key-error" role="alert">
                {keyErrorText}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs" data-testid="profile-key-hint">
                {keyHint
                  ? "已存有 Key：留空保存＝保持不变。"
                  : "可以留空：该配置将不带鉴权头发送（本地网关、公开端点）。空值不算错误，只有格式错才拦。"}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-rps">每秒限速</Label>
              <Input id="p-rps" type="number" min={0} value={rps} onChange={(e) => setRps(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-rpm">每分钟限速</Label>
              <Input id="p-rpm" type="number" min={0} value={rpm} onChange={(e) => setRpm(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-cw">上下文窗口(K)</Label>
              <Input
                id="p-cw"
                type="number"
                min={0}
                max={1000}
                value={cw}
                onChange={(e) => setCw(e.target.value)}
                placeholder="200"
              />
            </div>
          </div>
          <p className="-mt-2 text-muted-foreground text-xs">
            限速 0 = 不限，全 Agent 共享。上下文窗口单位 K（千 token），0 = 默认 200K，上限 1000（即
            1M）；设太高会导致压缩不触发。
          </p>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-priority" className="text-sm">
                  轮询优先级
                </Label>
                <p className="text-muted-foreground text-xs">
                  数字越大越先被选中；激活配置恒为第 1 顺位，与本值无关。相同优先级的配置会轮流打头，天然分摊额度。
                </p>
              </div>
              <Input
                id="p-priority"
                type="number"
                className="w-24 shrink-0"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">不参与轮询</Label>
                <p className="text-muted-foreground text-xs">
                  开启后不会被当作故障转移目标（仍可被 Agent / 任务显式指定使用）。 适合「只给某个 Agent
                  专用、不希望别人失败时烧掉」的昂贵配置。
                </p>
              </div>
              <Switch checked={poolExclude} onCheckedChange={setPoolExclude} aria-label="不参与轮询" />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">流式输出 · streaming</Label>
                <p className="text-muted-foreground text-xs">
                  开启（默认）走流式 SSE，有运行中实时进度与实时 token 计数。 关闭则走真·非流式（stream:false，
                  一次性返回完整响应）——可绕开部分网关糟糕的 SSE 实现（空帧 / 思考字段丢帧），
                  代价是失去运行中的实时进度。
                </p>
              </div>
              <Switch checked={streaming} onCheckedChange={setStreaming} aria-label="流式输出" />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-max-tokens" className="text-sm">
                  输出上限 · max tokens
                </Label>
                <p className="text-muted-foreground text-xs">
                  单次回复最多生成多少 token，随每次请求发出。0（默认）= 不发送该字段，由服务端默认值决定。
                  这与上面的「上下文窗口」是两回事：那是模型总容量，只在本地用来算压缩阈值。
                  设太小会让推理模型在思考阶段就被截断，一个字答案都出不来。
                </p>
              </div>
              <Input
                id="p-max-tokens"
                type="number"
                min={0}
                className="w-28 shrink-0"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">上限字段名</Label>
                <p className="text-muted-foreground text-xs">{MAX_TOKENS_FIELD_HINTS[format]}</p>
              </div>
              <Select
                value={format === "openai" ? maxTokensField : NONE}
                onValueChange={setMaxTokensField}
                disabled={format !== "openai"}
              >
                <SelectTrigger className="w-56 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_TOKENS_FIELDS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label className="text-sm">思考开关 · thinking.type</Label>
                <p className="text-muted-foreground text-xs">
                  控制是否发送 thinking 字段。不发送=不带该字段（兼容 MiniMax 等不支持 的模型）；关闭=发
                  disabled；开启=发 enabled。与下面的强度互相独立。
                </p>
              </div>
              <Select value={thinkingType} onValueChange={setThinkingType}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_TYPES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">思考强度 · reasoning_effort</Label>
                <p className="text-muted-foreground text-xs">
                  独立的强度档位（OpenAI reasoning_effort / Anthropic output_config.effort）。 有些接口没有 thinking
                  字段、只靠强度即可激活思考，故可单独设置、不发送思考开关。
                </p>
              </div>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EFFORT_LEVELS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 每模型声明支持的推理档位（DSH ModelReasoningEfforts.tsx）。
                档位是【模型】的能力，不是 provider 的：同一网关下不同模型接受的档位不一样，
                所以这里声明的是「这个模型能收哪些」，合成器的选档只列这些。 */}
            <div className="grid gap-2 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">该模型支持的推理档位</Label>
                <p className="text-muted-foreground text-xs">
                  勾选这个模型真正接受的档位；合成器的思考档位菜单只列勾选的这些。
                  <b>off</b> 表示关闭思考——选中它时请求体【不带】reasoning_effort。
                  一个都不勾 = 不声明，菜单列出全部档位（历史行为）。
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="该模型支持的推理档位">
                {DECLARABLE_EFFORT_LEVELS.map((level) => {
                  const on = efforts.includes(level.value);
                  return (
                    <button
                      key={level.value}
                      type="button"
                      aria-pressed={on}
                      title={level.hint}
                      data-testid="profile-effort-level"
                      data-level={level.value}
                      data-active={on ? "true" : "false"}
                      onClick={() =>
                        setEfforts((cur) =>
                          cur.includes(level.value) ? cur.filter((v) => v !== level.value) : [...cur, level.value],
                        )
                      }
                      className={cn(
                        "rounded-md border px-2.5 py-1 font-mono text-xs transition-colors",
                        on
                          ? "border-foreground/40 bg-foreground text-background"
                          : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {level.label}
                    </button>
                  );
                })}
              </div>
              {effortsOnlyOff && (
                <p className="text-destructive text-xs" data-testid="profile-effort-error" role="alert">
                  至少添加一个 off 以外的档位；不需要思考请一个都不勾（不声明）。
                </p>
              )}
            </div>
          </div>

          <ProfileRetryFields value={retry} onChange={setRetry} />
        </div>

        <div className="flex gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            {testing ? "测试中…" : "测试连接"}
          </Button>
          <Button onClick={save} disabled={saving || keyFailure !== undefined || effortsOnlyOff} className="flex-1">
            {saving && <Loader2Icon className="animate-spin" />}
            {!saving && (isNew ? <PlusIcon /> : <SaveIcon />)}
            {isNew ? "新建" : "保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LLMPage() {
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [pool, setPool] = React.useState<LLMPoolStatus | null>(null);
  const [poolOpen, setPoolOpen] = React.useState(false);
  // 抽屉的开关和内容分开存：关闭时 editing 保持不变，否则关闭动画期间标题会从
  // 「编辑 X」闪成「新建」。editing = null 表示新建。
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LLMProfile | null>(null);
  const [preset, setPreset] = React.useState<"opencode" | null>(null);
  const openEditor = React.useCallback((p: LLMProfile | null, presetKind: "opencode" | null = null) => {
    setEditing(p);
    setPreset(presetKind);
    setEditOpen(true);
  }, []);

  const loadPool = React.useCallback(async () => {
    try {
      setPool(await api.llmPool());
    } catch {
      /* ignore */
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      setProfiles(await api.llmProfiles());
    } catch {
      /* ignore */
    }
    await loadPool();
  }, [loadPool]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 卡片上的健康徽章按 profile id 取轮询状态。
  const health = React.useMemo(() => {
    const m = new Map<string, LLMPoolMember>();
    for (const c of pool?.chain ?? []) m.set(c.profile_id, c);
    return m;
  }, [pool]);

  async function activate(id: string, name: string) {
    try {
      await api.activateLLMProfile(id);
      toast.success(`已激活：${name}`);
      await load();
    } catch (e) {
      toast.error(`激活失败：${(e as Error).message}`);
    }
  }

  async function remove(p: LLMProfile) {
    if (p.is_default) {
      toast.error("无法删除当前激活的配置");
      return;
    }
    try {
      await api.deleteLLMProfile(p.id);
      toast.success(`已删除：${p.name}`);
      await load();
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  }

  const poolOn = pool?.enabled ?? false;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">LLM</h1>
          <p className="text-muted-foreground text-sm">
            全 Agent 共享的格式 / 模型 / 限速配置。点击卡片编辑，星标为当前激活配置。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPoolOpen(true)}>
            <ZapIcon /> 轮询配置
            {poolOn && (
              <Badge variant="outline" className="ml-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
                已开启
              </Badge>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEditor(null, "opencode")}>
            <SparklesIcon /> OpenCode 免费
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEditor(null)}>
            <PlusIcon /> 新建
          </Button>
        </div>
      </div>

      <Tabs defaultValue="profiles" className="flex-1">
        <TabsList>
          <TabsTrigger value="profiles">模型配置</TabsTrigger>
          <TabsTrigger value="retry">重试与退避</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => {
              const h = healthOf(p, health.get(p.id));
              return (
                // biome-ignore lint/a11y/useSemanticElements: 卡片内含自己的操作按钮，用原生 <button> 会造成按钮嵌套（非法 HTML）
                <Card
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditor(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEditor(p);
                    }
                  }}
                  className={cn(
                    "cursor-pointer gap-0 py-4 outline-none transition-colors hover:border-foreground/30",
                    p.is_default && "border-amber-400/50 bg-amber-400/5",
                  )}
                >
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex items-start gap-2">
                      <StarIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          p.is_default ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">{p.name}</span>
                          <Badge variant="outline" className="uppercase">
                            {p.format}
                          </Badge>
                          <Badge variant="outline" className={cn("ml-auto", h.cls)} title={h.hint}>
                            {h.label}
                          </Badge>
                        </div>
                        <code className="mt-1 block truncate font-mono text-muted-foreground text-xs">{p.model}</code>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-muted-foreground text-xs">
                      {p.api_key_hint ? <span>{p.api_key_hint}</span> : <span>无 Key · 不带鉴权</span>}
                      <span>
                        {p.rate_per_second}/s · {p.rate_per_minute}/min
                      </span>
                      {p.proxy && <span className="truncate">代理 {p.proxy}</span>}
                      {p.reasoning_effort && (
                        <span>思考 {p.reasoning_effort === "off" ? "关" : p.reasoning_effort}</span>
                      )}
                      {(p.reasoning_efforts?.length ?? 0) > 0 && (
                        <span>档位 {p.reasoning_efforts?.join("/")}</span>
                      )}
                      {/* 轮询相关的两个字段只在轮询开着时才有意义，关着时不占版面 */}
                      {poolOn &&
                        !p.is_default &&
                        (p.pool_exclude ? <span>不参与轮询</span> : <span>优先级 {p.priority ?? 0}</span>)}
                    </div>

                    <div className="mt-1 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={p.is_default}
                        onClick={(e) => {
                          e.stopPropagation();
                          void activate(p.id, p.name);
                        }}
                      >
                        {p.is_default ? "已激活" : "设为激活"}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="删除配置"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(p);
                        }}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {profiles.length === 0 && (
              <div className="col-span-full flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center text-muted-foreground text-sm">
                <p>还没有模型配置，点击右上角「新建」创建第一个，或者直接启用 OpenCode 公开免费 API。</p>
                <Button size="sm" variant="outline" onClick={() => openEditor(null, "opencode")}>
                  <SparklesIcon /> OpenCode 公开免费
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="retry" className="mt-4">
          <RetryPolicyPanel />
        </TabsContent>
      </Tabs>

      <ProfileSheet
        profile={editing}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void load()}
        preset={preset}
      />
      <PoolSheet open={poolOpen} onOpenChange={setPoolOpen} pool={pool} onReload={loadPool} />
    </div>
  );
}
