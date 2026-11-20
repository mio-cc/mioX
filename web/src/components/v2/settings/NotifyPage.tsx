"use client";

/**
 * 通知推送页：真实渠道列表（新增/编辑/启停/删除/测试发送）+ 投递记录（筛选/分页/重试）。
 * 数据走 @/v2/data/notify 与 @/v2/data/settings（GET/POST/PATCH/DELETE /notify/**，
 * PUT /settings），交互文案对齐旧页 app/(main)/system/notify/page.tsx 与 delivery-list.tsx。
 *
 * 凭据语义：后端把 secret_keys 的值读成 `__masked__…`；界面不显示掩码原文，
 * 留空提交表示「保持原值」，填入新值才覆盖（api.ts:943）。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { NotificationChannel, NotificationDelivery, NotificationFilter } from "@/lib/types";
import {
  createNotifyChannel,
  deleteNotifyChannel,
  retryNotifyDelivery,
  testNotifyChannel,
  updateNotifyChannel,
  useNotifyChannels,
  useNotifyDeliveries,
  useNotifyMeta,
  type NotifyChannelInput,
} from "@/v2/data/notify";
import { useSettings } from "@/v2/data/settings";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";

/** 渠道类型的展示名；只影响文案。 */
const KIND_LABEL: Record<string, string> = {
  dingtalk: "钉钉",
  feishu: "飞书",
  wecom: "企业微信",
  webhook: "通用 Webhook",
  telegram: "Telegram",
  email: "邮件",
};

type FieldKind = "text" | "password" | "number" | "select" | "textarea" | "switch" | "kv" | "list";
interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  options?: readonly { value: string; label: string }[];
}

/** 各渠道的配置字段（布局与控件类型；必填校验在服务端）。文案照抄旧页。 */
const CHANNEL_FIELDS: Record<string, readonly FieldDef[]> = {
  dingtalk: [
    {
      key: "webhook",
      label: "Webhook 地址",
      kind: "text",
      placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
    },
    {
      key: "secret",
      label: "加签密钥",
      kind: "password",
      help: "机器人安全设置选「加签」时填写；选「自定义关键词」或未开启安全设置则留空",
    },
  ],
  feishu: [
    {
      key: "webhook",
      label: "Webhook 地址",
      kind: "text",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
    },
    { key: "secret", label: "签名校验密钥", kind: "password", help: "机器人开启「签名校验」时填写，否则留空" },
  ],
  wecom: [
    {
      key: "webhook",
      label: "Webhook 地址",
      kind: "text",
      placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
    },
  ],
  webhook: [
    { key: "url", label: "目标 URL", kind: "text", placeholder: "https://your-endpoint.example.com/hook" },
    {
      key: "method",
      label: "请求方法",
      kind: "select",
      options: [
        { value: "POST", label: "POST（带请求体）" },
        { value: "PUT", label: "PUT（带请求体）" },
        { value: "PATCH", label: "PATCH（带请求体）" },
        { value: "GET", label: "GET（不带请求体）" },
      ],
    },
    { key: "headers", label: "自定义请求头", kind: "kv", help: "每行 KEY=VALUE，例如 Authorization=Bearer xxx" },
    {
      key: "body_template",
      label: "请求体模板",
      kind: "textarea",
      help:
        "留空用内置默认模板。变量：{{.Title}} {{.Batch}} {{.Count}} {{.HomeURL}} {{.SentAt}}，" +
        "以及 range .Items 下的 .Name/.VulnClass/.Severity/.Summary/.Assets/.DetailURL/.StatusLabel。" +
        "插入字符串请用 {{json .Xxx}} 而不是 {{.Xxx}}，否则标题里的引号会破坏 JSON。",
    },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token", kind: "password", placeholder: "123456:ABC-DEF..." },
    { key: "chat_id", label: "Chat ID", kind: "text", placeholder: "-1001234567890" },
    {
      key: "base_url",
      label: "API 地址",
      kind: "text",
      placeholder: "https://api.telegram.org",
      help: "留空用官方地址；自建 Bot API 反代时填写",
    },
  ],
  email: [
    { key: "host", label: "SMTP 服务器", kind: "text", placeholder: "smtp.example.com" },
    {
      key: "port",
      label: "端口",
      kind: "number",
      placeholder: "587",
      help: "587 走 STARTTLS；465 请把「隐式 TLS」打开",
    },
    { key: "username", label: "账号", kind: "text" },
    { key: "password", label: "密码 / 授权码", kind: "password" },
    { key: "from", label: "发件人", kind: "text", placeholder: "miox@example.com" },
    { key: "to", label: "收件人", kind: "list", help: "多个地址用逗号分隔" },
    { key: "tls", label: "隐式 TLS", kind: "switch", help: "465 端口打开；587 保持关闭（会自动 STARTTLS）" },
  ],
};

