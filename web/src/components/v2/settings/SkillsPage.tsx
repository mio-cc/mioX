"use client";

/**
 * 设置分节「技能」：技能库的列表与调用总览，新建 / 上传 zip / 删除三种写操作。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/skills/page.tsx:192-293（总览：指标 + 调用排行 +
 *   最近调用 + 从未使用）、:767-806（技能行：名称 / 调用次数徽标 / 删除）、:1015-1124（新建表单：
 *   名称、描述、license、compatibility、正文、关联 MCP）、:740-760（上传 zip 入口）、
 *   :986-1012（删除二次确认）。文件树、文件编辑、元数据、调用统计、可见性在详情页
 *   `SkillDetail.tsx`（B03：P3:K5–K12），本文件只负责把技能行接到详情。
 * DSH 依据：DSH 无技能库管理页；按 设置分节 扩展（总表 §4.3）。
 *
 * 版式（D3 设计重塑）：SettingsPage → PageHead（说明 + 刷新）→ Metrics 四格 → 「调用排行 / 最近调用」
 * 两栏 → 「使用中」「从未使用」两个 Section，各一张 Card、每个技能一行（字形 tile · 名称 · 次数 / MCP
 * Badge · 描述截断；行尾最近时间 + 详情 + ⋯ 菜单）→ 「添加技能」Card：新建（卡内展开 Editor）与
 * 上传 zip（覆盖同名开关 + 选择文件）。
 * 对照表行：P3:K1 P3:K2 P3:K3 P3:K4
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconChevronRightOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSkillOutlineRegular,
  IconUploadOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import {
  Badge,
  Card,
  Editor,
  EditorActions,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  IconButton,
  Meta,
  Metrics,
  Notice,
  PageHead,
  Row,
  RowMenu,
  RowValue,
  Section,
  SettingsPage,
  Skeleton,
  TextArea,
  TextInput,
  Tile,
} from "@/components/v2/design/Kit";
import type { MCPServer, SkillItem } from "@/lib/types";
import { useMcpServers } from "@/v2/data/mcp";
import {
  createSkill,
  deleteSkill,
  formatSkillTime,
  summarizeSkills,
  uploadSkillZip,
  useSkills,
} from "@/v2/data/skills";
import { toast } from "./Toast";
import { SkillDetail } from "./SkillDetail";
import own from "./SkillsPage.module.css";

/** 新建表单草稿；提交时按 api.ts:1264-1271 的入参整理。 */
interface SkillDraft {
  name: string;
  description: string;
  license: string;
  compatibility: string;
  instructions: string;
}

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  description: "",
  license: "",
  compatibility: "",
  instructions: "",
};

const PAGE_LEAD = "可复用的任务说明书：Agent 按需加载，加载时才解锁关联的 MCP 工具。";

/** 把异常转成可展示文案。 */
function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 指标标签：把旧的 `data-skill-stat` 钩子挂在标签上。 */
function StatLabel({ label }: { label: string }): React.ReactNode {
  return <span data-skill-stat={label}>{label}</span>;
}

/**
 * 顶部总览：指标四格 + 调用排行 / 最近调用两栏。
 * 两栏只在 `skills()` 的返回值里有对应数据时才显示。
 */
