"use client";

/**
 * 设置弹窗「通用设置」页末的分类与模板两个分节（C11 · P1:A26 / P1:A27 / P1:A28 / P1:A29）：
 *   1. 任务分类管理：列出该分类的 `task_count` 与新名称输入框，新建 / 重命名 / 删除；
 *      删除用 Modal 二次确认，并写清真实后端行为（任务移入「未分类」，任务本身不删）。
 *   2. 任务并发限制：`task_concurrency_enabled` / `task_concurrency_limit` 两个字段，
 *      由 `useSettings` 一次读入、保存时一次 `PUT /settings` 写回。
 *   3. 任务模板管理：列表 + 新建 / 编辑 / 删除（`/task-templates` 四个接口都存在，故不做选择器之外的占位）。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:2742-3060`（CategoryManagementSheet：
 *   左侧分类列表带任务数、右侧名称输入框、新建/保存/删除、删除确认文案 :3038-3053）、
 *   `:1075-1154`（并发设置弹窗：开关 + 上限，保存一次 PUT）、
 *   `components/task-template-controls.tsx:206-319`（模板管理：左侧列表 + 右侧表单 + 删除确认 :321-342）。
 * DSH 依据：DSH 无分类 / 模板 / 并发的设置项；按总表 §4.3「设置分节内的子区块」扩展，
 *   容器与样式复用 `SettingsDialog.module.css` 的 group / groupLabel / ruleList / ruleRow /
 *   ruleMain / ruleMeta / ruleActions / formCard / fieldBlock / textField / textArea / formActions /
 *   errorLine / subSection / subSectionTitle / dangerBtn / linkBtn。
 * 对照表行：P1:A26 P1:A27 P1:A28 P1:A29
 *
 * 删除分类的真实后端行为（已核对）：`ARTEX/db/task_categories.go:149-158` 删除分类行，
 * 关联任务经 `tasks.category_id ON DELETE SET NULL` 外键移入「未分类」；
 * `ARTEX/server/manager.go:940-959` 同步清空内存任务上的 `CategoryID` / `CategoryName`。
 * 任务本体、发现、资产、会话都不受影响。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { TaskCategory, TaskTemplate } from "@/lib/types";
import {
  createTaskCategory,
  createTaskTemplate,
  deleteTaskCategory,
  deleteTaskTemplate,
  renameTaskCategory,
  TASK_CATEGORY_NAME_MAX,
  TASK_TEMPLATE_NAME_MAX,
  updateTaskTemplate,
  useTaskTemplates,
} from "@/v2/data/task-categories";
import { useTaskCategories } from "@/v2/data/task-create";
import { saveSettingsPatch, type SettingsState } from "@/v2/data/settings";
import { SelectMenu } from "./SelectMenu";
import { SettingsRow } from "./SettingsRow";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";

/** 行容器与 SettingsDialog.tsx / SettingsExtras.tsx 共用同一份（SettingsRow.tsx）。 */
const Row = SettingsRow;

/** 后端错误文案里出现 HTTP 409 时对应的同名冲突提示（`server/task_categories.go:49`）。 */
const CATEGORY_CONFLICT_HINT = "分类名称已存在";

