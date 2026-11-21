"use client";

/**
 * 企业管理页（对照表 P2:D3–P2:D7）：企业列表（名称 / 资产数 / 资产范围 / 操作）、
 * 新建企业（名称唯一 + 范围 DSL 逐行编辑 + 保存）、编辑资产范围（覆盖保存 + 归属依据）、
 * 追加资产范围（+ 归属依据）、删除企业（二次确认 + 「同时删除该企业下所有资产」选项，默认不勾选）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/assets/page.tsx:352-410（企业表格列与空态）、
 * :1000-1053（新增企业）、:1074-1136（覆盖保存）、:1153-1214（追加）、:208-226 与 :764-810（删除）、
 * :946-974（首字母头像、已存范围回填、warnings 展示）；
 * 范围逐行解析复用 `ARTEX/web/src/lib/company-scope.ts:173-196`（旧页 :64 同一函数，只读引用）。
 * DSH 依据：DSH 无企业管理页，按「主区整页」扩展（总表 §4.1）；外壳照
 * `components/v2/workspace/WorkspacePage.tsx:182-452`，弹窗照
 * `components/v2/data-pages/AssetDeleteDialog.tsx:68-97` 与总表 §5.5。
 * 主区整页的 body 不带参数、自己通过 `v2/data/companies.ts` 取数。
 * 对照表行：P2:D3 P2:D4 P2:D5 P2:D6 P2:D7
 *
 * 后端没有删除/改名单个范围规则、也没有按企业查资产的接口，所以不画这些按钮（总表 §8）。
 */
import { type FormEvent, type ReactNode, useCallback, useMemo, useState } from "react";

import { toast } from "@/components/v2/settings/Toast";
import { parseCompanyScopeText } from "@/lib/company-scope";
import type { Company, CompanyScopeKind, CompanyScopeRule } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconLinkOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  addCompanyScope,
  createCompany,
  deleteCompany,
  savedScopeRules,
  savedScopeText,
  SCOPE_KIND_LABELS,
  scopeMutationMessages,
  updateCompanyScope,
  useCompanies,
} from "@/v2/data/companies";

import css from "./companies.module.css";

