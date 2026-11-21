"use client";

/**
 * 通知推送页：真实渠道列表（新增/编辑/启停/删除/测试发送）+ 投递记录（筛选/分页/重试）。
 * 数据走 @/v2/data/notify 与 @/v2/data/settings（GET/POST/PATCH/DELETE /notify/**，
 * PUT /settings），交互文案对齐旧页 app/(main)/system/notify/page.tsx 与 delivery-list.tsx。
 *
 * 凭据语义：后端把 secret_keys 的值读成 `__masked__…`；界面不显示掩码原文，
 * 留空提交表示「保持原值」，填入新值才覆盖（api.ts:943）。
 *
 * 版式（D3 设计重塑）：SettingsPage → PageHead（状态徽标 + 刷新）→ 指标格 →
 * 「总开关与回链」Card+Row → 「渠道」每个渠道一张 Card（类型字形 · 名称 · 目标/时机/过滤元信息 ·
 * 启用开关 · ⋯ 菜单：测试发送/编辑/删除），编辑在卡内展开为 kit Editor，末尾虚线位添加渠道 →
 * 「投递记录」筛选下拉在节头，卡内一行一条，分页在卡下。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconLinkOutlineRegular,
  IconMailUnreadOutlineRegular,
  IconPaperPlaneOutlineRegular,
  IconPlusOutlineRegular,
  IconQueueOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import {
  AddSlot,
  AddSlots,
  Badge,
  Card,
  Dot,
  Editor,
  EditorActions,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  type KitTone,
  Meta,
  Metrics,
  Notice,
  PageHead,
  Row,
  Section,
  SettingsPage,
  Skeleton,
  TextInput,
  Tile,
  UnitInput,
} from "@/components/v2/design/Kit";
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
import { errorText, RefreshButton, RowMenu } from "./InterceptAdvanced";
import shared from "./SettingsDialog.module.css";
import own from "./NotifyPage.module.css";

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

const STATE_TONE: Record<string, KitTone> = {
  pending: "neutral",
  sending: "info",
  sent: "success",
  failed: "danger",
  skipped: "warning",
};

/** 渠道类型字形：国内 IM 用首字，其余用图标。 */
function KindGlyph({ kind }: { kind: string }): React.ReactNode {
  let glyph: React.ReactNode;
  if (kind === "webhook") glyph = <IconLinkOutlineRegular size={15} />;
  else if (kind === "telegram") glyph = <IconPaperPlaneOutlineRegular size={15} />;
  else if (kind === "email") glyph = <IconMailUnreadOutlineRegular size={15} />;
  else glyph = <span className={own.glyph}>{(KIND_LABEL[kind] ?? kind).trim().slice(0, 1).toUpperCase()}</span>;
  return <Tile>{glyph}</Tile>;
}

