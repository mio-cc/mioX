"use client";

/**
 * 设置「技能」分节里的技能详情：左侧文件树（新建文件 / 新建文件夹 / 删除），
 * 右侧文件编辑区（未保存脏标记、保存、二进制 / 过大时禁用编辑），
 * 以及元数据编辑、调用统计、按 Agent 可见性。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/skills/page.tsx:66-124（文件树拼接与排序）、
 *   :446-484（新建文件 / 新建文件夹的内联输入）、:486-537（取消、删除路径、保存文件）、
 *   :539-565（MCP 关联回滚、可见性切换）、:622-697（文件树递归渲染）、
 *   :846-960（详情面板：名称 / 描述 / license / compatibility、调用统计、MCP 关联、可见性）、
 *   :962-982（文件编辑区：面包屑 + 保存 + textarea）、:986-1013（删除二次确认）。
 * DSH 依据：DSH 无技能库管理页；按 设置分节 扩展（总表 §4.3）。
 *
 * 版式（D3 设计重塑）：面包屑「技能 / name」→ PageHead（名称 + 调用 Badge + 描述 + 刷新文件）→
 * Metrics 三格（调用 / 覆盖任务 / 最近调用）→ Section「文件」：左文件树 Card、右编辑器 Card（头部
 * 路径 + 同步状态 + 动作，正文等宽大文本框）→ Section「元数据」：Card + kit Editor → 「调用记录」
 * Card 行列表 →「Agent 可见性」Card 开关行 → 页底「危险区」Card（红色说明 + 删除整个技能）。
 * 对照表行：P3:K5 P3:K6 P3:K7 P3:K8 P3:K9 P3:K10 P3:K11 P3:K12
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCodeOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import {
  Badge,
  Card,
  Dot,
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
  Section,
  SettingsPage,
  Skeleton,
  TextArea,
  TextInput,
  Tile,
} from "@/components/v2/design/Kit";
import type { SkillCall, SkillItem } from "@/lib/types";
import { useAgents } from "@/v2/data/agents";
import {
  createSkillDir,
  createSkillFile,
  deleteSkillPath,
  formatSkillTime,
  isBinarySkillFile,
  SKILL_FILE_EDIT_LIMIT,
  toggleSkillVisibility,
  updateSkillMeta,
  useSkillFile,
  useSkillFiles,
  useSkillUsage,
  useSkillVisibility,
  writeSkillFile,
  type SkillMetaInput,
  type SkillTreeEntry,
} from "@/v2/data/skills";
import { toast } from "./Toast";
import { SkillMcpPicker } from "./SkillsPage";
import shared from "./SettingsDialog.module.css";
import own from "./SkillsPage.module.css";

/** 把异常转成可展示文案。 */
function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 拼接父目录与名字；根目录（`""`）下直接返回名字。 */
function joinPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** 校验新建条目名：不能为空、不能有斜杠、不能是 `.`/`..`。 */
function validateEntryName(name: string): string | null {
  if (name === "") return "请填写名称。";
  if (name.includes("/") || name.includes("\\")) return "名称里不能包含斜杠；要建多级目录请逐级新建。";
  if (name === "." || name === "..") return "这个名称不合法。";
  return null;
}

/** 一个待删除对象：文件 / 目录 / 整个技能。 */
type PendingDelete =
  | { kind: "path"; path: string; isDir: boolean }
  | { kind: "skill" }
  | null;

/** 新建输入的形态：在哪个目录下建、建文件还是目录。 */
interface CreatingState {
  inDir: string;
  kind: "file" | "dir";
}

/** 树行的左缩进（px）。 */
function indentOf(depth: number): number {
  return 6 + depth * 14;
}

/**
 * 新建文件 / 文件夹的行内输入（旧页 page.tsx:446-484、:594-619）。
 * Enter 提交、Esc 取消、失焦提交（Esc 之后的失焦不提交，靠 `cancelled` ref 拦住）。
 */