/** 范围编辑器里的多行输入（逐行一条，实时识别并给出行号错误）。 */
function ScopeEditor({
  id,
  value,
  onValueChange,
  preservedRules,
  rows,
}: {
  id: string;
  value: string;
  onValueChange: (next: string) => void;
  preservedRules?: CompanyScopeRule[];
  rows: number;
}): ReactNode {
  const parsed = useMemo(() => parseCompanyScopeText(value, { preservedRules }), [preservedRules, value]);
  const counts = useMemo(() => {
    const result = new Map<CompanyScopeKind, number>();
    for (const rule of parsed.rules) result.set(rule.kind, (result.get(rule.kind) ?? 0) + 1);
    return result;
  }, [parsed.rules]);

  return (
    <div className={css.form}>
      <label className={css.fieldLabel} htmlFor={id}>
        资产范围
        <span className={css.fieldHint}>每行一条，自动识别域名、IP、CIDR、ICP 备案和企业关键词。关键词只作为 Agent 提示，不会自动归属资产。</span>
      </label>
      <textarea
        id={id}
        className={css.scopeArea}
        rows={rows}
        value={value}
        aria-invalid={parsed.errors.length > 0}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      <div className={css.scopeCounts}>
        <span>已识别 {parsed.rules.length} 条</span>
        {(Object.keys(SCOPE_KIND_LABELS) as CompanyScopeKind[]).map((kind) => {
          const count = counts.get(kind) ?? 0;
          return count > 0 ? (
            <Tag key={kind} tone="outline" className={css.scopeTag}>
              {SCOPE_KIND_LABELS[kind]} {count}
            </Tag>
          ) : null;
        })}
      </div>
      {parsed.errors.length > 0 ? (
        <div className={css.scopeErrors} role="alert">
          {parsed.errors.slice(0, 5).map((item) => (
            <span key={`${item.line}-${item.error}`}>{`第 ${item.line} 行：${item.error}`}</span>
          ))}
          {parsed.errors.length > 5 ? <span>{`另有 ${parsed.errors.length - 5} 行错误`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 渲染企业管理页（D6·U4 起双挂点，同一无 props body）：
 * 1) Shell 主区经 `AssetsDataPage` 的「企业」tab（企业一级页已并入资产库）；
 * 2) 独立路由 `app/v2/companies`。主区容器与 tab 外壳由两个挂点各自提供，
 * 本组件只带「企业」页头与内容体，所有写操作与 `data-companies-*` 钩子不变。
 * @returns 页头（刷新 / 新增企业）、企业表格四态、新建 / 编辑范围 / 追加范围 / 删除四个弹窗。
 */
export function CompaniesPage(): ReactNode {
  const state = useCompanies();

  /** 新建企业弹窗。 */
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createScopeText, setCreateScopeText] = useState("");
  /** 覆盖保存弹窗的目标企业；null 表示关闭。 */
  const [editing, setEditing] = useState<Company | null>(null);
  const [editScopeText, setEditScopeText] = useState("");
  const [editReason, setEditReason] = useState("");
  /** 追加范围弹窗的目标企业；null 表示关闭。 */
  const [appending, setAppending] = useState<Company | null>(null);
  const [appendScopeText, setAppendScopeText] = useState("");
  const [appendReason, setAppendReason] = useState("");
  /** 删除确认的目标企业；null 表示关闭。 */
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [deleteAssets, setDeleteAssets] = useState(false);
  const [busy, setBusy] = useState<null | "create" | "edit" | "append" | "delete">(null);
  const [failure, setFailure] = useState<string | null>(null);

  const createParsed = useMemo(() => parseCompanyScopeText(createScopeText), [createScopeText]);
  const editPreserved = useMemo(() => (editing === null ? [] : savedScopeRules(editing)), [editing]);
  const editParsed = useMemo(
    () => parseCompanyScopeText(editScopeText, { preservedRules: editPreserved }),
    [editPreserved, editScopeText],
  );
  const appendParsed = useMemo(() => parseCompanyScopeText(appendScopeText), [appendScopeText]);

  const openCreate = useCallback((): void => {
    setName("");
    setCreateScopeText("");
    setFailure(null);
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback((): void => {
    if (busy === "create") return;
    setCreateOpen(false);
  }, [busy]);

  const openEdit = useCallback((company: Company): void => {
    setEditing(company);
    setEditScopeText(savedScopeText(company));
    setEditReason("");
    setFailure(null);
  }, []);

  const closeEdit = useCallback((): void => {
    if (busy === "edit") return;
    setEditing(null);
  }, [busy]);

  const openAppend = useCallback((company: Company): void => {
    setAppending(company);
    setAppendScopeText("");
    setAppendReason("");
    setFailure(null);
  }, []);

  const closeAppend = useCallback((): void => {
    if (busy === "append") return;
    setAppending(null);
  }, [busy]);

  const openDelete = useCallback((company: Company): void => {
    setDeleting(company);
    setDeleteAssets(false);
    setFailure(null);
  }, []);

  const closeDelete = useCallback((): void => {
    if (busy === "delete") return;
    setDeleting(null);
    setDeleteAssets(false);
  }, [busy]);

  /** 新建企业（旧页 :990-1015）：名称必填且唯一（409），范围逐行校验通过才提交。 */
  const submitCreate = useCallback((): void => {
    const trimmed = name.trim();
    if (trimmed === "" || busy !== null) return;
    if (createParsed.errors.length > 0) {
      setFailure("请先修正无效的资产范围");
      return;
    }
    setBusy("create");
    setFailure(null);
    createCompany({ name: trimmed, scope: createParsed.rules })
      .then((result) => {
        setBusy(null);
        setCreateOpen(false);
        toast(
          result.scope_invalid > 0
            ? `已创建企业，添加 ${result.scope_added} 条范围；${result.scope_invalid} 行无效`
            : `已创建企业，添加 ${result.scope_added} 条范围`,
        );
        state.reload();
      })
      .catch((reason: unknown) => {
        setBusy(null);
        const message = reason instanceof Error ? reason.message : String(reason);
        setFailure(/:\s*409/.test(message) ? "企业名称已存在，请换一个名称" : `保存失败：${message}`);
      });
  }, [busy, createParsed, name, state]);

  /** 覆盖保存资产范围（旧页 :1074-1093）。 */
  const submitEdit = useCallback((): void => {
    if (editing === null || busy !== null) return;
    if (editParsed.errors.length > 0) {
      setFailure("请先修正无效的资产范围");
      return;
    }
    setBusy("edit");
    setFailure(null);
    updateCompanyScope(editing.id, editParsed.rules, editReason.trim())
      .then((result) => {
        setBusy(null);
        setEditing(null);
        toast(result.invalid > 0 ? `已保存；${result.invalid} 行无效` : `范围已更新，共 ${result.added} 条`);
        for (const message of scopeMutationMessages(result)) toast(message);
        state.reload();
      })
      .catch((reason: unknown) => {
        setBusy(null);
        setFailure(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [busy, editParsed, editReason, editing, state]);

  /** 追加资产范围（旧页 :1153-1176）。 */
  const submitAppend = useCallback((): void => {
    if (appending === null || busy !== null) return;
    if (appendParsed.errors.length > 0) {
      setFailure("请先修正无效的资产范围");
      return;
    }
    if (appendParsed.rules.length === 0) {
      setFailure("请填写要追加的范围");
      return;
    }
    setBusy("append");
    setFailure(null);
    addCompanyScope(appending.id, appendParsed.rules, appendReason.trim())
      .then((result) => {
        setBusy(null);
        setAppending(null);
        toast(result.invalid > 0 ? `已保存；${result.invalid} 行无效` : `已追加 ${result.added} 条范围`);
        for (const message of scopeMutationMessages(result)) toast(message);
        state.reload();
      })
      .catch((reason: unknown) => {
        setBusy(null);
        setFailure(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [appendParsed, appendReason, appending, busy, state]);

  /** 删除企业（旧页 :208-226）：deleteAssets 默认 false，即保留资产只取消归属。 */
  const submitDelete = useCallback((): void => {
    if (deleting === null || busy !== null) return;
    setBusy("delete");
    setFailure(null);
    deleteCompany(deleting.id, deleteAssets)
      .then((result) => {
        setBusy(null);
        setDeleting(null);
        setDeleteAssets(false);
        toast(
          deleteAssets && result.assets_deleted > 0
            ? `已删除企业，同时删除 ${result.assets_deleted} 条资产`
            : "已删除企业",
        );
        state.reload();
      })
      .catch((reason: unknown) => {
        setBusy(null);
        setFailure(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [busy, deleteAssets, deleting, state]);

  const submitCreateForm = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      submitCreate();
    },
    [submitCreate],
  );

  return (
    <div data-data-page="companies" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>企业</h1>
          <p className={css.lead}>按企业维护资产范围，命中的资产会自动归属到该企业。</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="企业动作" data-companies-toolbar="">
          <Button
            variant="ghost"
            size="sm"
            disabled={state.phase === "loading"}
            onClick={state.reload}
            title="刷新企业列表"
            aria-label="刷新企业列表"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-companies-action="refresh"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            icon={<IconPlusOutlineRegular size={13} />}
            data-companies-action="create"
          >
            新增企业
          </Button>
        </div>
      </header>

      {state.phase === "loading" ? (
        <div className={css.state} data-companies-state="loading">
          加载中…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-companies-state="offline">
          <span>读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-companies-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && state.companies.length === 0 ? (
        <div className={css.empty} data-companies-state="empty">
          <span className={css.emptyTitle}>还没有企业</span>
          <span className={css.emptyText}>
            用右上角「新增企业」填写名称与资产范围，系统会自动认领命中的资产。
          </span>
        </div>
      ) : null}

      {state.phase === "ready" && state.companies.length > 0 ? (
        <div className={css.tableWrap}>
          <table className={css.table} data-companies-rows="">
            <thead>
              <tr>
                <th scope="col">企业</th>
                <th scope="col" className={css.colCount}>
                  资产数
                </th>
                <th scope="col">资产范围</th>
                <th scope="col" className={css.colActions}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {state.companies.map((company) => (
                <tr key={company.id} data-companies-row={company.id}>
                  <td className={css.cellName}>
                    <div className={css.nameCell}>
                      <span className={css.avatar} aria-hidden="true">
                        {company.logo ? (
                          // 远程图标 URL 由后端 company.logo 给出（types.ts:413）。
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={css.avatarImg} src={company.logo} alt="" />
                        ) : (
                          (company.name.trim()[0] ?? "?").toUpperCase()
                        )}
                      </span>
                      <span className={css.nameText}>{company.name}</span>
                    </div>
                  </td>
                  <td className={css.colCount}>{company.asset_count}</td>
                  <td>
                    {company.scope !== undefined && company.scope.length > 0 ? (
                      <div className={css.scopeWrap}>
                        {company.scope.map((row) => (
                          <Tag key={row.id} tone="outline" className={css.scopeTag}>
                            {row.raw}
                          </Tag>
                        ))}
                      </div>
                    ) : (
                      <span className={css.scopeEmpty}>未设置范围</span>
                    )}
                  </td>
                  <td className={css.colActions}>
                    <span className={css.rowActions}>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => openEdit(company)}
                        data-companies-action="edit-scope"
                        data-companies-company={company.id}
                      >
                        编辑范围
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => openAppend(company)}
                        icon={<IconLinkOutlineRegular size={12} />}
                        data-companies-action="append-scope"
                        data-companies-company={company.id}
                      >
                        追加
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => openDelete(company)}
                        title={`删除企业 ${company.name}`}
                        aria-label={`删除企业 ${company.name}`}
                        icon={<IconTrashOutlineRegular size={13} />}
                        data-companies-action="delete"
                        data-companies-company={company.id}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="新增企业"
        closeLabel="关闭"
        description="配置企业及其资产范围。关键词只作为 Agent 提示，不会自动归属资产。"
        className={css.formModal}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeCreate} disabled={busy === "create"} data-companies-create-cancel="">
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitCreate}
              disabled={busy === "create" || name.trim() === "" || createParsed.errors.length > 0}
              data-companies-create-confirm=""
            >
              {busy === "create" ? "保存中…" : "保存"}
            </Button>
          </>
        }
      >
        <form className={css.form} onSubmit={submitCreateForm}>
          <label className={css.fieldLabel} htmlFor="companies-create-name">
            企业名称
            <Input
              id="companies-create-name"
              className={css.textInput}
              data-modal-autofocus
              value={name}
              disabled={busy === "create"}
              placeholder="名称唯一，如 Acme Corp"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <ScopeEditor
            id="companies-create-scope"
            value={createScopeText}
            onValueChange={setCreateScopeText}
            rows={8}
          />
          {failure === null ? null : (
            <p className={css.errorLine} role="alert" data-companies-create-error="">
              {failure}
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={closeEdit}
        title={editing === null ? "编辑资产范围" : `编辑资产范围 · ${editing.name}`}
        closeLabel="关闭"
        description="保存后将替换该企业全部现有范围（ICP 精确匹配资产，企业关键词仅作为 Agent 提示）。"
        className={css.formModal}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeEdit} disabled={busy === "edit"} data-companies-edit-cancel="">
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitEdit}
              disabled={busy === "edit" || editParsed.errors.length > 0}
              data-companies-edit-confirm=""
            >
              {busy === "edit" ? "保存中…" : "覆盖保存"}
            </Button>
          </>
        }
      >
        <div className={css.form}>
          <ScopeEditor
            id={`companies-edit-scope-${editing?.id ?? 0}`}
            value={editScopeText}
            onValueChange={setEditScopeText}
            preservedRules={editPreserved}
            rows={8}
          />
          <label className={css.fieldLabel} htmlFor="companies-edit-reason">
            归属依据
            <Input
              id="companies-edit-reason"
              className={css.textInput}
              data-modal-autofocus
              value={editReason}
              disabled={busy === "edit"}
              placeholder="如 证书 / whois / ASN 佐证"
              onChange={(event) => setEditReason(event.currentTarget.value)}
            />
          </label>
          {failure === null ? null : (
            <p className={css.errorLine} role="alert" data-companies-edit-error="">
              {failure}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={appending !== null}
        onClose={closeAppend}
        title={appending === null ? "追加资产范围" : `追加资产范围 · ${appending.name}`}
        closeLabel="关闭"
        description="新范围会追加到现有范围，不会替换已有条目。"
        className={css.formModal}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeAppend} disabled={busy === "append"} data-companies-append-cancel="">
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitAppend}
              disabled={
                busy === "append" || appendParsed.rules.length === 0 || appendParsed.errors.length > 0
              }
              data-companies-append-confirm=""
            >
              {busy === "append" ? "保存中…" : "追加"}
            </Button>
          </>
        }
      >
        <div className={css.form}>
          <ScopeEditor
            id={`companies-append-scope-${appending?.id ?? 0}`}
            value={appendScopeText}
            onValueChange={setAppendScopeText}
            rows={6}
          />
          <label className={css.fieldLabel} htmlFor="companies-append-reason">
            归属依据
            <Input
              id="companies-append-reason"
              className={css.textInput}
              data-modal-autofocus
              value={appendReason}
              disabled={busy === "append"}
              placeholder="如 证书 / whois / ASN 佐证"
              onChange={(event) => setAppendReason(event.currentTarget.value)}
            />
          </label>
          {failure === null ? null : (
            <p className={css.errorLine} role="alert" data-companies-append-error="">
              {failure}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={closeDelete}
        title={deleting === null ? "删除企业" : `删除企业 · ${deleting.name}`}
        closeLabel="关闭"
        tone="warning"
        description="此操作将永久删除该企业及其资产范围配置，不可撤销。"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeDelete} disabled={busy === "delete"} data-companies-delete-cancel="">
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitDelete}
              disabled={busy === "delete"}
              data-companies-delete-confirm=""
            >
              {busy === "delete" ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={css.confirmBody}>
          <Checkbox
            checked={deleteAssets}
            disabled={busy === "delete"}
            onChange={setDeleteAssets}
            label="同时删除该企业下的所有资产"
          />
          <p className={css.confirmMeta}>
            {deleteAssets
              ? "勾选后该企业名下的资产会被一并永久删除。"
              : "不勾选则保留资产，仅取消它们与该企业的归属关系。"}
          </p>
          {deleting !== null && deleting.asset_count > 0 ? (
            <p className={css.confirmWarn}>
              <IconWarningOutlineRegular size={14} aria-hidden="true" />
              <span>该企业当前有 {deleting.asset_count} 条资产。</span>
            </p>
          ) : null}
          {failure === null ? null : (
            <p className={css.errorLine} role="alert" data-companies-delete-error="">
              {failure}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
