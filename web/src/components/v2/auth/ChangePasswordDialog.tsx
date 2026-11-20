"use client";

/**
 * 修改密码弹窗：当前密码 / 新密码 / 确认新密码，校验一致后调 changePassword。
 * 旧页面依据：ARTEX/web/src/app/(main)/_components/sidebar/change-password-dialog.tsx:22-123
 *   （三个密码框、提交前校验非空与两次一致、成功提示「密码已修改」、失败显示「修改失败：…」、
 *    关闭时清空输入）。
 * DSH 依据：DSH 无账号体系（前端只连本机 dsh web），弹窗形态按 §6 用 vendored `Modal`，
 *   写法照 components/v2/data-pages/AssetDeleteDialog.tsx（Modal + footer 两个 Button + 忙碌禁用）。
 * 对照表行：P3:C4
 *
 * 本单元只交付组件；入口按钮放在设置的「通用」页，属于 B14（要改 SettingsDialog.tsx，超出本单元写域）。
 */
import { type ReactNode, useEffect, useId, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";

import { toast } from "@/components/v2/settings/Toast";
import { changePassword } from "@/v2/data/auth";

import css from "./auth.module.css";

/** 后端要求的最短密码长度，与旧页 setup/page.tsx:48-51 一致。 */
const MIN_PASSWORD_LENGTH = 8;

export interface ChangePasswordDialogProps {
  /** 是否显示。 */
  open: boolean;
  /** 关闭（取消、Esc、遮罩点击、修改成功之后都会调用）。 */
  onClose: () => void;
}

/**
 * 渲染修改密码弹窗。
 * @param props.open - 是否显示。
 * @param props.onClose - 关闭回调。
 * @returns 弹窗，关闭时由 Modal 返回 null。
 */
export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps): ReactNode {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 表单 id 用 useId 生成：并发渲染（React 编译器）下不依赖运行时 DOM 查询。
  const formId = useId();

  // 关闭时清空输入，避免下次打开残留旧密码（旧页 :36-42）。
  useEffect(() => {
    if (open) return;
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setBusy(false);
  }, [open]);

  const close = (): void => {
    if (busy) return;
    onClose();
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    if (oldPassword.length === 0 || newPassword.length === 0) {
      setError("请填写当前密码和新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密码长度至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    setBusy(true);
    setError(null);
    changePassword(oldPassword, newPassword)
      .then(() => {
        setBusy(false);
        toast("密码已修改");
        onClose();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        // 后端对当前密码错误/新密码不合规有明确文案，原样显示（旧页 :61 的「修改失败：」+ message）。
        setError(`修改失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="修改密码"
      closeLabel="关闭"
      description="需先输入当前密码验证；修改后已签发的登录 token 仍有效直至过期。"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={close} disabled={busy} data-change-password-cancel="">
            取消
          </Button>
          <Button variant="primary" size="sm" type="submit" form={formId} disabled={busy} data-change-password-confirm="">
            {busy ? "修改中…" : "确认修改"}
          </Button>
        </>
      }
    >
      <form id={formId} className={css.dialogForm} onSubmit={submit} data-change-password-form="">
        <div className={css.field}>
          <label className={css.label} htmlFor="v2-cp-old">
            当前密码
          </label>
          <Input
            id="v2-cp-old"
            type="password"
            value={oldPassword}
            autoComplete="current-password"
            disabled={busy}
            onChange={(event) => setOldPassword(event.target.value)}
            data-change-password-old=""
          />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="v2-cp-new">
            新密码
          </label>
          <Input
            id="v2-cp-new"
            type="password"
            value={newPassword}
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setNewPassword(event.target.value)}
            data-change-password-new=""
          />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="v2-cp-confirm">
            确认新密码
          </label>
          <Input
            id="v2-cp-confirm"
            type="password"
            value={confirmPassword}
            placeholder="再次输入新密码"
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setConfirmPassword(event.target.value)}
            data-change-password-confirm-input=""
          />
        </div>
        {error !== null ? (
          <p className={css.error} role="alert" data-change-password-error="">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

export default ChangePasswordDialog;