/** 渠道的投递目标摘要：只显示非凭据的地址类字段（主机名或收件人）。 */
function channelTarget(channel: NotificationChannel): string | null {
  const pick = (key: string): string => {
    const raw = asText(channel.config[key]);
    return raw.startsWith("__masked__") ? "" : raw.trim();
  };
  const url = pick("webhook") || pick("url");
  if (url !== "") {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
      // 不是绝对 URL：原样显示。
      return url;
    }
  }
  if (channel.kind === "telegram") return pick("chat_id") === "" ? null : `chat ${pick("chat_id")}`;
  if (channel.kind === "email") {
    const to = channel.config.to;
    if (Array.isArray(to) && to.length > 0) return to.map(asText).join(", ");
    const host = pick("host");
    return host === "" ? null : host;
  }
  return null;
}

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

  const reloadAll = (): void => {
    meta.reload();
    channels.reload();
  };
  const head = (adornment?: React.ReactNode): React.ReactNode => (
    <PageHead
      title="通知推送"
      lead="发现漏洞或状态变更时，按渠道推送到钉钉、飞书、企业微信、Telegram、邮件或任意 Webhook。"
      adornment={adornment}
      actions={<RefreshButton onClick={reloadAll} spinning={meta.phase === "loading" || channels.phase === "loading"} />}
    />
  );

  if (meta.phase === "loading" || channels.phase === "loading") {
    return (
      <SettingsPage data={{ "data-settings-notify": "loading" }}>
        {head()}
        <Card>
          <Skeleton label="读取通知配置" />
        </Card>
      </SettingsPage>
    );
  }
  if (meta.phase === "offline" || channels.phase === "offline") {
    return (
      <SettingsPage data={{ "data-settings-notify": "offline" }}>
        {head()}
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={reloadAll}>重新读取</Button>}>
          未连接后端（读不到通知配置）
          {meta.error === null ? null : <div>{meta.error}</div>}
          {channels.error === null ? null : <div>{channels.error}</div>}
        </Notice>
      </SettingsPage>
    );
  }

  const info = meta.meta;
  const kinds = info === null || info.kinds.length === 0 ? Object.keys(CHANNEL_FIELDS) : info.kinds.map((kind) => kind.kind);
  const stats = info?.stats;
  const backlog = stats?.backlog_age_ms ?? 0;
  const pageCount = Math.max(1, Math.ceil(deliveries.total / pageSize));

  return (
    <SettingsPage data={{ "data-settings-notify": "ready" }}>
      {head(
        info?.enabled === true ? (
          <Badge tone="success">
            <Dot tone="success" />
            已启用
          </Badge>
        ) : (
          <Badge>未启用</Badge>
        ),
      )}

      <div data-notify-stats="">
        <Metrics
          items={[
            {
              key: "channels",
              label: "启用渠道",
              value: `${stats?.channels_on ?? 0}/${stats?.channels ?? channels.channels.length}`,
              muted: (stats?.channels_on ?? 0) === 0,
            },
            { key: "sent", label: "今日已发", value: stats?.sent_today ?? 0, muted: (stats?.sent_today ?? 0) === 0 },
            {
              key: "pending",
              label: "待发送",
              value: stats?.pending ?? 0,
              foot: `积压 ${backlog > 0 ? `${Math.round(backlog / 1000)}s` : "无"}`,
              tone: backlog > 0 ? "warning" : undefined,
              muted: (stats?.pending ?? 0) === 0,
            },
            {
              key: "failed",
              label: "失败",
              value: stats?.failed ?? 0,
              tone: (stats?.failed ?? 0) > 0 ? "danger" : undefined,
              muted: (stats?.failed ?? 0) === 0,
            },
          ]}
        />
      </div>

      <Section title="总开关与回链">
        <Card>
          <Row label="启用通知推送" description="关闭后所有渠道都停止投递；单个渠道的启停仍单独生效。">
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
          </Row>
          <SettingTextField
            label="回链地址"
            hint="消息里「查看详情」指向的外部访问地址；留空则不带回链。"
            placeholder="https://miox.example.com"
            initial={info?.public_base_url ?? ""}
            disabled={server.phase !== "ready"}
            apply={(next) => server.save({ notify_public_base_url: next })}
            onSaved={reloadAll}
          />
          <SettingNumberField
            label="汇总周期"
            hint="汇总模式渠道的推送周期；后端默认 30 分钟。"
            initial={info?.digest_interval_min ?? ""}
            disabled={server.phase !== "ready"}
            apply={(next) => server.save({ notify_digest_interval_min: next })}
            onSaved={reloadAll}
          />
        </Card>
      </Section>

      <Section
        title="渠道"
        count={channels.channels.length === 0 ? undefined : channels.channels.length}
        hint={channels.channels.length === 0 ? undefined : "每个渠道独立启停、限流与过滤"}
      >
        {channels.channels.length === 0 && editing !== "new" ? (
          <Card>
            <Empty
              inCard
              icon={<IconPaperPlaneOutlineRegular size={18} />}
              title="还没有通知渠道"
              text="添加一个渠道后，漏洞事件才会推送出去。"
            />
          </Card>
        ) : null}
        {channels.channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            open={editing === channel.id}
            kinds={kinds}
            onToggleEdit={() => setEditing(editing === channel.id ? null : channel.id)}
            onSaved={() => {
              setEditing(null);
              reloadAll();
            }}
            onChanged={reloadAll}
          />
        ))}
        {editing === "new" ? (
          <Card selected data={{ "data-channel-new": "" }}>
            <Row lead={<Tile><IconPlusOutlineRegular size={15} /></Tile>} label="添加通知渠道" description="选择类型并填写连接信息，保存后即可测试发送。" />
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
          </Card>
        ) : (
          <AddSlots>
            <AddSlot data={{ "data-channel-add": "" }} onClick={() => setEditing("new")}>
              <IconPlusOutlineRegular size={13} /> 添加渠道
            </AddSlot>
          </AddSlots>
        )}
      </Section>

      <Section
        title="投递记录"
        count={deliveries.total}
        actions={
          <>
            <span className={own.filterSelect}>
              <SelectMenu
                value={channelFilter}
                ariaLabel="按渠道筛选投递记录"
                options={[
                  { value: "all", label: "全部渠道" },
                  ...channels.channels.map((channel) => ({ value: String(channel.id), label: channel.name })),
                ]}
                onChange={(value) => {
                  setPage(1);
                  setChannelFilter(value);
                }}
              />
            </span>
            <span className={own.filterSelect}>
              <SelectMenu
                value={stateFilter}
                ariaLabel="按状态筛选投递记录"
                options={[{ value: "all", label: "全部状态" }, ...Object.keys(STATE_LABEL).map((state) => ({ value: state, label: STATE_LABEL[state] }))]}
                onChange={(value) => {
                  setPage(1);
                  setStateFilter(value);
                }}
              />
            </span>
            <RefreshButton label="刷新投递记录" onClick={deliveries.reload} spinning={deliveries.phase === "loading"} />
          </>
        }
      >
        {deliveries.phase === "offline" ? <Notice tone="danger">读取投递记录失败：{deliveries.error}</Notice> : null}
        <Card data={{ "data-notify-deliveries": deliveries.phase }}>
          {deliveries.rows.length === 0 ? (
            deliveries.phase === "loading" ? (
              <Skeleton label="读取投递记录" />
            ) : (
              <Empty
                inCard
                icon={<IconQueueOutlineRegular size={18} />}
                title="暂无投递记录"
                text={channelFilter === "all" && stateFilter === "all" ? "渠道推送过消息后，每次投递的结果都会记在这里。" : "当前筛选下没有记录。"}
              />
            )
          ) : (
            deliveries.rows.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} onRetried={deliveries.reload} />)
          )}
        </Card>
        {deliveries.total > pageSize ? (
          <div className={own.pager}>
            <span>
              第 {page} / {pageCount} 页
            </span>
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
              上一页
            </Button>
            <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((prev) => prev + 1)}>
              下一页
            </Button>
          </div>
        ) : null}
      </Section>
    </SettingsPage>
  );
}

