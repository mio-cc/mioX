"use client";

/**
 * 设置分节「技能」：技能库的列表与调用总览，新建 / 上传 zip / 删除三种写操作。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/skills/page.tsx:192-293（总览：指标 + 调用排行 +
 *   最近调用 + 从未使用）、:767-806（技能行：名称 / 调用次数徽标 / 删除）、:1015-1124（新建表单：
 *   名称、描述、license、compatibility、正文、关联 MCP）、:740-760（上传 zip 入口）、
 *   :986-1012（删除二次确认）。文件树、文件编辑、元数据、调用统计、可见性在详情页
 *   `SkillDetail.tsx`（B03：P3:K5–K12），本文件只负责把技能行接到详情。
 * DSH 依据：DSH 无技能库管理页；按 设置分节 扩展（总表 §4.3），行/卡片素材复用
 *   SettingsDialog.module.css（ruleList / ruleRow / formCard / pageToolbar …）。
 * 对照表行：P3:K1 P3:K2 P3:K3 P3:K4
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  IconUploadOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

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
import css from "./SettingsDialog.module.css";

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

/** 把异常转成可展示文案。 */
function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 总览里的一个指标格（数值全部来自 `summarizeSkills`）。 */
function StatCell({ label, value, hint }: { label: string; value: number; hint: string }): React.ReactNode {
  return (
    <div data-skill-stat={label} className={css.skillStatCell}>
      <span className={css.skillStatValue}>{value}</span>
      <span className={css.skillStatLabel}>{label}</span>
      <span className={css.skillStatHint}>{hint}</span>
    </div>
  );
}

/**
 * 顶部总览：指标、调用排行前 5、最近调用、从未使用。
 * 三块都只在 `skills()` 的返回值里有对应字段时才显示，取不到的不显示。
 */