function SkillsOverviewBlock({ skills, missing }: { skills: SkillItem[]; missing: number | null }): React.ReactNode {
  const agg = React.useMemo(() => summarizeSkills(skills), [skills]);
  return (
    <>
      <div data-skills-overview>
        <Metrics
          items={[
            { key: "total", label: <StatLabel label="技能总数" />, value: skills.length, foot: `${agg.usedCount} 个被调用过` },
            { key: "calls", label: <StatLabel label="累计调用" />, value: agg.totalCalls, foot: "来自 skill_usage 账本", muted: agg.totalCalls === 0 },
            {
              key: "never",
              label: <StatLabel label="未使用" />,
              value: agg.neverUsed.length,
              foot: agg.neverUsed.length > 0 ? "从未被任何 agent 加载" : "全部用过",
              tone: agg.neverUsed.length > 0 ? "warning" : undefined,
              muted: agg.neverUsed.length === 0,
            },
            ...(missing === null
              ? []
              : [
                  {
                    key: "missing",
                    label: <StatLabel label="缺失技能" />,
                    value: missing,
                    foot: "被点名但不存在",
                    tone: missing > 0 ? ("danger" as const) : undefined,
                    muted: missing === 0,
                  },
                ]),
          ]}
        />
      </div>

      {agg.ranked.length === 0 && agg.recent.length === 0 ? null : (
        <div className={own.split}>
          {agg.ranked.length === 0 ? null : (
            <Section title="调用排行" count={`前 ${agg.ranked.length}`}>
              <Card>
                {agg.ranked.map((row, index) => (
                  <Row
                    key={row.name}
                    lead={
                      <Tile small>
                        <span className={own.rank}>{index + 1}</span>
                      </Tile>
                    }
                    label={<span title={row.name}>{row.name}</span>}
                    data={{ "data-skill-rank": row.name }}
                  >
                    <span className={own.rankValue}>
                      <span className={own.rankBar} aria-hidden="true">
                        <span
                          className={own.rankFill}
                          style={{ width: `${Math.max(6, Math.round((row.calls / Math.max(1, agg.rankedTopCalls)) * 100))}%` }}
                        />
                      </span>
                      <span className={own.rankCount}>{row.calls} 次</span>
                    </span>
                  </Row>
                ))}
              </Card>
            </Section>
          )}
          {agg.recent.length === 0 ? null : (
            <Section title="最近调用" data={{ "data-skills-recent": "" }}>
              <Card>
                {agg.recent.map((row) => (
                  <Row key={row.name} label={<span title={row.name}>{row.name}</span>} data={{ "data-skill-recent": row.name }}>
                    <span className={own.time}>{formatSkillTime(row.lastUsed)}</span>
                  </Row>
                ))}
              </Card>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

/** 技能行：名称、描述、调用次数、详情、删除（二次确认，收在 ⋯ 菜单）；点行进入详情（B03）。 */
function SkillRow({
  skill,
  onChanged,
  onOpen,
}: {
  skill: SkillItem;
  onChanged: () => void;
  onOpen: (name: string) => void;
}): React.ReactNode {
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const confirmDelete = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteSkill(skill.name)
      .then(() => {
        toast(`已删除技能：${skill.name}`);
        setDeleting(false);
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setBusy(false));
  };

  const hasDesc = skill.description !== undefined && skill.description !== "";
  const mcpCount = skill.mcps?.length ?? 0;

  return (
    <div className={own.item} data-skill-name={skill.name}>
      <Row
        lead={
          <Tile>
            <span className={own.glyph}>
              <IconSkillOutlineRegular size={15} />
            </span>
          </Tile>
        }
        label={skill.name}
        muted={skill.calls === 0}
        labelAdornment={
          <>
            {skill.calls > 0 ? <Badge>{`${skill.calls} 次`}</Badge> : null}
            {mcpCount > 0 ? <Badge tone="info">{`MCP × ${mcpCount}`}</Badge> : null}
          </>
        }
        description={
          <span className={own.clip} title={hasDesc ? skill.description : undefined}>
            {hasDesc ? skill.description : "（无描述）"}
          </span>
        }
        onClick={() => onOpen(skill.name)}
        data={{ "data-skill-open": skill.name }}
      >
        {/* 行尾控件自己处理点击，不冒泡到行（⋯ 菜单经 portal 渲染，React 事件仍会沿组件树冒泡）。 */}
        <span style={{ display: "contents" }} onClick={(event) => event.stopPropagation()}>
          {skill.last_used === undefined || skill.last_used === "" ? null : (
            <RowValue>
              <span className={own.time}>{formatSkillTime(skill.last_used)}</span>
            </RowValue>
          )}
          <Button variant="ghost" size="sm" data-skill-detail-open={skill.name} aria-label={`进入详情：${skill.name}`} onClick={() => onOpen(skill.name)}>
            详情
            <IconChevronRightOutlineRegular size={12} />
          </Button>
          <RowMenu
            label={`技能 ${skill.name} 的更多操作`}
            disabled={busy}
            data={{ "data-skill-more": skill.name }}
            items={[
              { label: "进入详情", onSelect: () => onOpen(skill.name) },
              { label: "删除", danger: true, separatorBefore: true, onSelect: () => setDeleting(true), data: { "data-skill-delete": skill.name } },
            ]}
          />
        </span>
      </Row>
      {failure === null || deleting ? null : (
        <div className={own.cardNotice}>
          <Notice tone="danger">{failure}</Notice>
        </div>
      )}

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="确认删除技能"
        closeLabel="关闭"
        tone="warning"
        description={`将删除技能「${skill.name}」的全部文件、MCP 关联与可见性配置；此操作不可撤销。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleting(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={confirmDelete} data-skill-delete-confirm="">
              {busy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={own.dialogStack}>
          <div className={own.targetBox}>
            <Tile>
              <IconSkillOutlineRegular size={15} />
            </Tile>
            <span>{skill.name}</span>
          </div>
          <p className={own.dialogText}>技能目录会被整个删除，已经加载过它的任务不会因此失去历史记录，但后续无法再加载。</p>
          {failure === null ? null : <Notice tone="danger">删除失败：{failure}</Notice>}
        </div>
      </Modal>
    </div>
  );
}

/** MCP 依赖开关清单：列表来自真实 `GET /mcp`，四种状态齐全（新建与详情元数据共用）。 */
export function SkillMcpPicker({
  value,
  disabled,
  onToggle,
  offlineHint,
}: {
  value: readonly string[];
  disabled: boolean;
  onToggle: (name: string, next: boolean) => void;
  offlineHint: string;
}): React.ReactNode {
  const servers = useMcpServers();
  if (servers.phase === "loading") {
    return (
      <div className={own.innerCard}>
        <p className={own.innerState}>读取 MCP 服务器…</p>
      </div>
    );
  }
  if (servers.phase === "offline") {
    return (
      <Notice
        tone="danger"
        action={
          <Button variant="ghost" size="sm" onClick={servers.reload}>
            重新读取
          </Button>
        }
      >
        {offlineHint}
        {servers.error === null ? "" : `：${servers.error}`}
      </Notice>
    );
  }
  if (servers.servers.length === 0) {
    return (
      <div className={own.innerCard}>
        <p className={own.innerState}>暂无 MCP 服务器（可在设置「MCP」里添加后再关联）。</p>
      </div>
    );
  }
  return (
    <div className={own.innerCard}>
      {servers.servers.map((server: MCPServer) => {
        const checked = value.includes(server.name);
        return (
          <Row
            key={server.id}
            label={<span className={own.mono}>{server.name}</span>}
            labelAdornment={<Badge>{server.transport}</Badge>}
            description={`${server.tools?.length ?? 0} 个工具${server.enabled ? "" : " · 已停用"}`}
            data={{ "data-skill-mcp-option": server.name }}
          >
            <Switch checked={checked} disabled={disabled} label={`关联 MCP ${server.name}`} onChange={(next) => onToggle(server.name, next)} />
          </Row>
        );
      })}
    </div>
  );
}

/** 新建技能编辑器：名称 / 描述 / license / compatibility / 正文 / MCP 依赖。 */
function SkillEditor({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }): React.ReactNode {
  const uid = React.useId();
  const [draft, setDraft] = React.useState<SkillDraft>(EMPTY_DRAFT);
  const [mcps, setMcps] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const set = (patch: Partial<SkillDraft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleMcp = (name: string, next: boolean): void => {
    setMcps((prev) => (next ? [...prev, name] : prev.filter((item) => item !== name)));
  };

  const save = (): void => {
    const name = draft.name.trim();
    const description = draft.description.trim();
    if (name === "") {
      setFailure("请填写名称。");
      return;
    }
    if (description === "") {
      setFailure("描述是必填项（技能在什么情况下被使用）。");
      return;
    }
    setSaving(true);
    setFailure(null);
    void createSkill({
      name,
      description,
      license: draft.license.trim(),
      compatibility: draft.compatibility.trim(),
      mcps,
      instructions: draft.instructions,
    })
      .then((created) => {
        toast(`已创建技能：${created}`);
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <Editor inCard data={{ "data-skills-create-form": "" }}>
      <EditorGroup title="基本信息">
        <FieldGrid>
          <Field label="名称" htmlFor={`${uid}-name`} hint="唯一目录名，创建后不能改。" span>
            <TextInput
              id={`${uid}-name`}
              mono
              aria-label="技能名称"
              placeholder="web-recon"
              value={draft.name}
              disabled={saving}
              onChange={(event) => set({ name: event.currentTarget.value })}
            />
          </Field>
          <Field label="描述" htmlFor={`${uid}-desc`} hint="写清它做什么、什么情况下该用——Agent 靠这段话决定是否加载。" span>
            <TextArea
              id={`${uid}-desc`}
              aria-label="技能描述"
              rows={2}
              value={draft.description}
              disabled={saving}
              onChange={(event) => set({ description: event.currentTarget.value })}
            />
          </Field>
          <Field label="license" htmlFor={`${uid}-license`} optional>
            <TextInput
              id={`${uid}-license`}
              aria-label="license"
              placeholder="MIT"
              value={draft.license}
              disabled={saving}
              onChange={(event) => set({ license: event.currentTarget.value })}
            />
          </Field>
          <Field label="compatibility" htmlFor={`${uid}-compat`} optional>
            <TextInput
              id={`${uid}-compat`}
              aria-label="compatibility"
              placeholder="需要 python3"
              value={draft.compatibility}
              disabled={saving}
              onChange={(event) => set({ compatibility: event.currentTarget.value })}
            />
          </Field>
        </FieldGrid>
      </EditorGroup>

      <EditorGroup title="正文">
        <Field label="SKILL.md 正文" htmlFor={`${uid}-body`} optional hint="留空时后端生成骨架，之后可以在详情里继续编辑。">
          <TextArea
            id={`${uid}-body`}
            mono
            aria-label="技能正文"
            rows={8}
            value={draft.instructions}
            disabled={saving}
            onChange={(event) => set({ instructions: event.currentTarget.value })}
          />
        </Field>
      </EditorGroup>

      <EditorGroup title="MCP 依赖">
        <SkillMcpPicker value={mcps} disabled={saving} onToggle={toggleMcp} offlineHint="未连接后端（读不到 MCP 服务器，可以不选 MCP 依赖直接创建）" />
      </EditorGroup>

      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      <EditorActions>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "创建中…" : "创建"}
        </Button>
      </EditorActions>
    </Editor>
  );
}

/** 「添加技能」卡：新建（卡内展开编辑器）+ 上传 zip（覆盖同名开关 + 文件选择）。 */
function AddSkillCard({ adding, onToggleAdding, onDone }: { adding: boolean; onToggleAdding: (next: boolean) => void; onDone: () => void }): React.ReactNode {
  const [overwrite, setOverwrite] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onPick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    // 清空 input，否则重复选同一个文件不会再触发 onChange。
    event.currentTarget.value = "";
    if (file === undefined) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    void uploadSkillZip(file, overwrite)
      .then((value) => {
        setResult(`已安装技能：${value.name}（${value.files} 个文件）`);
        onDone();
      })
      .catch((reason: unknown) => {
        const message = reasonText(reason);
        setFailure(message.includes("已存在") && !overwrite ? `${message}——如需覆盖同名技能，打开「覆盖同名」后再上传。` : message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card selected={adding} className={own.listCard}>
      <Row
        lead={
          <Tile>
            <IconPlusOutlineRegular size={15} />
          </Tile>
        }
        label="新建技能"
        description="在技能目录下创建同名文件夹与 SKILL.md。"
      >
        <Button variant={adding ? "ghost" : "outline"} size="sm" aria-expanded={adding} data-skills-create="" onClick={() => onToggleAdding(!adding)}>
          {adding ? "收起" : "新建"}
        </Button>
      </Row>
      {adding ? (
        <SkillEditor
          onSaved={() => {
            onToggleAdding(false);
            onDone();
          }}
          onCancel={() => onToggleAdding(false)}
        />
      ) : null}
      <div className={own.uploadBlock} data-skills-upload>
        <Row
          lead={
            <Tile>
              <IconUploadOutlineRegular size={15} />
            </Tile>
          }
          label="上传压缩包"
          description="根目录含 SKILL.md 的 .zip；同名技能默认不覆盖。"
        >
          <Switch checked={overwrite} disabled={busy} label="覆盖同名" onChange={(next) => setOverwrite(next)} />
          <span className={own.time}>覆盖同名</span>
          <input ref={fileRef} type="file" accept=".zip" style={{ display: "none" }} data-skills-upload-input onChange={onPick} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "上传中…" : "选择 .zip"}
          </Button>
        </Row>
        {result === null && failure === null ? null : (
          <div className={own.cardNotice}>
            {result === null ? null : <Notice tone="success">{result}</Notice>}
            {failure === null ? null : <Notice tone="danger">上传失败：{failure}</Notice>}
          </div>
        )}
      </div>
    </Card>
  );
}

export function SkillsPage(): React.ReactNode {
  const state = useSkills();
  const [adding, setAdding] = React.useState(false);
  // 详情：点技能行 / 「详情」打开，详情里有「返回列表」（B03）。
  const [opened, setOpened] = React.useState<string | null>(null);

  const refresh = (
    <IconButton label="刷新" spinning={state.phase === "loading"} onClick={state.reload}>
      <IconRefreshOutlineRegular size={14} />
    </IconButton>
  );

  if (state.phase === "loading") {
    return (
      <SettingsPage data={{ "data-settings-skills": "loading" }}>
        <PageHead title="技能" lead={PAGE_LEAD} actions={refresh} />
        <Card>
          <Skeleton label="读取技能库" />
        </Card>
      </SettingsPage>
    );
  }
  if (state.phase === "offline") {
    return (
      <SettingsPage data={{ "data-settings-skills": "offline" }}>
        <PageHead title="技能" lead={PAGE_LEAD} actions={refresh} />
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={state.reload}>
              重新读取
            </Button>
          }
        >
          未连接后端（读不到技能库）{state.error === null ? "" : `：${state.error}`}
        </Notice>
      </SettingsPage>
    );
  }

  if (opened !== null) {
    return (
      <SkillDetail
        name={opened}
        skill={state.skills.find((item) => item.name === opened) ?? null}
        onBack={() => {
          setOpened(null);
          state.reload();
        }}
        onChanged={state.reload}
      />
    );
  }

  const used = state.skills.filter((skill) => skill.calls > 0);
  const unused = state.skills.filter((skill) => skill.calls === 0);
  const renderRows = (list: SkillItem[]): React.ReactNode =>
    list.map((skill) => <SkillRow key={skill.name} skill={skill} onChanged={state.reload} onOpen={setOpened} />);

  return (
    <SettingsPage data={{ "data-settings-skills": "ready" }}>
      <PageHead
        title="技能"
        lead={state.skills.length === 0 ? PAGE_LEAD : `${state.skills.length} 个技能 · 调用统计来自 skill_usage 账本。点一行进入详情，编辑文件与元数据。`}
        actions={refresh}
      />

      {state.skills.length === 0 ? (
        <Card>
          <Empty
            inCard
            icon={<IconSkillOutlineRegular size={18} />}
            title="技能库是空的"
            text="在下方新建一个技能，或上传一个含 SKILL.md 的压缩包。"
          />
        </Card>
      ) : (
        <>
          <SkillsOverviewBlock skills={state.skills} missing={state.missing === null ? null : state.missing.length} />
          {used.length === 0 ? null : (
            <Section title="使用中" count={used.length} hint="按库中顺序">
              <Card className={own.listCard}>{renderRows(used)}</Card>
            </Section>
          )}
          {unused.length === 0 ? null : (
            <Section title="从未使用" count={unused.length} hint="没有被任何 agent 加载过" data={{ "data-skills-never-used": "" }}>
              <Card className={own.listCard}>{renderRows(unused)}</Card>
            </Section>
          )}
        </>
      )}

      <Section title="添加技能">
        <AddSkillCard adding={adding} onToggleAdding={setAdding} onDone={state.reload} />
      </Section>
    </SettingsPage>
  );
}