/** unix / ISO 时间文案：这里只用 `updated_at` 的 ISO 串，解析失败就原样显示。 */
function formatIso(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "—";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

// ---------------------------------------------------------------------------
// P1:A26 · 任务分类管理
// ---------------------------------------------------------------------------

/** 分类分区的四种状态：读取中 / 读取失败可重试 / 暂无分类 / 有分类。 */
function CategorySection(): React.ReactNode {
  const categories = useTaskCategories();
  // `null` = 正在新建；number = 正在编辑该 id 的分类；选中项决定右侧输入框的内容。
  const [selected, setSelected] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [writeError, setWriteError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<TaskCategory | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const current = selected === null ? null : (categories.categories.find((item) => item.id === selected) ?? null);
  const trimmed = draft.trim();
  const unchanged = current !== null && trimmed === current.name;
  // 新建时必须填名字；改名时必须填名字且确实变了；后端上限 80 字（db/task_categories.go:14）。
  const canSave = !saving && trimmed !== "" && !unchanged && Array.from(trimmed).length <= TASK_CATEGORY_NAME_MAX;

  const startNew = (): void => {
    setSelected(null);
    setDraft("");
    setWriteError(null);
  };

  const pick = (category: TaskCategory): void => {
    setSelected(category.id);
    setDraft(category.name);
    setWriteError(null);
  };

  const save = (): void => {
    if (!canSave) return;
    setSaving(true);
    setWriteError(null);
    const request = selected === null ? createTaskCategory(trimmed) : renameTaskCategory(selected, trimmed);
    request
      .then((value) => {
        setSaving(false);
        setSelected(value.id);
        setDraft(value.name);
        toast(selected === null ? "分类已创建" : "分类已重命名");
        categories.reload();
      })
      .catch((reason: unknown) => {
        setSaving(false);
        const message = reason instanceof Error ? reason.message : String(reason);
        setWriteError(
          message.includes("409") || message.includes(CATEGORY_CONFLICT_HINT)
            ? `${message}（分类名称不能重复，换一个名字再试）`
            : message,
        );
      });
  };

  const confirmDelete = (): void => {
    if (confirming === null || deleting) return;
    setDeleting(true);
    setWriteError(null);
    deleteTaskCategory(confirming.id)
      .then(() => {
        setDeleting(false);
        setConfirming(null);
        // 删掉的是当前选中项就退回「新建」态，避免输入框停在一个已不存在的分类上。
        setSelected(null);
        setDraft("");
        toast("分类已删除，原分类下的任务已移入未分类");
        categories.reload();
      })
      .catch((reason: unknown) => {
        setDeleting(false);
        setWriteError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <div className={css.subSection} data-task-category-section="">
      <h3 className={css.subSectionTitle}>任务分类</h3>
      <p className={css.pageLead}>
        分类用于侧栏的分组显示：任务上的分类字段（`category_name`）决定它落在哪一组。分类与任务是多对一，改名不影响任务本身的内容。
      </p>

      {categories.phase === "loading" ? (
        <p className={css.pageLead} role="status">读取分类…</p>
      ) : categories.phase === "offline" ? (
        <p className={css.errorLine} role="alert">
          读取分类失败：{categories.error}
          <Button variant="outline" size="sm" onClick={categories.reload}>重试</Button>
        </p>
      ) : categories.categories.length === 0 ? (
        <p className={css.pageLead}>暂无分类，在下面新建一个。</p>
      ) : (
        <div className={css.ruleList}>
          {categories.categories.map((category) => (
            <div className={css.ruleRow} key={category.id} data-task-category-id={category.id}>
              <div className={css.ruleMain}>
                <span className={css.rowLabel}>{category.name}</span>
                <span className={css.ruleMeta}>
                  <Tag tone="quiet">{category.task_count} 个任务</Tag>
                  <span>更新于 {formatIso(category.updated_at)}</span>
                </span>
              </div>
              <div className={css.ruleActions}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving || deleting}
                  data-task-category-edit={category.id}
                  onClick={() => pick(category)}
                >
                  重命名
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={css.dangerBtn}
                  disabled={saving || deleting}
                  data-task-category-delete={category.id}
                  onClick={() => setConfirming(category)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={css.formCard}>
        <div className={css.fieldBlock}>
          <span className={css.fieldLabel}>{current === null ? "新分类名称" : `重命名「${current.name}」`}</span>
          <input
            className={css.textField}
            value={draft}
            maxLength={TASK_CATEGORY_NAME_MAX}
            aria-label="分类名称"
            data-task-category-name-input=""
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
          />
        </div>
        <div className={css.formActions}>
          {current !== null ? (
            <Button variant="ghost" size="sm" disabled={saving} onClick={startNew}>
              取消重命名
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            data-task-category-save=""
            onClick={save}
          >
            {saving ? "保存中…" : current === null ? "新建分类" : "保存名称"}
          </Button>
        </div>
        {writeError === null ? null : (
          <p className={css.errorLine} role="alert" data-task-category-error="">
            {writeError}
          </p>
        )}
      </div>

      <Modal
        open={confirming !== null}
        onClose={() => {
          if (!deleting) setConfirming(null);
        }}
        closeLabel="关闭"
        title="删除分类"
        tone="warning"
        description={`删除分类「${confirming?.name ?? ""}」后，该分类下的 ${confirming?.task_count ?? 0} 个任务会被移到「未分类」（任务本身、发现、资产、会话都不会删除）。此操作不可撤销。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirming(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={deleting}
              data-task-category-delete-confirm=""
              onClick={confirmDelete}
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={css.rowHint}>
          后端行为：删除分类记录后，任务上的分类引用被置空（外键 ON DELETE SET NULL），任务回到「未分类」分组。
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P1:A29 · 任务并发限制
// ---------------------------------------------------------------------------

/** 并发限制分区：一个开关 + 上限，保存时一次 PUT /settings（旧页 page.tsx:1093-1105）。 */
function ConcurrencySection({ server }: { server: SettingsState }): React.ReactNode {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [limit, setLimit] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // 后端值到了就回填一次；用户改动后不覆盖（`enabled`/`limit` 一旦非 null 就是用户态）。
  React.useEffect(() => {
    if (server.data === null) return;
    setEnabled((current) => current ?? server.data?.task_concurrency_enabled === true);
    setLimit((current) => current ?? String(server.data?.task_concurrency_limit ?? 5));
  }, [server.data]);

  if (server.phase === "loading") {
    return (
      <div className={css.subSection}>
        <h3 className={css.subSectionTitle}>任务并发</h3>
        <p className={css.pageLead} role="status">读取设置…</p>
      </div>
    );
  }
  if (server.phase === "offline" || enabled === null || limit === null) {
    return (
      <div className={css.subSection}>
        <h3 className={css.subSectionTitle}>任务并发</h3>
        <p className={css.errorLine} role="alert">
          读取设置失败：{server.error ?? "未拿到并发字段"}
          <Button variant="outline" size="sm" onClick={server.reload}>重试</Button>
        </p>
      </div>
    );
  }

  const parsed = Math.floor(Number(limit));
  const limitValid = Number.isFinite(parsed) && parsed >= 1;
  const nextLimit = limitValid ? parsed : 5;

  const save = (): void => {
    if (saving || (enabled && !limitValid)) return;
    setSaving(true);
    setFailure(null);
    saveSettingsPatch({ task_concurrency_enabled: enabled, task_concurrency_limit: nextLimit })
      .then(() => {
        setSaving(false);
        toast(enabled ? `已开启并发限制：最多同时运行 ${nextLimit} 个任务` : "已关闭任务并发限制");
        server.reload();
      })
      .catch((reason: unknown) => {
        setSaving(false);
        setFailure(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <div className={css.subSection} data-task-concurrency-section="">
      <h3 className={css.subSectionTitle}>任务并发</h3>
      <Row label="开启任务并发限制" hint="默认关闭。开启后可限制同时运行的任务数，达到上限后新任务按创建顺序排队。">
        <Switch checked={enabled} onChange={setEnabled} label="开启任务并发限制" />
      </Row>
      <Row label="同时运行上限" hint="开启后生效，最少 1 个；后端缺省为 5。">
        <input
          className={css.numberInput}
          type="number"
          min={1}
          step={1}
          value={limit}
          disabled={!enabled || saving}
          aria-label="同时运行上限"
          data-task-concurrency-limit=""
          onChange={(event) => setLimit(event.target.value)}
        />
      </Row>
      {enabled && !limitValid ? (
        <p className={css.errorLine} role="alert">上限必须是大于 0 的整数。</p>
      ) : null}
      {failure === null ? null : (
        <p className={css.errorLine} role="alert" data-task-concurrency-error="">
          保存失败：{failure}
        </p>
      )}
      <div className={css.formActions}>
        <Button variant="primary" size="sm" disabled={saving || (enabled && !limitValid)} data-task-concurrency-save="" onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P1:A28 · 任务模板管理
// ---------------------------------------------------------------------------

/** 模板编辑表单的草稿（分类用 `null` 表示「未分类」）。 */
interface TemplateDraft {
  name: string;
  description: string;
  goal: string;
  categoryId: number | null;
}

const EMPTY_TEMPLATE: TemplateDraft = { name: "", description: "", goal: "", categoryId: null };

/**
 * 任务级拦截规则编辑器（`ARTEX/web/src/components/asset-intercept-rules-editor.tsx`）是旧页面的
 * shadcn 组件，既不在本单元写域内、也不允许在 /v2 引入，所以模板的 `intercept_rules` 字段
 * 在这里只原样保留、不提供编辑控件（不画不能用的输入框）：更新时若草稿没有该字段就不发送它
 * （PATCH 语义），后端保留原值。建模板时 `createTaskTemplate` 也不带规则（后端默认空数组）。
 */
function TemplateSection(): React.ReactNode {
  const templates = useTaskTemplates();
  const categories = useTaskCategories();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<TemplateDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [writeError, setWriteError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<TaskTemplate | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const startNew = (): void => {
    setSelectedId(null);
    setDraft({ ...EMPTY_TEMPLATE });
    setWriteError(null);
  };

  const pick = (template: TaskTemplate): void => {
    setSelectedId(template.id);
    setDraft({
      name: template.name,
      description: template.description,
      goal: template.goal,
      categoryId: template.category_id ?? null,
    });
    setWriteError(null);
  };

  const name = (draft?.name ?? "").trim();
  const description = (draft?.description ?? "").trim();
  // 模板的 name / description / goal 三个字段后端都要求非空（db/task_templates.go:103-113）。
  const goal = (draft?.goal ?? "").trim();
  const nameTooLong = Array.from(name).length > TASK_TEMPLATE_NAME_MAX;
  const canSave = !saving && draft !== null && name !== "" && description !== "" && goal !== "" && !nameTooLong;

  const save = (): void => {
    if (!canSave || draft === null) return;
    setSaving(true);
    setWriteError(null);
    const payload = {
      name,
      description,
      goal,
      category_id: draft.categoryId,
    };
    const request = selectedId === null ? createTaskTemplate(payload) : updateTaskTemplate(selectedId, payload);
    request
      .then((value) => {
        setSaving(false);
        setSelectedId(value.id);
        pick(value);
        toast(selectedId === null ? "模板已创建" : "模板已保存");
        templates.reload();
      })
      .catch((reason: unknown) => {
        setSaving(false);
        setWriteError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const confirmDelete = (): void => {
    if (confirming === null || deleting) return;
    setDeleting(true);
    setWriteError(null);
    deleteTaskTemplate(confirming.id)
      .then(() => {
        setDeleting(false);
        setConfirming(null);
        setSelectedId(null);
        setDraft(null);
        toast("模板已删除");
        templates.reload();
      })
      .catch((reason: unknown) => {
        setDeleting(false);
        setWriteError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const categoryOptions = [
    { value: "none", label: "未分类" },
    ...categories.categories.map((item) => ({ value: String(item.id), label: item.name })),
  ];

  return (
    <div className={css.subSection} data-task-template-section="">
      <h3 className={css.subSectionTitle}>任务模板</h3>
      <p className={css.pageLead}>
        模板保存描述、目标与预设分类；在新建任务弹窗里选择模板即可预填这三项（复制语义，不与模板保持关联）。模板的任务级拦截规则可以在旧页维护，这里只原样保留、不修改。
      </p>

      {templates.phase === "loading" ? (
        <p className={css.pageLead} role="status">读取模板…</p>
      ) : templates.phase === "offline" ? (
        <p className={css.errorLine} role="alert">
          读取模板失败：{templates.error}
          <Button variant="outline" size="sm" onClick={templates.reload}>重试</Button>
        </p>
      ) : templates.templates.length === 0 ? (
        <p className={css.pageLead}>暂无模板</p>
      ) : (
        <div className={css.ruleList}>
          {templates.templates.map((template) => (
            <div className={css.ruleRow} key={template.id} data-task-template-id={template.id}>
              <div className={css.ruleMain}>
                <span className={css.rowLabel}>{template.name}</span>
                <span className={css.ruleMeta}>
                  <span>{template.description}</span>
                  <span>更新于 {formatIso(template.updated_at)}</span>
                </span>
              </div>
              <div className={css.ruleActions}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving || deleting}
                  data-task-template-edit={template.id}
                  onClick={() => pick(template)}
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={css.dangerBtn}
                  disabled={saving || deleting}
                  data-task-template-delete={template.id}
                  onClick={() => setConfirming(template)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={css.pageToolbar}>
        <Button
          variant="outline"
          size="sm"
          icon={<IconPlusOutlineRegular size={12} />}
          disabled={saving || deleting}
          data-task-template-new=""
          onClick={startNew}
        >
          新建模板
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={templates.phase === "loading"}
          onClick={templates.reload}
        >
          刷新
        </Button>
      </div>

      {draft === null ? null : (
        <div className={css.formCard} data-task-template-form="">
          <div className={css.fieldBlock}>
            <span className={css.fieldLabel}>模板名称</span>
            <input
              className={css.textField}
              value={draft.name}
              maxLength={TASK_TEMPLATE_NAME_MAX}
              aria-label="模板名称"
              data-task-template-name-input=""
              onChange={(event) => {
                const next = event.target.value;
                setDraft((current) => (current === null ? current : { ...current, name: next }));
              }}
            />
          </div>
          <div className={css.fieldBlock}>
            <span className={css.fieldLabel}>描述</span>
            <textarea
              className={css.textArea}
              value={draft.description}
              aria-label="模板描述"
              onChange={(event) => {
                const next = event.target.value;
                setDraft((current) => (current === null ? current : { ...current, description: next }));
              }}
            />
          </div>
          <div className={css.fieldBlock}>
            <span className={css.fieldLabel}>目标</span>
            <textarea
              className={css.textArea}
              value={draft.goal}
              aria-label="模板目标"
              onChange={(event) => {
                const next = event.target.value;
                setDraft((current) => (current === null ? current : { ...current, goal: next }));
              }}
            />
          </div>
          <div className={css.formRow}>
            <div className={css.fieldBlock}>
              <span className={css.fieldLabel}>预设分类</span>
              <SelectMenu
                ariaLabel="模板预设分类"
                value={draft.categoryId === null ? "none" : String(draft.categoryId)}
                options={categoryOptions}
                onChange={(value) => {
                  const next = value === "none" ? null : Number(value);
                  setDraft((current) => (current === null ? current : { ...current, categoryId: next }));
                }}
              />
            </div>
          </div>
          <div className={css.formActions}>
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={!canSave} data-task-template-save="" onClick={save}>
              {saving ? "保存中…" : selectedId === null ? "创建模板" : "保存模板"}
            </Button>
          </div>
          {writeError === null ? null : (
            <p className={css.errorLine} role="alert" data-task-template-error="">
              {writeError}
            </p>
          )}
        </div>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => {
          if (!deleting) setConfirming(null);
        }}
        closeLabel="关闭"
        title="删除模板"
        tone="warning"
        description={`删除模板「${confirming?.name ?? ""}」？已用它创建的任务不受影响（模板只是建任务时的复制来源）。此操作不可撤销。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirming(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={deleting}
              data-task-template-delete-confirm=""
              onClick={confirmDelete}
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={css.rowHint}>
          模板与任务之间没有引用关系：删除模板不会改动任何已有任务的描述、目标或分类。
        </div>
      </Modal>
    </div>
  );
}

/**
 * 设置通用页末尾追加的三个分节（C11）。
 * @param props.server - 通用页已经持有的 `useSettings()` 状态，并发分区复用它，不另开一次 GET /settings。
 * @returns 分类 / 并发 / 模板三个分节。
 */
export function TaskCategorySettings({ server }: { server: SettingsState }): React.ReactNode {
  return (
    <>
      <CategorySection />
      <ConcurrencySection server={server} />
      <TemplateSection />
    </>
  );
}