const SEVERITY_OPTIONS = [
  { value: "", label: "不限" },
  { value: "low", label: "低危及以上" },
  { value: "medium", label: "中危及以上" },
  { value: "high", label: "高危及以上" },
  { value: "critical", label: "仅严重" },
] as const;

const MODE_OPTIONS = [
  { value: "realtime", label: "实时推送" },
  { value: "digest", label: "汇总推送" },
] as const;

const STATE_LABEL: Record<string, string> = {
  pending: "待发送",
  sending: "发送中",
  sent: "已送达",
  failed: "失败",
  skipped: "跳过",
};

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const at = trimmed.indexOf("=");
    if (at > 0) out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}

function parseIDs(text: string): number[] {
  return text
    .split(/[\s,，]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,，]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function filterSummary(filter: NotificationFilter): string {
  const parts: string[] = [];
  if (filter.min_severity) {
    parts.push(SEVERITY_OPTIONS.find((option) => option.value === filter.min_severity)?.label ?? filter.min_severity);
  }
  if (filter.vulnclass_include?.length) parts.push(`类型含 ${filter.vulnclass_include.length} 词`);
  if (filter.vulnclass_exclude?.length) parts.push(`排除 ${filter.vulnclass_exclude.length} 词`);
  if (filter.task_ids?.length) parts.push(`${filter.task_ids.length} 个任务`);
  if (filter.asset_ids?.length) parts.push(`${filter.asset_ids.length} 个资产`);
  if (filter.on_status_change) parts.push("含状态变更");
  return parts.length === 0 ? "全部漏洞" : parts.join(" · ");
}

export function NotifyPage(): React.ReactNode {
  const meta = useNotifyMeta();
  const channels = useNotifyChannels();
  const server = useSettings();
  const [editing, setEditing] = React.useState<number | "new" | null>(null);
  const [channelFilter, setChannelFilter] = React.useState("all");
  const [stateFilter, setStateFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const deliveries = useNotifyDeliveries(
    channelFilter === "all" ? undefined : Number(channelFilter),
    stateFilter === "all" ? undefined : stateFilter,
    page,
    pageSize,
  );

  if (meta.phase === "loading" || channels.phase === "loading") return <p className={css.pageLead}>读取通知配置…</p>;
  if (meta.phase === "offline" || channels.phase === "offline") {
    return (
      <>
        <p className={css.pageLead}>未连接后端（读不到通知配置）</p>
        {meta.error === null ? null : <p className={css.errorLine}>{meta.error}</p>}
        {channels.error === null ? null : <p className={css.errorLine}>{channels.error}</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            meta.reload();
            channels.reload();
          }}
        >
          重新读取
        </Button>
      </>
    );
  }

  const info = meta.meta;
  const kinds = info === null || info.kinds.length === 0 ? Object.keys(CHANNEL_FIELDS) : info.kinds.map((kind) => kind.kind);
  const reloadAll = (): void => {
    meta.reload();
    channels.reload();
  };

  return (
    <>
      <h2 className={css.pageTitle}>通知推送</h2>
      <p className={css.pageLead}>
        来自 GET /notify/meta 与 GET /notify/channels，共 {channels.channels.length} 个渠道；投递记录来自 GET
        /notify/deliveries。
      </p>

      <div className={css.channelMeta} data-notify-stats>
        <Tag tone={info?.enabled === true ? "success" : "quiet"}>{info?.enabled === true ? "通知已启用" : "通知未启用"}</Tag>
        <span>渠道 {info?.stats.channels_on ?? 0}/{info?.stats.channels ?? channels.channels.length} 启用</span>
        <span>· 待发送 {info?.stats.pending ?? 0}</span>
        <span>· 失败 {info?.stats.failed ?? 0}</span>
        <span>· 今日已发 {info?.stats.sent_today ?? 0}</span>
        <span>· 积压 {(info?.stats.backlog_age_ms ?? 0) > 0 ? `${Math.round((info?.stats.backlog_age_ms ?? 0) / 1000)}s` : "无"}</span>
      </div>

      <div className={css.group}>
        <div className={css.groupLabel}>总开关与回链</div>
        <div className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowLabel}>启用通知推送</div>
            <div className={css.rowHint}>关闭后所有渠道都停止投递（单个渠道的启停仍单独生效）</div>
          </div>
          <div className={css.rowControl}>
            <Switch
              checked={info?.enabled === true}
              label="启用通知推送"
              disabled={server.phase !== "ready"}
              onChange={(next) => {
                void server.save({ notify_enabled: next }).then((error) => {
                  if (error !== null) toast(`保存失败：${error}`);
                  else toast(next ? "通知已启用" : "通知已停用");
                  reloadAll();
                });
              }}
            />
          </div>
        </div>
        <SettingTextField
          label="回链地址"
          hint="消息里「查看详情」指向的外部访问地址；空=不带回链"
          placeholder="https://miox.example.com"
          initial={info?.public_base_url ?? ""}
          disabled={server.phase !== "ready"}
          apply={(next) => server.save({ notify_public_base_url: next })}
          onSaved={reloadAll}
        />
        <SettingNumberField
          label="汇总周期（分钟）"
          hint="汇总模式渠道的推送周期；后端默认 30 分钟"
          initial={info?.digest_interval_min ?? ""}
          disabled={server.phase !== "ready"}
          apply={(next) => server.save({ notify_digest_interval_min: next })}
          onSaved={reloadAll}
        />
      </div>

      <div className={css.pageToolbar}>
        <Button variant="outline" size="sm" onClick={() => setEditing(editing === "new" ? null : "new")}>
          <IconPlusOutlineRegular size={13} /> 添加渠道
        </Button>
        <Button variant="ghost" size="sm" onClick={reloadAll}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>

      {editing === "new" ? (
        <ChannelEditor
          channel={null}
          kinds={kinds}
          metaRate={info?.kinds[0]?.default_rate_per_min ?? 30}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {channels.channels.length === 0 ? (
        <p className={css.pageLead}>还没有通知渠道；添加一个渠道后漏洞事件才会推送。</p>
      ) : (
        <div className={css.ruleList}>
          {channels.channels.map((channel) =>
            editing === channel.id ? (
              <ChannelEditor
                key={channel.id}
                channel={channel}
                kinds={kinds}
                metaRate={channel.rate_per_min}
                onSaved={() => {
                  setEditing(null);
                  reloadAll();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <ChannelRow key={channel.id} channel={channel} onEdit={() => setEditing(channel.id)} onChanged={reloadAll} />
            ),
          )}
        </div>
      )}

      <div className={css.subSection}>
        <div className={css.subSectionTitle}>投递记录</div>
        <div className={css.filterBar}>
          <SelectMenu
            value={channelFilter}
            options={[
              { value: "all", label: "全部渠道" },
              ...channels.channels.map((channel) => ({ value: String(channel.id), label: channel.name })),
            ]}
            onChange={(value) => {
              setPage(1);
              setChannelFilter(value);
            }}
          />
          <SelectMenu
            value={stateFilter}
            options={[{ value: "all", label: "全部状态" }, ...Object.keys(STATE_LABEL).map((state) => ({ value: state, label: STATE_LABEL[state] }))]}
            onChange={(value) => {
              setPage(1);
              setStateFilter(value);
            }}
          />
          <Button variant="ghost" size="sm" onClick={deliveries.reload}>
            <IconRefreshOutlineRegular size={13} /> 刷新
          </Button>
          <span className={css.deliveryTime}>共 {deliveries.total} 条</span>
        </div>
        {deliveries.phase === "offline" ? (
          <p className={css.errorLine}>读取投递记录失败：{deliveries.error}</p>
        ) : null}
        <div className={css.deliveryList}>
          {deliveries.rows.length === 0 ? (
            <p className={css.pageLead}>{deliveries.phase === "loading" ? "加载中…" : "暂无投递记录"}</p>
          ) : (
            deliveries.rows.map((delivery) => (
              <DeliveryRow key={delivery.id} delivery={delivery} onRetried={deliveries.reload} />
            ))
          )}
        </div>
        {deliveries.total > pageSize ? (
          <div className={css.pager}>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
              上一页
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(deliveries.total / pageSize))}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.max(1, Math.ceil(deliveries.total / pageSize))}
              onClick={() => setPage((prev) => prev + 1)}
            >
              下一页
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** 渠道行：类型/时机/限流 + 编辑/启停/测试/删除。 */
function ChannelRow({
  channel,
  onEdit,
  onChanged,
}: {
  channel: NotificationChannel;
  onEdit: () => void;
  onChanged: () => void;
}): React.ReactNode {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const toggle = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void updateNotifyChannel(channel.id, { enabled: next })
      .then(() => {
        toast(next ? "渠道已启用" : "渠道已停用");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteNotifyChannel(channel.id)
      .then(() => {
        toast("渠道已删除");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  const test = (): void => {
    setBusy(true);
    setTestResult(null);
    setFailure(null);
    void testNotifyChannel(channel.id)
      .then((result) => setTestResult(result.ok ? `测试消息已发送（延迟 ${result.latency_ms}ms）` : "测试发送未成功"))
      .catch((reason: unknown) => setTestResult(`测试失败：${reason instanceof Error ? reason.message : String(reason)}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className={css.channelRow} data-channel-id={channel.id} data-channel-enabled={channel.enabled}>
      <div className={css.channelHead}>
        <div className={css.ruleMain}>
          <div className={css.ruleMeta}>
            <span className={css.rowLabel}>{channel.name}</span>
            <Tag tone={channel.enabled ? "success" : "quiet"}>{channel.enabled ? "已启用" : "已停用"}</Tag>
            <Tag tone="outline">{KIND_LABEL[channel.kind] ?? channel.kind}</Tag>
            <Tag tone="neutral">{channel.mode === "digest" ? "汇总" : "实时"}</Tag>
          </div>
          <div className={css.channelMeta}>
            <span>限流 {channel.rate_per_min}/分钟</span>
            <span>· 过滤：{filterSummary(channel.filter)}</span>
            {channel.secret_keys.length > 0 ? <span>· 凭据 {channel.secret_keys.length} 项（不回显）</span> : null}
          </div>
        </div>
        <div className={css.ruleActions}>
          <Switch checked={channel.enabled} label={`启用渠道 ${channel.name}`} disabled={busy} onChange={toggle} />
          <Button variant="outline" size="sm" disabled={busy} onClick={test}>
            测试发送
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
            编辑
          </Button>
          {confirming ? (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
                <IconTrashOutlineRegular size={13} /> 确认删除
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                取消
              </Button>
            </>
          ) : (
            <button type="button" className={css.dangerBtn} disabled={busy} onClick={() => setConfirming(true)}>
              删除
            </button>
          )}
        </div>
      </div>
      {testResult === null ? null : <p className={css.fieldHint}>{testResult}</p>}
      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
    </div>
  );
}

function DeliveryRow({
  delivery,
  onRetried,
}: {
  delivery: NotificationDelivery;
  onRetried: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const retryable = delivery.state === "failed" || delivery.state === "skipped";

  const retry = (): void => {
    setBusy(true);
    setFailure(null);
    void retryNotifyDelivery(delivery.id)
      .then(() => {
        toast("已重新入队");
        onRetried();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={css.deliveryRow} data-delivery-id={delivery.id} data-delivery-state={delivery.state}>
      <span className={css.deliveryTime}>{formatTime(delivery.created_at)}</span>
      <Tag tone={delivery.state === "failed" ? "danger" : delivery.state === "sent" ? "success" : "outline"}>
        {STATE_LABEL[delivery.state] ?? delivery.state}
      </Tag>
      <span className={css.deliveryTitle} title={delivery.title}>
        {delivery.title || "（无标题）"}
      </span>
      <span className={css.deliveryTime}>{delivery.channel_name}</span>
      <span className={css.deliveryTime}>尝试 {delivery.attempts}</span>
      {delivery.last_error === "" ? null : <span className={css.deliveryError} title={delivery.last_error}>{delivery.last_error}</span>}
      {retryable ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={retry}>
          重试
        </Button>
      ) : null}
      {failure === null ? null : <span className={css.errorLine}>{failure}</span>}
    </div>
  );
}

/** 渠道新建/编辑表单：配置字段随 kind 变化，凭据留空即保持原值。 */
function ChannelEditor({
  channel,
  kinds,
  metaRate,
  onSaved,
  onCancel,
}: {
  channel: NotificationChannel | null;
  kinds: string[];
  metaRate: number;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const [name, setName] = React.useState(channel?.name ?? "");
  const [kind, setKind] = React.useState(channel?.kind ?? kinds[0] ?? "webhook");
  const [mode, setMode] = React.useState(channel?.mode ?? "realtime");
  const [enabled, setEnabled] = React.useState(channel?.enabled ?? true);
  const [rate, setRate] = React.useState(String(channel?.rate_per_min ?? metaRate));
  const [texts, setTexts] = React.useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const field of CHANNEL_FIELDS[channel?.kind ?? kinds[0] ?? "webhook"] ?? []) {
      const raw = asText(channel?.config[field.key]);
      // 掩码值不落进输入框：留空即表示保持原值。
      next[field.key] = field.kind === "switch" || raw.startsWith("__masked__") ? "" : raw;
      // 新建渠道时下拉框给出字段定义里的首个选项，避免提交空方法。
      if (next[field.key] === "" && field.kind === "select") next[field.key] = field.options?.[0]?.value ?? "";
    }
    return next;
  });
  const [bools, setBools] = React.useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    for (const field of CHANNEL_FIELDS[channel?.kind ?? kinds[0] ?? "webhook"] ?? []) {
      if (field.kind === "switch") next[field.key] = channel?.config[field.key] === true;
    }
    return next;
  });
  const [minSeverity, setMinSeverity] = React.useState(channel?.filter.min_severity ?? "");
  const [includeText, setIncludeText] = React.useState((channel?.filter.vulnclass_include ?? []).join(", "));
  const [excludeText, setExcludeText] = React.useState((channel?.filter.vulnclass_exclude ?? []).join(", "));
  const [taskIDsText, setTaskIDsText] = React.useState((channel?.filter.task_ids ?? []).join(", "));
  const [assetIDsText, setAssetIDsText] = React.useState((channel?.filter.asset_ids ?? []).join(", "));
  const [onStatusChange, setOnStatusChange] = React.useState(channel?.filter.on_status_change === true);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const kindChoices = kinds.length === 0 ? ["webhook"] : kinds;
  const fields = CHANNEL_FIELDS[kind] ?? [];
  const secretKeys = new Set(channel?.kind === kind ? channel.secret_keys : []);
  for (const field of fields) if (field.kind === "password") secretKeys.add(field.key);

  /** 切换类型时按新类型重建配置草稿（避免把旧类型的字段带过去）。 */
  const changeKind = (next: string): void => {
    setKind(next);
    const nextTexts: Record<string, string> = {};
    const nextBools: Record<string, boolean> = {};
    for (const field of CHANNEL_FIELDS[next] ?? []) {
      nextTexts[field.key] = field.kind === "select" ? (field.options?.[0]?.value ?? "") : "";
      if (field.kind === "switch") nextBools[field.key] = false;
    }
    setTexts(nextTexts);
    setBools(nextBools);
  };

  const buildConfig = (): Record<string, unknown> => {
    const config: Record<string, unknown> = channel === null ? {} : { ...channel.config };
    for (const field of fields) {
      const text = (texts[field.key] ?? "").trim();
      if (field.kind === "switch") {
        config[field.key] = bools[field.key] === true;
        continue;
      }
      if (secretKeys.has(field.key) && text === "") continue; // 留空 = 保持原值（含掩码）
      switch (field.kind) {
        case "number": {
          if (text === "") break;
          const parsed = Number(text);
          if (Number.isFinite(parsed)) config[field.key] = parsed;
          break;
        }
        case "list":
          config[field.key] = text === "" ? [] : parseKeywords(text);
          break;
        case "kv":
          config[field.key] = text === "" ? {} : parseKV(text);
          break;
        default:
          config[field.key] = text;
      }
    }
    return config;
  };

  const save = (): void => {
    if (name.trim() === "") {
      setFailure("渠道名称不能为空。");
      return;
    }
    const filter: NotificationFilter = { on_status_change: onStatusChange };
    if (minSeverity !== "") filter.min_severity = minSeverity;
    const include = parseKeywords(includeText);
    if (include.length > 0) filter.vulnclass_include = include;
    const exclude = parseKeywords(excludeText);
    if (exclude.length > 0) filter.vulnclass_exclude = exclude;
    const taskIDs = parseIDs(taskIDsText);
    if (taskIDs.length > 0) filter.task_ids = taskIDs;
    const assetIDs = parseIDs(assetIDsText);
    if (assetIDs.length > 0) filter.asset_ids = assetIDs;
    const ratePerMin = Number.parseInt(rate, 10);
    const input: NotifyChannelInput = {
      name: name.trim(),
      kind,
      mode,
      enabled,
      config: buildConfig(),
      filter,
      rate_per_min: Number.isFinite(ratePerMin) && ratePerMin > 0 ? ratePerMin : metaRate,
    };
    setSaving(true);
    setFailure(null);
    const write = channel === null ? createNotifyChannel(input) : updateNotifyChannel(channel.id, input);
    void write
      .then(() => {
        toast(channel === null ? "通知渠道已创建" : "通知渠道已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={css.formCard}>
      <div className={css.subTitle}>{channel === null ? "添加通知渠道" : `编辑渠道 · ${channel.name}`}</div>
      <label className={css.fieldLabel}>
        名称
        <input
          className={css.textField}
          aria-label="渠道名称"
          placeholder="给渠道起个名字"
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <div className={css.formRow}>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>类型</div>
          <SelectMenu
            value={kind}
            options={kindChoices.map((value) => ({ value, label: KIND_LABEL[value] ?? value }))}
            disabled={saving || channel !== null}
            onChange={changeKind}
          />
        </div>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>推送时机</div>
          <SelectMenu
            value={mode}
            options={MODE_OPTIONS}
            disabled={saving}
            onChange={(value) => setMode(value === "digest" ? "digest" : "realtime")}
          />
        </div>
        <label className={css.fieldLabel}>
          限流（条/分钟）
          <input
            className={css.textField}
            type="number"
            aria-label="限流每分钟"
            min={1}
            value={rate}
            disabled={saving}
            onChange={(event) => setRate(event.currentTarget.value)}
          />
        </label>
      </div>

      {fields.length === 0 ? (
        <p className={css.pageLead}>后端未声明该渠道类型的配置字段。</p>
      ) : (
        <>
          <div className={css.subSectionTitle}>渠道配置</div>
          {fields.map((field) => {
            if (field.kind === "switch") {
              return (
                <div key={field.key} className={css.checkInline}>
                  <Switch
                    checked={bools[field.key] === true}
                    label={field.label}
                    disabled={saving}
                    onChange={(next) => setBools((prev) => ({ ...prev, [field.key]: next }))}
                  />
                  <span>{field.label}</span>
                  {field.help ? <span className={css.fieldHint}>（{field.help}）</span> : null}
                </div>
              );
            }
            const secretField = secretKeys.has(field.key);
            const masked = secretField && asText(channel?.config[field.key]).startsWith("__masked__") && (texts[field.key] ?? "") === "";
            return (
              <label key={field.key} className={css.fieldLabel}>
                {field.label}
                {field.kind === "select" ? (
                  <SelectMenu
                    value={texts[field.key] ?? field.options?.[0]?.value ?? ""}
                    options={field.options ?? []}
                    disabled={saving}
                    onChange={(value) => setTexts((prev) => ({ ...prev, [field.key]: value }))}
                  />
                ) : field.kind === "textarea" || field.kind === "kv" ? (
                  <textarea
                    className={css.textArea}
                    aria-label={field.label}
                    rows={field.kind === "kv" ? 3 : 4}
                    placeholder={field.placeholder}
                    value={texts[field.key] ?? ""}
                    disabled={saving}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTexts((prev) => ({ ...prev, [field.key]: next }));
                    }}
                  />
                ) : (
                  <input
                    className={css.textField}
                    aria-label={field.label}
                    type={secretField ? "password" : field.kind === "number" ? "number" : "text"}
                    autoComplete={secretField ? "new-password" : "off"}
                    placeholder={masked ? "已保存（不回显）；留空保持不变" : field.placeholder}
                    value={texts[field.key] ?? ""}
                    disabled={saving}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTexts((prev) => ({ ...prev, [field.key]: next }));
                    }}
                  />
                )}
                {masked ? (
                  <p className={css.fieldHint}>已保存凭据（不回显）；留空保持不变，填入新值即覆盖。</p>
                ) : field.help ? (
                  <p className={css.fieldHint}>{field.help}</p>
                ) : null}
              </label>
            );
          })}
        </>
      )}

      <div className={css.subSectionTitle}>过滤规则</div>
      <div className={css.formRow}>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>最低严重度</div>
          <SelectMenu
            value={minSeverity}
            options={SEVERITY_OPTIONS}
            disabled={saving}
            onChange={(value) => setMinSeverity(value)}
          />
        </div>
        <label className={css.fieldLabel}>
          类型包含（关键词，逗号/换行分隔）
          <input
            className={css.textField}
            aria-label="类型包含关键词"
            value={includeText}
            disabled={saving}
            onChange={(event) => setIncludeText(event.currentTarget.value)}
          />
        </label>
        <label className={css.fieldLabel}>
          类型排除
          <input
            className={css.textField}
            aria-label="类型排除关键词"
            value={excludeText}
            disabled={saving}
            onChange={(event) => setExcludeText(event.currentTarget.value)}
          />
        </label>
      </div>
      <div className={css.formRow}>
        <label className={css.fieldLabel}>
          任务 ID（空=不限）
          <input
            className={css.textField}
            aria-label="任务ID过滤"
            value={taskIDsText}
            disabled={saving}
            onChange={(event) => setTaskIDsText(event.currentTarget.value)}
          />
        </label>
        <label className={css.fieldLabel}>
          资产 ID（空=不限）
          <input
            className={css.textField}
            aria-label="资产ID过滤"
            value={assetIDsText}
            disabled={saving}
            onChange={(event) => setAssetIDsText(event.currentTarget.value)}
          />
        </label>
      </div>
      <div className={css.checkInline}>
        <Switch
          checked={onStatusChange}
          label="接收漏洞状态变更"
          disabled={saving}
          onChange={(next) => setOnStatusChange(next)}
        />
        <span>也接收漏洞处置状态变更事件</span>
      </div>
      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Switch checked={enabled} label="启用渠道" disabled={saving} onChange={(next) => setEnabled(next)} />
        <span>保存后立即生效</span>
      </div>

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

/** 文本设置行：初值来自 GET /notify/meta，保存写回 PUT /settings。 */
function SettingTextField({
  label,
  hint,
  placeholder,
  initial,
  disabled,
  apply,
  onSaved,
}: {
  label: string;
  hint: string;
  placeholder: string;
  initial: string;
  disabled: boolean;
  apply: (next: string) => Promise<string | null>;
  onSaved: () => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(initial), [initial]);
  return (
    <div className={css.block}>
      <div className={css.rowLabel}>{label}</div>
      <div className={css.rowHint}>{hint}</div>
      <div className={css.blockControl}>
        <input
          className={css.textField}
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          disabled={disabled || saving}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || saving}
          onClick={() => {
            setSaving(true);
            setFailure(null);
            void apply(draft.trim())
              .then((error) => {
                if (error !== null) return setFailure(error);
                toast(`${label}已保存`);
                onSaved();
              })
              .finally(() => setSaving(false));
          }}
        >
          保存
        </Button>
      </div>
      {failure === null ? null : <p className={css.errorLine}>保存失败：{failure}</p>}
    </div>
  );
}

/** 数字设置行：写回 PUT /settings，非数字不发请求。 */
function SettingNumberField({
  label,
  hint,
  initial,
  disabled,
  apply,
  onSaved,
}: {
  label: string;
  hint: string;
  initial: string;
  disabled: boolean;
  apply: (next: number) => Promise<string | null>;
  onSaved: () => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(initial), [initial]);
  return (
    <div className={css.block}>
      <div className={css.rowLabel}>{label}</div>
      <div className={css.rowHint}>{hint}</div>
      <div className={css.blockControl}>
        <input
          className={css.textField}
          type="number"
          aria-label={label}
          value={draft}
          disabled={disabled || saving}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || saving}
          onClick={() => {
            const parsed = Number.parseInt(draft, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              setFailure("必须是正整数（分钟）。");
              return;
            }
            setSaving(true);
            setFailure(null);
            void apply(parsed)
              .then((error) => {
                if (error !== null) return setFailure(error);
                toast(`${label}已保存`);
                onSaved();
              })
              .finally(() => setSaving(false));
          }}
        >
          保存
        </Button>
      </div>
      {failure === null ? null : <p className={css.errorLine}>保存失败：{failure}</p>}
    </div>
  );
}