function CreateEntryRow({
  indent,
  kind,
  onCancel,
  onSubmit,
}: {
  indent: number;
  kind: "file" | "dir";
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}): React.ReactNode {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const cancelled = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = (): void => {
    if (cancelled.current || busy) return;
    const value = name.trim();
    const problem = validateEntryName(value);
    if (problem !== null) {
      if (value !== "") onCancel();
      return;
    }
    setBusy(true);
    void onSubmit(value).finally(() => setBusy(false));
  };

  return (
    <div className={own.treeCreate} style={{ paddingLeft: indent }}>
      <span className={own.treeIcon}>{kind === "dir" ? <IconFolderCloseRegular size={13} /> : <IconCodeOutlineRegular size={13} />}</span>
      <TextInput
        ref={inputRef}
        mono
        className={own.treeCreateInput}
        aria-label={kind === "dir" ? "新文件夹名称" : "新文件名称"}
        placeholder={kind === "dir" ? "文件夹名" : "文件名"}
        disabled={busy}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            onCancel();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

/** 树行尾的小图标动作（悬停 / 聚焦 / 选中时可见）。 */
function TreeAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }): React.ReactNode {
  return (
    <button
      type="button"
      className={`${own.treeAction} ${danger ? own.treeActionDanger : ""}`}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/**
 * 递归渲染文件树（旧页 page.tsx:622-697）。
 * 目录行点击展开 / 收起，悬停时出现「新建文件 / 新建文件夹 / 删除目录」；
 * 文件行点击在右侧打开，悬停出现「删除文件」。
 */
function TreeNodes({
  nodes,
  depth,
  selectedPath,
  expanded,
  creating,
  onToggleDir,
  onSelectFile,
  onStartCreate,
  onCancelCreate,
  onSubmitCreate,
  onRequestDelete,
}: {
  nodes: SkillTreeEntry[];
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  creating: CreatingState | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onStartCreate: (inDir: string, kind: "file" | "dir") => void;
  onCancelCreate: () => void;
  onSubmitCreate: (inDir: string, kind: "file" | "dir", name: string) => Promise<void>;
  onRequestDelete: (path: string, isDir: boolean) => void;
}): React.ReactNode {
  const indent = indentOf(depth);
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "dir") {
          const open = expanded.has(node.path);
          return (
            <div key={`dir:${node.path}`} data-skill-dir={node.path}>
              <div
                className={own.treeRow}
                style={{ paddingLeft: indent }}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                title={node.path}
                onClick={() => onToggleDir(node.path)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleDir(node.path);
                  }
                }}
              >
                <span className={own.treeChevron}>{open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}</span>
                <span className={own.treeIcon}>{open ? <IconFolderOpenRegular size={14} /> : <IconFolderCloseRegular size={14} />}</span>
                <span className={own.treeDirName}>{node.name}</span>
                <span className={own.treeActions}>
                  <TreeAction label={`在 ${node.path} 下新建文件`} onClick={() => onStartCreate(node.path, "file")}>
                    <IconPlusOutlineRegular size={12} />
                  </TreeAction>
                  <TreeAction label={`在 ${node.path} 下新建文件夹`} onClick={() => onStartCreate(node.path, "dir")}>
                    <IconFolderCloseRegular size={12} />
                  </TreeAction>
                  <TreeAction label={`删除文件夹 ${node.path}`} danger onClick={() => onRequestDelete(node.path, true)}>
                    <IconTrashOutlineRegular size={12} />
                  </TreeAction>
                </span>
              </div>
              {open ? (
                <>
                  <TreeNodes
                    nodes={node.children}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    expanded={expanded}
                    creating={creating !== null && creating.inDir === node.path ? creating : null}
                    onToggleDir={onToggleDir}
                    onSelectFile={onSelectFile}
                    onStartCreate={onStartCreate}
                    onCancelCreate={onCancelCreate}
                    onSubmitCreate={onSubmitCreate}
                    onRequestDelete={onRequestDelete}
                  />
                  {creating !== null && creating.inDir === node.path ? (
                    <CreateEntryRow
                      indent={indentOf(depth + 1) + 18}
                      kind={creating.kind}
                      onCancel={onCancelCreate}
                      onSubmit={(name) => onSubmitCreate(node.path, creating.kind, name)}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          );
        }

        const isSelected = selectedPath === node.path;
        return (
          <div key={`file:${node.path}`} data-skill-file={node.path}>
            <div
              role="button"
              tabIndex={0}
              title={node.path}
              aria-current={isSelected ? "true" : undefined}
              data-skill-file-row={node.path}
              onClick={() => onSelectFile(node.path)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectFile(node.path);
                }
              }}
              className={isSelected ? `${own.treeRow} ${own.treeRowSelected}` : own.treeRow}
              style={{ paddingLeft: indent + 18 }}
            >
              <span className={own.treeIcon}>
                <IconCodeOutlineRegular size={13} />
              </span>
              <span className={own.treeName}>{node.name}</span>
              <span className={own.treeActions}>
                <TreeAction label={`删除文件 ${node.path}`} danger onClick={() => onRequestDelete(node.path, false)}>
                  <IconTrashOutlineRegular size={12} />
                </TreeAction>
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * 元数据编辑：描述 / license / compatibility / MCP 关联（`PUT /skills/{name}/meta`）。
 * 四个字段一次提交；未改动时保存禁用。
 */
function MetaForm({ skill, onSaved }: { skill: SkillItem; onSaved: () => void }): React.ReactNode {
  const uid = React.useId();
  const [description, setDescription] = React.useState(skill.description ?? "");
  const [license, setLicense] = React.useState(skill.license ?? "");
  const [compatibility, setCompatibility] = React.useState(skill.compatibility ?? "");
  const [mcps, setMcps] = React.useState<string[]>(skill.mcps ?? []);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  // `mcps` 每次重读都是新数组：比较内容而不是引用，避免父组件重渲染把用户正在编辑的勾选重置。
  const mcpsKey = (skill.mcps ?? []).join("\n");

  // 技能列表中该技能字段变化（例如保存后重读）时，把表单拉回服务端值。
  React.useEffect(() => {
    setDescription(skill.description ?? "");
    setLicense(skill.license ?? "");
    setCompatibility(skill.compatibility ?? "");
    setMcps(skill.mcps ?? []);
  }, [skill.name, skill.description, skill.license, skill.compatibility, mcpsKey]);

  const dirty =
    description !== (skill.description ?? "") ||
    license !== (skill.license ?? "") ||
    compatibility !== (skill.compatibility ?? "") ||
    [...mcps].sort().join("\n") !== [...(skill.mcps ?? [])].sort().join("\n");

  const revert = (): void => {
    setDescription(skill.description ?? "");
    setLicense(skill.license ?? "");
    setCompatibility(skill.compatibility ?? "");
    setMcps(skill.mcps ?? []);
    setFailure(null);
    setDone(null);
  };

  const save = (): void => {
    const meta: SkillMetaInput = {
      description: description.trim(),
      license: license.trim(),
      compatibility: compatibility.trim(),
      mcps,
    };
    setSaving(true);
    setFailure(null);
    setDone(null);
    void updateSkillMeta(skill.name, meta)
      .then(() => {
        setDone("已保存");
        toast("技能元数据已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <Editor inCard data={{ "data-skill-meta-form": "" }}>
      <EditorGroup title="说明">
        <FieldGrid>
          <Field label="描述" htmlFor={`${uid}-desc`} span hint="Agent 靠这段话判断何时加载该技能。">
            <TextArea
              id={`${uid}-desc`}
              aria-label="技能描述"
              rows={3}
              disabled={saving}
              value={description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setDone(null);
              }}
            />
          </Field>
          <Field label="license" htmlFor={`${uid}-license`} optional>
            <TextInput
              id={`${uid}-license`}
              aria-label="license"
              disabled={saving}
              value={license}
              onChange={(event) => {
                setLicense(event.currentTarget.value);
                setDone(null);
              }}
            />
          </Field>
          <Field label="compatibility" htmlFor={`${uid}-compat`} optional>
            <TextInput
              id={`${uid}-compat`}
              aria-label="compatibility"
              disabled={saving}
              value={compatibility}
              onChange={(event) => {
                setCompatibility(event.currentTarget.value);
                setDone(null);
              }}
            />
          </Field>
        </FieldGrid>
      </EditorGroup>

      <EditorGroup title="关联 MCP">
        <SkillMcpPicker
          value={mcps}
          disabled={saving}
          offlineHint="未连接后端（读不到 MCP 服务器；不影响其它三个字段的保存）"
          onToggle={(serverName, next) => {
            setMcps((prev) => (next ? [...prev, serverName] : prev.filter((item) => item !== serverName)));
            setDone(null);
          }}
        />
      </EditorGroup>

      {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}
      <EditorActions start={done === null ? undefined : <span className={own.time}>{done}</span>}>
        <Button variant="ghost" size="sm" disabled={saving || !dirty} onClick={revert}>
          撤销改动
        </Button>
        <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={save}>
          {saving ? "保存中…" : "保存元数据"}
        </Button>
      </EditorActions>
    </Editor>
  );
}

/** 调用记录：调用方 + 最近调用明细（`GET /skills/{name}/usage?limit=20`）。 */
function UsageBlock({ skill }: { skill: SkillItem }): React.ReactNode {
  const usage = useSkillUsage(skill.name, 20);

  const body = (): React.ReactNode => {
    if (usage.phase === "loading") return <Skeleton label="读取调用明细" />;
    if (usage.phase === "offline") return null;
    if (usage.calls.length === 0) {
      return <Empty inCard title="还没有调用记录" text="Agent 加载过这个技能后，每次调用都会记在这里。" />;
    }
    return usage.calls.map((call: SkillCall, index) => (
      <Row
        key={`${call.ts}-${index}`}
        label={call.task_id > 0 ? `任务 #${call.task_id}` : call.session_id === "" ? "—" : "对话会话"}
        labelAdornment={<Badge>{call.agent_key === "" ? "—" : call.agent_key}</Badge>}
        description={call.args_len > 0 ? `参数 ${call.args_len} 字符` : undefined}
        data={{ "data-skill-usage-call": String(index) }}
      >
        <span className={own.time}>{formatSkillTime(call.ts)}</span>
      </Row>
    ));
  };

  return (
    <Section
      title="调用记录"
      count={usage.phase === "ready" ? usage.calls.length : undefined}
      hint="最近 20 条"
      actions={
        <IconButton label="重新读取调用明细" spinning={usage.phase === "loading"} onClick={usage.reload}>
          <IconRefreshOutlineRegular size={14} />
        </IconButton>
      }
    >
      {usage.phase === "offline" ? (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={usage.reload}>
              重试
            </Button>
          }
        >
          读取调用明细失败：{usage.error ?? ""}
        </Notice>
      ) : null}
      {usage.phase === "offline" ? null : (
        <Card>
          {skill.usage_agents.length === 0 ? null : (
            <Row label="调用方" description="加载过这个技能的 Agent">
              {skill.usage_agents.map((key) => (
                <Badge key={key}>{key}</Badge>
              ))}
            </Row>
          )}
          {body()}
        </Card>
      )}
    </Section>
  );
}

/** 可见性：按 Agent 开关（`GET/POST /visibility/skill/...`）。 */
function VisibilityBlock({ skill }: { skill: SkillItem }): React.ReactNode {
  const agents = useAgents();
  const visibility = useSkillVisibility(skill.name);
  const [busyAgent, setBusyAgent] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggle = (agentId: string, visible: boolean): void => {
    setBusyAgent(agentId);
    setFailure(null);
    void toggleSkillVisibility(agentId, skill.name, visible)
      .then(() => {
        toast(visible ? "已授予可见" : "已取消可见");
        visibility.reload();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setBusyAgent(null));
  };

  const loading = agents.phase === "loading" || visibility.phase === "loading";
  const offline = agents.phase === "offline" || visibility.phase === "offline";
  const ready = !loading && !offline;

  return (
    <Section
      title="Agent 可见性"
      count={ready && agents.agents.length > 0 ? `${agents.agents.filter((agent) => visibility.agentIds.includes(agent.id)).length}/${agents.agents.length}` : undefined}
      hint="只有被授权的 Agent 能加载这个技能"
      data={{ "data-skill-visibility": "" }}
    >
      {offline ? (
        <Notice
          tone="danger"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                agents.reload();
                visibility.reload();
              }}
            >
              重新读取
            </Button>
          }
        >
          读取失败：{(agents.phase === "offline" ? agents.error : visibility.error) ?? ""}
        </Notice>
      ) : (
        <Card>
          {loading ? <Skeleton label="读取 Agent 与可见性" /> : null}
          {ready && agents.agents.length === 0 ? <Empty inCard title="暂无 Agent" text="先在「Agent 预设」里创建 Agent，再回来授权。" /> : null}
          {ready
            ? agents.agents.map((agent) => {
                const checked = visibility.agentIds.includes(agent.id);
                return (
                  <Row
                    key={agent.id}
                    lead={<Tile small>{(agent.name.trim()[0] ?? "?").toUpperCase()}</Tile>}
                    label={agent.name}
                    muted={!checked}
                    description={checked ? "可加载" : "不可见"}
                    data={{ "data-skill-visibility-agent": agent.id }}
                  >
                    <Switch checked={checked} disabled={busyAgent !== null} label={`${agent.name} 可见技能 ${skill.name}`} onChange={(next) => toggle(agent.id, next)} />
                  </Row>
                );
              })
            : null}
        </Card>
      )}
      {failure === null ? null : <Notice tone="danger">操作失败：{failure}</Notice>}
    </Section>
  );
}

/** 右侧编辑卡：头部路径 + 同步状态 + 动作，正文等宽大文本框 / 不可编辑提示。 */
function FileEditor({
  skillName,
  path,
  onSaved,
  onRequestDelete,
}: {
  skillName: string;
  path: string;
  onSaved: () => void;
  onRequestDelete: (path: string, isDir: boolean) => void;
}): React.ReactNode {
  const file = useSkillFile(skillName, path);
  const [draft, setDraft] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // 读到新内容（或切换文件）时重置草稿与脏标记（旧页 page.tsx:413-420）。
  React.useEffect(() => {
    if (file.phase !== "ready") return;
    setDraft(file.content);
    setDirty(false);
    setFailure(null);
  }, [file.phase, file.content, path]);

  const binary = isBinarySkillFile(path);
  const tooLarge = file.phase === "ready" && file.content.length > SKILL_FILE_EDIT_LIMIT;
  const editable = !binary && !tooLarge;

  const save = (): void => {
    setSaving(true);
    setFailure(null);
    void writeSkillFile(skillName, path, draft)
      .then(() => {
        setDirty(false);
        toast("已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setSaving(false));
  };

  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const base = slash < 0 ? path : path.slice(slash + 1);

  return (
    <Card className={own.editorCard} data={{ "data-skill-editor": path }}>
      <div className={own.editorHead}>
        <span className={own.editorPath} title={`${skillName}/${path}`}>
          {dir === "" ? null : <span>{dir}</span>}
          <span className={own.editorPathFile}>{base}</span>
        </span>
        <Badge tone={dirty ? "warning" : "neutral"}>
          <Dot tone={dirty ? "warning" : "success"} />
          {dirty ? "未保存" : !editable && file.phase === "ready" ? "只读" : "已同步"}
        </Badge>
        <span className={own.editorHeadActions}>
          <IconButton label="重新读取文件" disabled={saving} onClick={file.reload}>
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
          <IconButton label={`删除文件 ${path}`} onClick={() => onRequestDelete(path, false)}>
            <IconTrashOutlineRegular size={14} />
          </IconButton>
          <Button variant="primary" size="sm" disabled={!dirty || saving || !editable} onClick={save}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </span>
      </div>

      <div className={own.editorBody}>
        {file.phase === "loading" ? <Skeleton label="读取文件" /> : null}
        {file.phase === "offline" ? (
          <Notice
            tone="danger"
            action={
              <Button variant="ghost" size="sm" onClick={file.reload}>
                重试
              </Button>
            }
          >
            读取文件失败：{file.error ?? ""}
          </Notice>
        ) : null}
        {file.phase === "idle" ? <p className={own.treeState}>未选择文件。</p> : null}
        {file.phase === "ready" && binary ? (
          <Notice tone="warning">这个文件按二进制处理，不能在这里编辑（{file.content.length} 字符）。需要改它请直接改技能目录里的文件。</Notice>
        ) : null}
        {file.phase === "ready" && tooLarge ? (
          <Notice tone="warning">
            文件过大（{file.content.length} 字符，上限 {SKILL_FILE_EDIT_LIMIT}），为避免把整份内容塞进编辑框，这里只禁用编辑。
          </Notice>
        ) : null}
        {file.phase === "ready" ? (
          <TextArea
            mono
            spellCheck={false}
            className={own.editorArea}
            aria-label={`编辑 ${path}`}
            data-skill-editor-textarea=""
            readOnly={!editable}
            value={editable ? draft : file.content}
            onChange={(event) => {
              if (!editable) return;
              setDraft(event.currentTarget.value);
              setDirty(event.currentTarget.value !== file.content);
            }}
          />
        ) : null}
        {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}
      </div>
    </Card>
  );
}

export function SkillDetail({
  name,
  skill,
  onBack,
  onChanged,
}: {
  /** 技能目录名。 */
  name: string;
  /** `GET /skills` 里该技能的记录；列表还没刷新时为 null（只影响元数据表单与统计卡）。 */
  skill: SkillItem | null;
  /** 「返回列表」。 */
  onBack: () => void;
  /** 文件 / 元数据写完后的回调（页面自己重读技能列表）。 */
  onChanged: () => void;
}): React.ReactNode {
  const files = useSkillFiles(name);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState<CreatingState | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteFailure, setDeleteFailure] = React.useState<string | null>(null);
  const [createFailure, setCreateFailure] = React.useState<string | null>(null);

  const ensureExpanded = (dirPath: string): void => {
    if (dirPath === "") return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = "";
      for (const part of dirPath.split("/")) {
        cur = cur === "" ? part : `${cur}/${part}`;
        next.add(cur);
      }
      return next;
    });
  };

  const toggleDir = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const startCreate = (inDir: string, kind: "file" | "dir"): void => {
    setCreateFailure(null);
    ensureExpanded(inDir);
    setCreating({ inDir, kind });
  };

  const submitCreate = (inDir: string, kind: "file" | "dir", entryName: string): Promise<void> => {
    const fullPath = joinPath(inDir, entryName);
    setCreateFailure(null);
    const request = kind === "dir" ? createSkillDir(name, fullPath) : createSkillFile(name, fullPath);
    return request
      .then(() => {
        toast(kind === "dir" ? `已创建文件夹：${fullPath}` : `已创建文件：${fullPath}`);
        setCreating(null);
        if (kind === "dir") ensureExpanded(fullPath);
        else setSelectedPath(fullPath);
        files.reload();
        onChanged();
      })
      .catch((reason: unknown) => {
        setCreateFailure(reasonText(reason));
      });
  };

  const confirmDelete = (): void => {
    const target = pendingDelete;
    if (target === null) return;
    setDeleting(true);
    setDeleteFailure(null);
    const request = target.kind === "skill" ? Promise.resolve() : deleteSkillPath(name, target.path);
    void request
      .then(() => {
        if (target.kind === "path") {
          toast(`已删除：${target.path}`);
          if (selectedPath === target.path) setSelectedPath(null);
          setPendingDelete(null);
          files.reload();
          onChanged();
        }
      })
      .catch((reason: unknown) => setDeleteFailure(reasonText(reason)))
      .finally(() => setDeleting(false));
  };

  const requestDelete = (path: string, isDir: boolean): void => {
    setDeleteFailure(null);
    setPendingDelete({ kind: "path", path, isDir });
  };

  const fileCount = files.phase === "ready" ? files.entries.filter((entry) => !entry.endsWith("/")).length : null;

  const treeBody = (): React.ReactNode => {
    if (files.phase === "loading") return <p className={own.treeState}>读取文件列表…</p>;
    if (files.phase === "offline") {
      return (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={files.reload}>
              重试
            </Button>
          }
        >
          读取文件列表失败：{files.error ?? ""}
        </Notice>
      );
    }
    if (files.entries.length === 0 && creating === null) {
      return <p className={own.treeState}>这个技能目录里还没有文件；用上方的 + 新建一个。</p>;
    }
    // buildSkillTree 把根目录下的文件挂在 path 为 "" 的无名目录节点下：展示时把它展平到根层。
    const rootNodes = files.tree
      .flatMap((node) => (node.type === "dir" && node.path === "" ? node.children : [node]))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.type === "dir" ? -1 : 1));
    return (
      <TreeNodes
        nodes={rootNodes}
        depth={0}
        selectedPath={selectedPath}
        expanded={expanded}
        creating={creating !== null && creating.inDir === "" ? creating : null}
        onToggleDir={toggleDir}
        onSelectFile={(path) => setSelectedPath(path)}
        onStartCreate={startCreate}
        onCancelCreate={() => setCreating(null)}
        onSubmitCreate={submitCreate}
        onRequestDelete={requestDelete}
      />
    );
  };

  return (
    <SettingsPage data={{ "data-skill-detail": name }}>
      <nav className={own.crumbs} aria-label="位置">
        <button type="button" className={own.crumbLink} aria-label="返回列表" data-skill-back="" onClick={onBack}>
          <IconChevronLeftOutlineRegular size={12} />
          技能
        </button>
        <span className={own.crumbSep}>/</span>
        <span className={own.crumbCurrent}>{name}</span>
      </nav>

      <PageHead
        title={name}
        adornment={skill === null ? null : skill.calls > 0 ? <Badge>{`调用 ${skill.calls} 次`}</Badge> : <Badge tone="warning">从未调用</Badge>}
        lead={
          skill === null
            ? `技能列表里还没有读到「${name}」的记录（统计与元数据暂不显示）；文件操作不受影响。`
            : skill.description === undefined || skill.description === ""
              ? "（无描述）在下方「元数据」里补一段，Agent 才知道何时加载它。"
              : skill.description
        }
        actions={
          <IconButton label="刷新文件" spinning={files.phase === "loading"} onClick={files.reload}>
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      />

      {skill === null ? null : (
        <div data-skill-usage>
          <Metrics
            items={[
              { key: "calls", label: <span data-skill-usage-cell="calls">总调用次数</span>, value: skill.calls, muted: skill.calls === 0 },
              { key: "tasks", label: <span data-skill-usage-cell="tasks">覆盖任务数</span>, value: skill.tasks, muted: skill.tasks === 0 },
              {
                key: "last",
                label: <span data-skill-usage-cell="last">最近调用</span>,
                value: formatSkillTime(skill.last_used),
                variant: "text",
                muted: skill.last_used === undefined || skill.last_used === "",
              },
            ]}
          />
        </div>
      )}

      <Section title="文件" count={fileCount ?? undefined} hint="选中文件在右侧编辑，保存后立即写入技能目录">
        <div className={own.workbench}>
          <Card className={own.treeCard} data={{ "data-skill-tree": "" }}>
            <div className={own.treeHead}>
              <span className={own.treeHeadTitle}>{name}</span>
              <IconButton label="新建文件" disabled={files.phase !== "ready"} onClick={() => startCreate("", "file")}>
                <IconPlusOutlineRegular size={14} />
              </IconButton>
              <IconButton label="新建文件夹" disabled={files.phase !== "ready"} onClick={() => startCreate("", "dir")}>
                <IconFolderCloseRegular size={14} />
              </IconButton>
            </div>
            <div className={own.treeBody}>
              {creating !== null && creating.inDir === "" ? (
                <CreateEntryRow indent={indentOf(0)} kind={creating.kind} onCancel={() => setCreating(null)} onSubmit={(entryName) => submitCreate("", creating.kind, entryName)} />
              ) : null}
              {createFailure === null ? null : (
                <div className={own.treeNotice}>
                  <Notice tone="danger">创建失败：{createFailure}</Notice>
                </div>
              )}
              {treeBody()}
            </div>
          </Card>

          {selectedPath === null ? (
            <Card className={own.editorCard}>
              <div className={own.editorEmpty}>
                <Empty
                  inCard
                  icon={<IconCodeOutlineRegular size={18} />}
                  title="选择一个文件"
                  text="从左侧文件树选一个文件查看和编辑；也可以先用 + 新建文件或文件夹。"
                />
              </div>
            </Card>
          ) : (
            <FileEditor
              skillName={name}
              path={selectedPath}
              onSaved={() => {
                files.reload();
                onChanged();
              }}
              onRequestDelete={requestDelete}
            />
          )}
        </div>
      </Section>

      {skill === null ? null : (
        <Section title="元数据" hint="名称是目录名，不在这里改">
          <Card>
            <Row
              lead={<Tile small>M</Tile>}
              label="SKILL.md 头部字段"
              description={<Meta items={[`license ${skill.license === undefined || skill.license === "" ? "未填" : skill.license}`, `${skill.mcps?.length ?? 0} 个关联 MCP`]} />}
            />
            <MetaForm skill={skill} onSaved={onChanged} />
          </Card>
        </Section>
      )}
      {skill === null ? null : <UsageBlock skill={skill} />}
      {skill === null ? null : <VisibilityBlock skill={skill} />}

      <Section title="危险区">
        <Card>
          <Row
            label="删除整个技能"
            description={<span className={own.dangerText}>会一并删除全部文件、MCP 关联与可见性配置，且不可撤销。</span>}
          >
            <button
              type="button"
              className={shared.dangerBtn}
              data-skill-delete-all=""
              onClick={() => {
                setDeleteFailure(null);
                setPendingDelete({ kind: "skill" });
              }}
            >
              删除技能
            </button>
          </Row>
        </Card>
      </Section>

      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (deleting) return;
          setPendingDelete(null);
        }}
        title={
          pendingDelete === null
            ? "确认删除"
            : pendingDelete.kind === "skill"
              ? "确认删除技能"
              : pendingDelete.isDir
                ? "确认删除文件夹"
                : "确认删除文件"
        }
        closeLabel="关闭"
        tone="warning"
        description={
          pendingDelete === null
            ? ""
            : pendingDelete.kind === "skill"
              ? `将删除技能「${name}」的全部文件、MCP 关联与可见性配置；此操作不可撤销。`
              : pendingDelete.isDir
                ? `将一并删除文件夹「${pendingDelete.path}」下的所有文件；此操作不可撤销。`
                : `将删除文件「${pendingDelete.path}」；此操作不可撤销。`
        }
        footer={
          <>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={deleting}
              data-skill-delete-confirm=""
              onClick={() => {
                if (pendingDelete !== null && pendingDelete.kind === "skill") onBack();
                confirmDelete();
              }}
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={own.dialogStack}>
          {pendingDelete === null ? null : (
            <div className={own.targetBox}>
              <Tile>{pendingDelete.kind === "path" && pendingDelete.isDir ? <IconFolderCloseRegular size={15} /> : <IconCodeOutlineRegular size={15} />}</Tile>
              <span className={own.mono}>{pendingDelete.kind === "skill" ? name : pendingDelete.path}</span>
            </div>
          )}
          {deleteFailure === null ? null : <Notice tone="danger">删除失败：{deleteFailure}</Notice>}
          {pendingDelete !== null && pendingDelete.kind === "skill" ? (
            <p className={own.dialogText}>确认后会先回到技能列表，列表刷新时该技能已不存在；删除结果失败时会在这里显示原因。</p>
          ) : null}
        </div>
      </Modal>
    </SettingsPage>
  );
}