/** 渠道卡：一行摘要（类型字形 · 名称 · 目标/时机/过滤 · 启用开关 · ⋯ 菜单），编辑时卡内展开。 */
function ChannelCard({
  channel,
  open,
  kinds,
  onToggleEdit,
  onSaved,
  onChanged,
}: {
  channel: NotificationChannel;
  open: boolean;
  kinds: string[];
  onToggleEdit: () => void;
  onSaved: () => void;
  onChanged: () => void;
}): React.ReactNode {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void updateNotifyChannel(channel.id, { enabled: next })
      .then(() => {
        toast(next ? "渠道已启用" : "渠道已停用");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteNotifyChannel(channel.id)
      .then(() => {
        toast("渠道已删除");
        setConfirming(false);
        onChanged();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  const test = (): void => {
    setBusy(true);
    setTestResult(null);
    setFailure(null);
    void testNotifyChannel(channel.id)
      .then((result) =>
        setTestResult(result.ok ? { ok: true, text: `测试消息已发送（延迟 ${result.latency_ms}ms）` } : { ok: false, text: "测试发送未成功" }),
      )
      .catch((reason: unknown) => setTestResult({ ok: false, text: `测试失败：${errorText(reason)}` }))
      .finally(() => setBusy(false));
  };

  const target = channelTarget(channel);

  return (
    <Card selected={open} data={{ "data-channel-id": String(channel.id), "data-channel-enabled": String(channel.enabled) }}>
      <Row
        lead={<KindGlyph kind={channel.kind} />}
        label={<span className={channel.enabled ? undefined : own.labelOff}>{channel.name}</span>}
        labelAdornment={
          <>
            <Badge>{KIND_LABEL[channel.kind] ?? channel.kind}</Badge>
            <Badge tone={channel.mode === "digest" ? "info" : "neutral"}>{channel.mode === "digest" ? "汇总" : "实时"}</Badge>
          </>
        }
        description={
          <Meta
            items={[
              target === null ? null : (
                <span key="target" className={own.target} title={target}>
                  {target}
                </span>
              ),
              `${channel.rate_per_min} 条/分`,
              <span key="filter" className={own.clip} title={filterSummary(channel.filter)}>
                {filterSummary(channel.filter)}
              </span>,
              channel.secret_keys.length > 0 ? `凭据 ${channel.secret_keys.length} 项` : null,
            ]}
          />
        }
      >
        <Switch checked={channel.enabled} label={`启用渠道 ${channel.name}`} disabled={busy} onChange={toggle} />
        <RowMenu
          label={`渠道 ${channel.name} 的更多操作`}
          disabled={busy}
          data={{ "data-channel-more": String(channel.id) }}
          items={[
            { label: busy ? "测试中…" : "测试发送", onSelect: test, data: { "data-channel-test": String(channel.id) } },
            { label: open ? "收起编辑" : "编辑", onSelect: onToggleEdit, data: { "data-channel-edit": String(channel.id) } },
            {
              label: "删除",
              onSelect: () => setConfirming(true),
              danger: true,
              separatorBefore: true,
              data: { "data-channel-delete": String(channel.id) },
            },
          ]}
        />
      </Row>
      {testResult === null && failure === null ? null : (
        <div className={own.cardNotice}>
          {testResult === null ? null : <Notice tone={testResult.ok ? "success" : "danger"}>{testResult.text}</Notice>}
          {failure === null ? null : <Notice tone="danger">操作失败：{failure}</Notice>}
        </div>
      )}
      {open ? <ChannelEditor channel={channel} kinds={kinds} metaRate={channel.rate_per_min} onSaved={onSaved} onCancel={onToggleEdit} /> : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="删除通知渠道"
        closeLabel="关闭"
        tone="warning"
        description={`将永久删除渠道「${channel.name}」，此操作不可撤销；之后的漏洞事件不再推送到这里。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={remove} data-channel-delete-confirm="">
              {busy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={own.dialogStack}>
          <div className={own.targetBox}>
            <KindGlyph kind={channel.kind} />
            <span>{channel.name}</span>
          </div>
          {failure === null ? null : <Notice tone="danger">删除失败：{failure}</Notice>}
        </div>
      </Modal>
    </Card>
  );
}

/** 投递记录一行：状态点 · 标题 · 渠道/时间/尝试次数/错误 · 失败可重试。 */
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
  const tone = STATE_TONE[delivery.state] ?? "neutral";

  const retry = (): void => {
    setBusy(true);
    setFailure(null);
    void retryNotifyDelivery(delivery.id)
      .then(() => {
        toast("已重新入队");
        onRetried();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      data={{ "data-delivery-id": String(delivery.id), "data-delivery-state": delivery.state }}
      lead={<Dot tone={tone} pulse={delivery.state === "sending"} />}
      label={<span title={delivery.title}>{delivery.title || "（无标题）"}</span>}
      labelAdornment={<Badge tone={tone}>{STATE_LABEL[delivery.state] ?? delivery.state}</Badge>}
      description={
        <>
          <Meta
            items={[
              delivery.channel_name,
              <span key="time" className={own.tabular}>
                {formatTime(delivery.created_at)}
              </span>,
              <span key="attempts" className={own.tabular}>
                尝试 {delivery.attempts}
              </span>,
              delivery.last_error === "" ? null : (
                <span key="error" className={own.errorClip} title={delivery.last_error}>
                  {delivery.last_error}
                </span>
              ),
            ]}
          />
          {failure === null ? null : <span className={own.rowError}>重试失败：{failure}</span>}
        </>
      }
    >
      {retryable ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={retry} data-delivery-retry="">
          {busy ? "入队中…" : "重试"}
        </Button>
      ) : null}
    </Row>
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
  const uid = React.useId();
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
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <Editor inCard data={{ "data-channel-editor": channel === null ? "new" : String(channel.id) }}>
      <EditorGroup title="基本">
        <FieldGrid>
          <Field label="名称" htmlFor={`${uid}-name`}>
            <TextInput
              id={`${uid}-name`}
              aria-label="渠道名称"
              placeholder="给渠道起个名字"
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <Field label="类型" htmlFor={`${uid}-kind`} hint={channel === null ? undefined : "已创建的渠道不能改类型"}>
            <SelectMenu
              id={`${uid}-kind`}
              value={kind}
              ariaLabel="渠道类型"
              options={kindChoices.map((value) => ({ value, label: KIND_LABEL[value] ?? value }))}
              disabled={saving || channel !== null}
              onChange={changeKind}
            />
          </Field>
          <Field label="推送时机" htmlFor={`${uid}-mode`} hint="汇总模式按「汇总周期」合并推送">
            <SelectMenu
              id={`${uid}-mode`}
              value={mode}
              ariaLabel="推送时机"
              options={MODE_OPTIONS}
              disabled={saving}
              onChange={(value) => setMode(value === "digest" ? "digest" : "realtime")}
            />
          </Field>
          <Field label="限流" htmlFor={`${uid}-rate`}>
            <UnitInput unit="条/分">
              <TextInput
                id={`${uid}-rate`}
                className={shared.numberInputKit}
                type="number"
                aria-label="限流每分钟"
                min={1}
                value={rate}
                disabled={saving}
                onChange={(event) => setRate(event.currentTarget.value)}
              />
            </UnitInput>
          </Field>
        </FieldGrid>
      </EditorGroup>

      <EditorGroup title="连接">
        {fields.length === 0 ? (
          <Notice tone="warning">后端未声明该渠道类型的配置字段。</Notice>
        ) : (
          <>
            <FieldGrid>
              {fields
                .filter((field) => field.kind !== "switch")
                .map((field) => {
                  const secretField = secretKeys.has(field.key);
                  const masked = secretField && asText(channel?.config[field.key]).startsWith("__masked__") && (texts[field.key] ?? "") === "";
                  const wide = field.kind === "textarea" || field.kind === "kv" || field.key === "webhook" || field.key === "url";
                  const id = `${uid}-cfg-${field.key}`;
                  return (
                    <Field
                      key={field.key}
                      label={field.label}
                      htmlFor={id}
                      span={wide}
                      hint={masked ? "已保存凭据（不回显）；留空保持不变，填入新值即覆盖。" : field.help}
                    >
                      {field.kind === "select" ? (
                        <SelectMenu
                          id={id}
                          value={texts[field.key] ?? field.options?.[0]?.value ?? ""}
                          options={field.options ?? []}
                          ariaLabel={field.label}
                          disabled={saving}
                          onChange={(value) => setTexts((prev) => ({ ...prev, [field.key]: value }))}
                        />
                      ) : field.kind === "textarea" || field.kind === "kv" ? (
                        <textarea
                          id={id}
                          className={`${own.textArea} ${own.mono}`}
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
                        <TextInput
                          id={id}
                          mono={field.kind !== "number"}
                          className={field.kind === "number" ? shared.numberInputKit : undefined}
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
                    </Field>
                  );
                })}
            </FieldGrid>
            {fields.some((field) => field.kind === "switch") ? (
              <div className={shared.optionCard}>
                {fields
                  .filter((field) => field.kind === "switch")
                  .map((field) => (
                    <Row key={field.key} label={field.label} description={field.help}>
                      <Switch
                        checked={bools[field.key] === true}
                        label={field.label}
                        disabled={saving}
                        onChange={(next) => setBools((prev) => ({ ...prev, [field.key]: next }))}
                      />
                    </Row>
                  ))}
              </div>
            ) : null}
          </>
        )}
      </EditorGroup>

      <EditorGroup title="过滤">
        <FieldGrid columns={3}>
          <Field label="最低严重度" htmlFor={`${uid}-severity`}>
            <SelectMenu
              id={`${uid}-severity`}
              value={minSeverity}
              ariaLabel="最低严重度"
              options={SEVERITY_OPTIONS}
              disabled={saving}
              onChange={(value) => setMinSeverity(value)}
            />
          </Field>
          <Field label="类型包含" htmlFor={`${uid}-include`} optional hint="关键词，逗号或换行分隔">
            <TextInput
              id={`${uid}-include`}
              aria-label="类型包含关键词"
              value={includeText}
              disabled={saving}
              onChange={(event) => setIncludeText(event.currentTarget.value)}
            />
          </Field>
          <Field label="类型排除" htmlFor={`${uid}-exclude`} optional>
            <TextInput
              id={`${uid}-exclude`}
              aria-label="类型排除关键词"
              value={excludeText}
              disabled={saving}
              onChange={(event) => setExcludeText(event.currentTarget.value)}
            />
          </Field>
        </FieldGrid>
        <FieldGrid>
          <Field label="任务 ID" htmlFor={`${uid}-tasks`} hint="留空 = 不限">
            <TextInput
              id={`${uid}-tasks`}
              mono
              aria-label="任务ID过滤"
              value={taskIDsText}
              disabled={saving}
              onChange={(event) => setTaskIDsText(event.currentTarget.value)}
            />
          </Field>
          <Field label="资产 ID" htmlFor={`${uid}-assets`} hint="留空 = 不限">
            <TextInput
              id={`${uid}-assets`}
              mono
              aria-label="资产ID过滤"
              value={assetIDsText}
              disabled={saving}
              onChange={(event) => setAssetIDsText(event.currentTarget.value)}
            />
          </Field>
        </FieldGrid>
        <div className={shared.optionCard}>
          <Row label="接收漏洞状态变更" description="除新漏洞外，也推送漏洞处置状态的变化。">
            <Switch checked={onStatusChange} label="接收漏洞状态变更" disabled={saving} onChange={(next) => setOnStatusChange(next)} />
          </Row>
          <Row label="启用渠道" description="保存后立即生效。">
            <Switch checked={enabled} label="启用渠道" disabled={saving} onChange={(next) => setEnabled(next)} />
          </Row>
        </div>
      </EditorGroup>

      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      <EditorActions>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save} data-channel-save="">
          {saving ? "保存中…" : channel === null ? "创建渠道" : "保存"}
        </Button>
      </EditorActions>
    </Editor>
  );
}

/** 文本设置行：初值来自 GET /notify/meta，保存写回 PUT /settings；未改动时保存不可点。 */
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
  const dirty = draft.trim() !== initial.trim();
  return (
    <Row
      label={label}
      description={
        <>
          {hint}
          {failure === null ? null : <span className={own.rowError}>保存失败：{failure}</span>}
        </>
      }
      wideControl
      data={{ "data-notify-setting": "public_base_url" }}
    >
      <span className={own.inline}>
        <TextInput
          mono
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          disabled={disabled || saving}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Button
          variant={dirty ? "outline" : "ghost"}
          size="sm"
          disabled={disabled || saving || !dirty}
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
          {saving ? "保存中…" : "保存"}
        </Button>
      </span>
    </Row>
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
  const dirty = draft.trim() !== initial.trim();
  return (
    <Row
      label={label}
      description={
        <>
          {hint}
          {failure === null ? null : <span className={own.rowError}>保存失败：{failure}</span>}
        </>
      }
      data={{ "data-notify-setting": "digest_interval_min" }}
    >
      <span className={own.unitBox}>
        <UnitInput unit="分钟">
          <TextInput
            className={shared.numberInputKit}
            type="number"
            aria-label={label}
            value={draft}
            placeholder="30"
            disabled={disabled || saving}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </UnitInput>
      </span>
      <Button
        variant={dirty ? "outline" : "ghost"}
        size="sm"
        disabled={disabled || saving || !dirty}
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
        {saving ? "保存中…" : "保存"}
      </Button>
    </Row>
  );
}

