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
 * DSH 依据：DSH 无技能库管理页；按 设置分节 扩展（总表 §4.3），行/卡片素材复用
 *   SettingsDialog.module.css（ruleList / ruleRow / formCard / textArea …）。
 * 对照表行：P3:K5 P3:K6 P3:K7 P3:K8 P3:K9 P3:K10 P3:K11 P3:K12
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSaveOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { MCPServer, SkillCall, SkillItem } from "@/lib/types";
import { useAgents } from "@/v2/data/agents";
import { useMcpServers } from "@/v2/data/mcp";
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
import css from "./SettingsDialog.module.css";

/** 左树与右编辑区共用的两栏宽度。 */
const TREE_WIDTH = 220;

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

/** 行内错误提示（保持与页面一致的间距）。 */
function ErrorLine({ text }: { text: string }): React.ReactNode {
  return <p className={css.errorLine}>{text}</p>;
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
    <div className={css.treeCreateRow} style={{ paddingLeft: indent }}>
      <span className={css.treeCreateKind}>{kind === "dir" ? "目录" : "文件"}</span>
      <Input
        ref={inputRef}
        aria-label={kind === "dir" ? "新文件夹名称" : "新文件名称"}
        disabled={busy}
        value={name}
        style={{ minWidth: 0, flex: "1 1 auto" }}
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
  const indent = 8 + depth * 14;
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "dir") {
          const open = expanded.has(node.path);
          return (
            <div key={`dir:${node.path}`} data-skill-dir={node.path}>
              <div className={css.treeDirRow} style={{ paddingLeft: indent }} role="button" tabIndex={0} aria-expanded={open} onClick={() => onToggleDir(node.path)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleDir(node.path);
                }
              }}>
                {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
                <span className={css.treeIcon}>
                  {open ? <IconFolderOpenRegular size={13} /> : <IconFolderCloseRegular size={13} />}
                </span>
                <span title={node.path} className={css.treeName}>
                  {node.name}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 2, flex: "0 0 auto" }} onClick={(event) => event.stopPropagation()}>
                  <Button variant="ghost" size="sm" title="新建文件" aria-label={`在 ${node.path} 下新建文件`} onClick={() => onStartCreate(node.path, "file")}>
                    <IconPlusOutlineRegular size={11} />
                  </Button>
                  <Button variant="ghost" size="sm" title="新建文件夹" aria-label={`在 ${node.path} 下新建文件夹`} onClick={() => onStartCreate(node.path, "dir")}>
                    <IconFolderCloseRegular size={11} />
                  </Button>
                  <Button variant="ghost" size="sm" title="删除文件夹" aria-label={`删除文件夹 ${node.path}`} onClick={() => onRequestDelete(node.path, true)}>
                    <IconTrashOutlineRegular size={11} />
                  </Button>
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
                      indent={indent + 14}
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
              data-skill-file-row={node.path}
              onClick={() => onSelectFile(node.path)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectFile(node.path);
                }
              }}
              className={isSelected ? `${css.treeFileRow} ${css.treeFileRowSelected}` : css.treeFileRow}
              style={{ marginLeft: indent }}
            >
              <span aria-hidden="true" className={css.treeFileBullet}>
                ·
              </span>
              <span className={isSelected ? `${css.treeFileName} ${css.treeFileNameSelected}` : css.treeFileName}>
                {node.name}
              </span>
              <span style={{ flex: "0 0 auto" }} onClick={(event) => event.stopPropagation()}>
                <Button variant="ghost" size="sm" title="删除文件" aria-label={`删除文件 ${node.path}`} onClick={() => onRequestDelete(node.path, false)}>
                  <IconTrashOutlineRegular size={11} />
                </Button>
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * 元数据编辑表单：描述 / license / compatibility / MCP 关联（`PUT /skills/{name}/meta`）。
 * 四个字段一次提交；MCP 列表来自真实 `GET /mcp`，四种状态齐全。
 */