function SkillsOverviewBlock({ skills, missing }: { skills: SkillItem[]; missing: number | null }): React.ReactNode {
  const agg = React.useMemo(() => summarizeSkills(skills), [skills]);
  return (
    <div data-skills-overview style={{ margin: "0 0 6px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatCell label="技能总数" value={skills.length} hint={`${agg.usedCount} 个被调用过`} />
        <StatCell label="累计调用" value={agg.totalCalls} hint="来自 skill_usage 账本" />
        <StatCell
          label="未使用"
          value={agg.neverUsed.length}
          hint={agg.neverUsed.length > 0 ? "从未被任何 agent 加载" : "全部用过"}
        />
        {missing === null ? null : (
          <StatCell label="缺失技能" value={missing} hint="被点名但不存在" />
        )}
      </div>

      {agg.ranked.length === 0 ? null : (
        <div className={css.subSection}>
          <div className={css.subSectionTitle}>调用排行（前 {agg.ranked.length}）</div>
          <div className={css.ruleList}>
            {agg.ranked.map((row) => (
              <div key={row.name} className={css.deliveryRow} data-skill-rank={row.name}>
                <span className={css.rulePattern} title={row.name}>{row.name}</span>
                <span className={css.skillRankCount}>
                  {row.calls} 次
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        {agg.recent.length === 0 ? null : (
          <div className={css.subSection} style={{ flex: "1 1 220px" }} data-skills-recent>
            <div className={css.subSectionTitle}>最近调用</div>
            <div className={css.ruleList}>
              {agg.recent.map((row) => (
                <div key={row.name} className={css.deliveryRow} data-skill-recent={row.name}>
                  <span className={css.rulePattern} title={row.name}>{row.name}</span>
                  <span className={css.deliveryTime}>{formatSkillTime(row.lastUsed)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {agg.neverUsed.length === 0 ? null : (
          <div className={css.subSection} style={{ flex: "1 1 220px" }} data-skills-never-used>
            <div className={css.subSectionTitle}>从未使用（{agg.neverUsed.length}）</div>
            <div className={css.ruleMeta}>
              {agg.neverUsed.map((name) => (
                <Tag key={name} tone="quiet">{name}</Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 技能行：名称、描述、调用次数、删除（二次确认）；点行进入详情（B03）。 */
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

  return (
    <>
      <div className={css.ruleRow} data-skill-name={skill.name}>
        <div
          className={css.ruleMain}
          role="button"
          tabIndex={0}
          title={`打开技能详情：${skill.name}`}
          data-skill-open={skill.name}
          style={{ cursor: "pointer" }}
          onClick={() => onOpen(skill.name)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(skill.name);
            }
          }}
        >
          <div className={css.ruleMeta}>
            <span className={css.rowLabel}>{skill.name}</span>
            <Tag tone={skill.calls > 0 ? "neutral" : "quiet"}>
              {skill.calls > 0 ? `调用 ${skill.calls} 次` : "从未调用"}
            </Tag>
            {skill.last_used === undefined || skill.last_used === "" ? null : (
              <span className={css.deliveryTime}>最近 {formatSkillTime(skill.last_used)}</span>
            )}
            {skill.mcps !== undefined && skill.mcps.length > 0 ? (
              <Tag tone="outline">MCP × {skill.mcps.length}</Tag>
            ) : null}
          </div>
          <div className={css.ruleMeta}>
            {skill.description === undefined || skill.description === "" ? (
              <span className={css.fieldHint}>（无描述）</span>
            ) : (
              <span title={skill.description} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {skill.description}
              </span>
            )}
          </div>
          {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
        </div>
        <div className={css.ruleActions}>
          <Button variant="outline" size="sm" data-skill-detail-open={skill.name} onClick={() => onOpen(skill.name)}>
            进入详情
          </Button>
          <button type="button" className={css.dangerBtn} disabled={busy} onClick={() => setDeleting(true)}>
            <IconTrashOutlineRegular size={13} /> 删除
          </button>
        </div>
      </div>

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
            <Button variant="primary" size="sm" disabled={busy} onClick={confirmDelete}>
              {busy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className={css.dialogBodyText}>
          技能目录会被整个删除，已经加载过它的任务不会因此失去历史记录，但后续无法再加载。
        </p>
        {failure === null ? null : <p className={css.errorLine}>删除失败：{failure}</p>}
      </Modal>
    </>
  );
}

/** 新建技能表单：名称 / 描述 / license / compatibility / 正文 / MCP 依赖。 */
function SkillForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }): React.ReactNode {
  const [draft, setDraft] = React.useState<SkillDraft>(EMPTY_DRAFT);
  const [mcps, setMcps] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const servers = useMcpServers();

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

  /** MCP 依赖勾选区：列表来自真实 `GET /mcp`，四种状态齐全。 */
  const mcpPicker = (): React.ReactNode => {
    if (servers.phase === "loading") return <p className={css.fieldHint}>读取 MCP 服务器…</p>;
    if (servers.phase === "offline") {
      return (
        <>
          <p className={css.fieldHint}>未连接后端（读不到 MCP 服务器，可以不选 MCP 依赖直接创建）</p>
          {servers.error === null ? null : <p className={css.errorLine}>{servers.error}</p>}
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
            onChange={(next) => toggleMcp(server.name, next)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={css.formCard} data-skills-create-form>
      <div className={css.subTitle}>新建技能</div>
      <p className={css.fieldHint}>
        会在技能目录下创建同名文件夹与 SKILL.md；名称用作唯一目录名。
      </p>

      <label className={css.fieldLabel}>
        名称（必填）
        <input
          className={css.textField}
          aria-label="技能名称"
          value={draft.name}
          disabled={saving}
          onChange={(event) => set({ name: event.currentTarget.value })}
        />
      </label>

      <label className={css.fieldLabel}>
        描述（必填）
        <textarea
          className={css.textArea}
          aria-label="技能描述"
          rows={2}
          value={draft.description}
          disabled={saving}
          onChange={(event) => set({ description: event.currentTarget.value })}
        />
      </label>

      <div className={css.formRow}>
        <div className={css.fieldBlock} style={{ flex: "1 1 200px" }}>
          <div className={css.fieldLabel}>license</div>
          <input
            className={css.textField}
            aria-label="license"
            value={draft.license}
            disabled={saving}
            onChange={(event) => set({ license: event.currentTarget.value })}
          />
        </div>
        <div className={css.fieldBlock} style={{ flex: "1 1 200px" }}>
          <div className={css.fieldLabel}>compatibility</div>
          <input
            className={css.textField}
            aria-label="compatibility"
            value={draft.compatibility}
            disabled={saving}
            onChange={(event) => set({ compatibility: event.currentTarget.value })}
          />
        </div>
      </div>

      <label className={css.fieldLabel}>
        正文（留空时后端生成骨架）
        <textarea
          className={css.textArea}
          aria-label="技能正文"
          rows={8}
          value={draft.instructions}
          disabled={saving}
          onChange={(event) => set({ instructions: event.currentTarget.value })}
        />
      </label>

      <div className={css.fieldLabel}>MCP 依赖（加载该技能时才解锁所选 MCP 的工具）</div>
      {mcpPicker()}

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "创建中…" : "创建"}
        </Button>
      </div>
    </div>
  );
}

/** 上传 zip：一个「覆盖同名」Checkbox + 文件选择；结果与失败原因写在页面上。 */
function UploadBlock({ onUploaded }: { onUploaded: () => void }): React.ReactNode {
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
        onUploaded();
      })
      .catch((reason: unknown) => {
        const message = reasonText(reason);
        setFailure(
          message.includes("已存在") && !overwrite
            ? `${message}——如需覆盖同名技能，勾选「覆盖同名」后再上传。`
            : message,
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div data-skills-upload style={{ marginTop: 10 }}>
      <div className={css.filterBar}>
        <Checkbox
          checked={overwrite}
          disabled={busy}
          label="覆盖同名"
          onChange={(next) => setOverwrite(next)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          data-skills-upload-input
          onChange={onPick}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconUploadOutlineRegular size={13} /> {busy ? "上传中…" : "上传压缩包 (.zip)"}
        </Button>
      </div>
      {result === null ? null : <p className={css.skillUploadResult}>{result}</p>}
      {failure === null ? null : <p className={css.errorLine}>上传失败：{failure}</p>}
    </div>
  );
}

export function SkillsPage(): React.ReactNode {
  const state = useSkills();
  const [adding, setAdding] = React.useState(false);
  // 详情：点技能行 / 「进入详情」打开，详情里有「返回列表」（B03）。
  const [opened, setOpened] = React.useState<string | null>(null);

  if (state.phase === "loading") return <p className={css.pageLead}>读取技能库…</p>;
  if (state.phase === "offline") {
    return (
      <>
        <h2 className={css.pageTitle}>技能</h2>
        <p className={css.pageLead}>未连接后端（读不到技能库）</p>
        {state.error === null ? null : <p className={css.errorLine}>{state.error}</p>}
        <Button variant="outline" size="sm" onClick={state.reload}>
          重新读取
        </Button>
      </>
    );
  }

  if (opened !== null) {
    return (
      <>
        <h2 className={css.pageTitle}>技能</h2>
        <SkillDetail
          name={opened}
          skill={state.skills.find((item) => item.name === opened) ?? null}
          onBack={() => {
            setOpened(null);
            state.reload();
          }}
          onChanged={state.reload}
        />
      </>
    );
  }

  return (
    <>
      <h2 className={css.pageTitle}>技能</h2>
      <p className={css.pageLead}>
        来自 GET /skills，共 {state.skills.length} 个技能 · 调用统计来自 skill_usage 账本。
      </p>
      <div className={css.pageToolbar}>
        <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
          <IconPlusOutlineRegular size={13} /> 新建技能
        </Button>
        <Button variant="ghost" size="sm" onClick={state.reload}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>

      <UploadBlock
        onUploaded={() => {
          state.reload();
        }}
      />

      {adding ? (
        <SkillForm
          onSaved={() => {
            setAdding(false);
            state.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {state.skills.length === 0 ? (
        <p className={css.pageLead}>暂无技能；点「新建技能」创建一个，或「上传压缩包 (.zip)」安装一个。</p>
      ) : (
        <>
          <SkillsOverviewBlock skills={state.skills} missing={state.missing === null ? null : state.missing.length} />
          <div className={css.ruleList}>
            {state.skills.map((skill) => (
              <SkillRow key={skill.name} skill={skill} onChanged={state.reload} onOpen={setOpened} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