function MetaForm({ skill, onSaved }: { skill: SkillItem; onSaved: () => void }): React.ReactNode {
  const servers = useMcpServers();
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

  /** MCP 勾选区：只显示传输成功读到的服务器。 */
  const mcpPicker = (): React.ReactNode => {
    if (servers.phase === "loading") return <p className={css.fieldHint}>读取 MCP 服务器…</p>;
    if (servers.phase === "offline") {
      return (
        <>
          <p className={css.fieldHint}>未连接后端（读不到 MCP 服务器；不影响其它三个字段的保存）</p>
          {servers.error === null ? null : <ErrorLine text={servers.error} />}
          <Button variant="outline" size="sm" onClick={servers.reload}>
            重新读取
          </Button>
        </>
      );
    }
    if (servers.servers.length === 0) {
      return <p className={css.fieldHint}>暂无 MCP 服务器（可在设置「MCP」里添加后再关联）。</p>;
    }
    return (
      <div className={css.ruleMeta} style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        {servers.servers.map((server: MCPServer) => (
          <Checkbox
            key={server.id}
            checked={mcps.includes(server.name)}
            disabled={saving}
            label={server.name}
            onChange={(next) => {
              setMcps((prev) => (next ? [...prev, server.name] : prev.filter((item) => item !== server.name)));
              setDone(null);
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={css.formCard} data-skill-meta-form>
      <div className={css.subSectionTitle} style={{ marginTop: 0 }}>
        元数据
      </div>
      <p className={css.fieldHint}>保存走 PUT /skills/{skill.name}/meta；名称是目录名，不在这里改。</p>

      <label className={css.fieldLabel}>
        描述
        <textarea
          className={css.textArea}
          aria-label="技能描述"
          rows={2}
          disabled={saving}
          value={description}
          onChange={(event) => {
            setDescription(event.currentTarget.value);
            setDone(null);
          }}
        />
      </label>

      <div className={css.formRow}>
        <div className={css.fieldBlock} style={{ flex: "1 1 180px" }}>
          <div className={css.fieldLabel}>license</div>
          <input
            className={css.textField}
            aria-label="license"
            disabled={saving}
            value={license}
            onChange={(event) => {
              setLicense(event.currentTarget.value);
              setDone(null);
            }}
          />
        </div>
        <div className={css.fieldBlock} style={{ flex: "1 1 180px" }}>
          <div className={css.fieldLabel}>compatibility</div>
          <input
            className={css.textField}
            aria-label="compatibility"
            disabled={saving}
            value={compatibility}
            onChange={(event) => {
              setCompatibility(event.currentTarget.value);
              setDone(null);
            }}
          />
        </div>
      </div>

      <div className={css.fieldLabel} style={{ marginTop: 10 }}>
        关联 MCP（加载该技能时才解锁所选 MCP 的工具）
      </div>
      {mcpPicker()}

      {failure === null ? null : <ErrorLine text={`保存失败：${failure}`} />}
      <div className={css.formActions}>
        {done === null ? null : (
          <span className={css.formDoneText}>{done}</span>
        )}
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存元数据"}
        </Button>
      </div>
    </div>
  );
}

/** 调用统计：次数 / 覆盖任务 / 最近调用的明细列表（`GET /skills/{name}/usage?limit=20`）。 */
function UsageBlock({ skill }: { skill: SkillItem }): React.ReactNode {
  const usage = useSkillUsage(skill.name, 20);

  return (
    <div className={css.subSection} data-skill-usage>
      <div className={css.subSectionTitle}>调用统计</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div data-skill-usage-cell="calls" className={css.skillUsageCell}>
          <span className={css.skillUsageValue}>{skill.calls}</span>
          <span className={css.skillUsageLabel}>总调用次数</span>
        </div>
        <div data-skill-usage-cell="tasks" className={css.skillUsageCell}>
          <span className={css.skillUsageValue}>{skill.tasks}</span>
          <span className={css.skillUsageLabel}>覆盖任务数</span>
        </div>
        <div data-skill-usage-cell="last" className={css.skillUsageCell}>
          <span className={css.skillUsageTime}>{formatSkillTime(skill.last_used)}</span>
          <span className={css.skillUsageLabel}>最近调用</span>
        </div>
      </div>

      {skill.usage_agents.length === 0 ? null : (
        <div className={css.ruleMeta} style={{ marginTop: 8 }}>
          <span>调用方：</span>
          {skill.usage_agents.map((key) => (
            <Tag key={key} tone="neutral">
              {key}
            </Tag>
          ))}
        </div>
      )}

      <div className={css.ruleMeta} style={{ marginTop: 10, justifyContent: "space-between" }}>
        <span>最近调用明细（最多 20 条）</span>
        <Button variant="ghost" size="sm" onClick={usage.reload}>
          <IconRefreshOutlineRegular size={12} /> 重新读取
        </Button>
      </div>

      {usage.phase === "loading" ? <p className={css.fieldHint}>读取调用明细…</p> : null}
      {usage.phase === "offline" ? (
        <>
          <div role="alert">
            <ErrorLine text={`读取调用明细失败：${usage.error ?? ""}`} />
          </div>
          <Button variant="outline" size="sm" onClick={usage.reload}>
            重试
          </Button>
        </>
      ) : null}
      {usage.phase === "ready" && usage.calls.length === 0 ? (
        <p className={css.fieldHint}>还没有调用记录。</p>
      ) : null}
      {usage.phase === "ready" && usage.calls.length > 0 ? (
        <div className={css.ruleList}>
          {usage.calls.map((call: SkillCall, index) => (
            <div key={`${call.ts}-${index}`} className={css.deliveryRow} data-skill-usage-call={index}>
              <span className={css.deliveryTime}>{formatSkillTime(call.ts)}</span>
              <Tag tone="outline">{call.agent_key === "" ? "—" : call.agent_key}</Tag>
              <span className={css.usageCallMeta}>
                {call.task_id > 0 ? `任务 #${call.task_id}` : call.session_id === "" ? "—" : "对话会话"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 可见性：按 Agent 勾选（`GET/POST /visibility/skill/...`）。 */
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

  const body = (): React.ReactNode => {
    if (agents.phase === "loading" || visibility.phase === "loading") {
      return <p className={css.fieldHint}>读取 Agent 与可见性…</p>;
    }
    if (agents.phase === "offline" || visibility.phase === "offline") {
      return (
        <>
          <div role="alert">
            <ErrorLine text={`读取失败：${(agents.phase === "offline" ? agents.error : visibility.error) ?? ""}`} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              agents.reload();
              visibility.reload();
            }}
          >
            重新读取
          </Button>
        </>
      );
    }
    if (agents.agents.length === 0) return <p className={css.fieldHint}>暂无 Agent。</p>;
    return (
      <div className={css.ruleMeta} style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        {agents.agents.map((agent) => (
          <Checkbox
            key={agent.id}
            checked={visibility.agentIds.includes(agent.id)}
            disabled={busyAgent !== null}
            label={agent.name}
            onChange={(next) => toggle(agent.id, next)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={css.subSection} data-skill-visibility>
      <div className={css.subSectionTitle}>可见性（按 Agent 授权）</div>
      {body()}
      {failure === null ? null : <ErrorLine text={`操作失败：${failure}`} />}
    </div>
  );
}

/** 右侧编辑区：面包屑 + 未保存标记 + 保存 + textarea / 不可编辑提示。 */
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

  return (
    <div data-skill-editor={path} style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span className={css.skillCrumbName}>{skillName}</span>
        <span className={css.skillCrumbSep}>/</span>
        <span className={css.skillCrumbPath}>
          {path}
        </span>
        <Tag tone={dirty ? "warning" : "quiet"}>{dirty ? "未保存" : "已同步"}</Tag>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <Button variant="ghost" size="sm" disabled={saving} onClick={file.reload}>
            <IconRefreshOutlineRegular size={12} /> 重新读取
          </Button>
          <Button variant="primary" size="sm" disabled={!dirty || saving || !editable} onClick={save}>
            <IconSaveOutlineRegular size={12} /> {saving ? "保存中…" : "保存"}
          </Button>
          <button type="button" className={css.dangerBtn} onClick={() => onRequestDelete(path, false)}>
            <IconTrashOutlineRegular size={12} /> 删除
          </button>
        </span>
      </div>

      {file.phase === "loading" ? <p className={css.fieldHint}>读取文件…</p> : null}
      {file.phase === "offline" ? (
        <>
          <div role="alert">
            <ErrorLine text={`读取文件失败：${file.error ?? ""}`} />
          </div>
          <Button variant="outline" size="sm" onClick={file.reload}>
            重试
          </Button>
        </>
      ) : null}
      {file.phase === "idle" ? <p className={css.fieldHint}>未选择文件。</p> : null}
      {file.phase === "ready" && binary ? (
        <p className={css.fieldHint} style={{ margin: 0 }}>
          这个文件按二进制处理，不能在这里编辑（{file.content.length} 字符）。需要改它请直接改技能目录里的文件。
        </p>
      ) : null}
      {file.phase === "ready" && tooLarge ? (
        <p className={css.fieldHint} style={{ margin: 0 }}>
          文件过大（{file.content.length} 字符，上限 {SKILL_FILE_EDIT_LIMIT}），为避免把整份内容塞进编辑框，这里只禁用编辑。
        </p>
      ) : null}
      {file.phase === "ready" ? (
        <textarea
          className={`${css.textArea} ${css.skillEditorTextarea}`}
          aria-label={`编辑 ${path}`}
          data-skill-editor-textarea
          readOnly={!editable}
          value={editable ? draft : file.content}
          onChange={(event) => {
            if (!editable) return;
            setDraft(event.currentTarget.value);
            setDirty(event.currentTarget.value !== file.content);
          }}
        />
      ) : null}
      {failure === null ? null : <ErrorLine text={`保存失败：${failure}`} />}
    </div>
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
    const request =
      target.kind === "skill" ? Promise.resolve() : deleteSkillPath(name, target.path);
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

  const treeBody = (): React.ReactNode => {
    if (files.phase === "loading") return <p className={css.fieldHint}>读取文件列表…</p>;
    if (files.phase === "offline") {
      return (
        <>
          <div role="alert">
            <ErrorLine text={`读取文件列表失败：${files.error ?? ""}`} />
          </div>
          <Button variant="outline" size="sm" onClick={files.reload}>
            重试
          </Button>
        </>
      );
    }
    if (files.entries.length === 0) {
      return <p className={css.fieldHint}>这个技能目录里还没有文件；用下面的按钮新建一个。</p>;
    }
    return (
      <TreeNodes
        nodes={files.tree}
        depth={0}
        selectedPath={selectedPath}
        expanded={expanded}
        creating={creating !== null && creating.inDir === "" ? creating : null}
        onToggleDir={toggleDir}
        onSelectFile={(path) => setSelectedPath(path)}
        onStartCreate={startCreate}
        onCancelCreate={() => setCreating(null)}
        onSubmitCreate={submitCreate}
        onRequestDelete={(path, isDir) => {
          setDeleteFailure(null);
          setPendingDelete({ kind: "path", path, isDir });
        }}
      />
    );
  };

  return (
    <div data-skill-detail={name}>
      <div className={css.pageToolbar} style={{ marginTop: 0 }}>
        <Button variant="outline" size="sm" onClick={onBack}>
          <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
            <IconChevronRightOutlineRegular size={12} />
          </span>{" "}
          返回列表
        </Button>
        <span className={css.skillDetailTitle}>{name}</span>
        <Button variant="ghost" size="sm" onClick={files.reload}>
          <IconRefreshOutlineRegular size={12} /> 刷新文件
        </Button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* 左：文件树 */}
        <div
          data-skill-tree
          style={{
            flex: `0 0 ${TREE_WIDTH}px`,
            minWidth: 0,
            maxHeight: 360,
            overflow: "auto",
            padding: "6px 4px",
            border: "0.5px solid var(--dsw-alias-settings-card-stroke)",
            borderRadius: "var(--dsw-radius-lg)",
            background: "var(--dsw-alias-settings-card-fill)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" disabled={files.phase !== "ready"} onClick={() => startCreate("", "file")}>
              <IconPlusOutlineRegular size={11} /> 新建文件
            </Button>
            <Button variant="ghost" size="sm" disabled={files.phase !== "ready"} onClick={() => startCreate("", "dir")}>
              <IconFolderCloseRegular size={11} /> 新建文件夹
            </Button>
          </div>
          {creating !== null && creating.inDir === "" ? (
            <CreateEntryRow
              indent={8}
              kind={creating.kind}
              onCancel={() => setCreating(null)}
              onSubmit={(entryName) => submitCreate("", creating.kind, entryName)}
            />
          ) : null}
          {createFailure === null ? null : <ErrorLine text={`创建失败：${createFailure}`} />}
          {treeBody()}
        </div>

        {/* 右：编辑区 */}
        <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedPath === null ? (
            <div className={css.skillEditorEmpty}>
              <p className={css.fieldHint} style={{ margin: 0 }}>
                从左边选一个文件查看和编辑；也可以先用「新建文件 / 新建文件夹」建条目。
              </p>
            </div>
          ) : (
            <FileEditor
              skillName={name}
              path={selectedPath}
              onSaved={() => {
                files.reload();
                onChanged();
              }}
              onRequestDelete={(path, isDir) => {
                setDeleteFailure(null);
                setPendingDelete({ kind: "path", path, isDir });
              }}
            />
          )}
        </div>
      </div>

      {skill === null ? null : <MetaForm skill={skill} onSaved={onChanged} />}
      {skill === null ? null : <UsageBlock skill={skill} />}
      {skill === null ? null : <VisibilityBlock skill={skill} />}

      {skill === null ? (
        <p className={css.fieldHint}>技能列表里还没有读到「{name}」的记录（统计与元数据暂不显示）；文件操作不受影响。</p>
      ) : null}

      <div className={css.subSection}>
        <button
          type="button"
          className={css.dangerBtn}
          onClick={() => {
            setDeleteFailure(null);
            setPendingDelete({ kind: "skill" });
          }}
        >
          <IconTrashOutlineRegular size={12} /> 删除整个技能
        </button>
        <span className={css.skillDangerHint}>
          会一并删除全部文件、MCP 关联与可见性配置（旧页同一入口在列表行上，这里放在详情里以防误删）。
        </span>
      </div>

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
        {deleteFailure === null ? null : <ErrorLine text={`删除失败：${deleteFailure}`} />}
        {pendingDelete !== null && pendingDelete.kind === "skill" ? (
          <p className={css.dialogBodyText}>
            确认后会先回到技能列表，列表刷新时该技能已不存在；删除结果失败时会在这里显示原因。
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
