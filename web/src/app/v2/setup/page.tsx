"use client";

/**
 * /v2/setup：首次使用的初始化密码页（DSH 风格的居中卡片）。
 * 旧页面依据：ARTEX/web/src/app/(auth)/setup/page.tsx:24-63（进入即探测：
 *   免登录直接进主界面、已初始化跳回 /login、探测失败关闭表单入口；
 *   提交前校验两次密码一致且至少 8 位，成功后走 api.initPassword(password) 存 token 再进主界面）。
 * DSH 依据：DSH 无初始化页（前端只连本机 dsh web），按 /v2 独立路由扩展；
 *   卡片与字段样式照 components/v2/auth/auth.module.css（变量来自 styles/dsw.css）。
 * 对照表行：P3:C2
 */
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { IconShieldOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Input } from "@/vendor/dsh/primitives/Input";

import { initializePassword, probeAuthMode, saveToken } from "@/v2/data/auth";

import css from "./auth.module.css";

/** 初始化成功后进入的界面（/v2 的默认外壳）。 */
const HOME_PATH = "/v2/shell";
/** 后端要求的最短密码长度，与旧页 setup/page.tsx:48-51 一致。 */
const MIN_PASSWORD_LENGTH = 8;

export default function SetupPage(): ReactNode {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  // 查不到初始化状态时不能默认当成「未初始化」——那样会把初始化表单摆给一个
  // 其实已经设过密码的实例，用户照着填就会覆盖掉原密码。此时关闭入口
  // （旧页 setup/page.tsx:20-22 的原有注释与行为）。
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    probeAuthMode()
      .then((probe) => {
        if (!alive) return;
        if (probe.status === null) {
          setError(probe.error);
          setUnavailable(true);
          return;
        }
        if (probe.status.auth_disabled) {
          // 免登录模式不需要设置密码（旧页 setup/page.tsx:28-32）。
          window.location.replace(HOME_PATH);
          return;
        }
        if (probe.status.initialized) {
          // 已经设过密码：回登录页（旧页 setup/page.tsx:33）。
          window.location.replace("/v2/login");
        }
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setUnavailable(true);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码长度至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    setBusy(true);
    setError(null);
    initializePassword(password)
      .then(({ token }) => {
        saveToken(token);
        window.location.replace(HOME_PATH);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "初始化失败");
        setBusy(false);
      });
  };

  if (checking) {
    return (
      <div className={css.screen}>
        <p className={css.checkLine} role="status">
          正在检查初始化状态…
        </p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className={css.screen}>
        <div className={`${css.card} ${css.cardWide}`}>
          <div className={css.head}>
            <span className={css.headIcon}>
              <IconShieldOutlineRegular size={16} aria-hidden="true" />
            </span>
            <h1 className={css.title}>无法确认初始化状态</h1>
          </div>
          <p className={css.lead}>
            后端或数据库暂时不可用。为避免覆盖实例上已有的密码，初始化入口已临时关闭——请恢复服务后重试。
            {error !== null ? `（${error}）` : ""}
          </p>
          <div className={css.actionsStretch}>
            <Button
              variant="primary"
              size="md"
              onClick={() => window.location.reload()}
              data-setup-retry=""
            >
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={css.screen}>
      <div className={`${css.card} ${css.cardWide}`}>
        <div className={css.head}>
          <span className={css.headIcon}>
            <IconShieldOutlineRegular size={16} aria-hidden="true" />
          </span>
          <h1 className={css.title}>初始化密码</h1>
        </div>
        <p className={css.lead}>首次使用 mioX，请为账户设置一个登录密码（至少 8 位）。</p>

        <form className={css.form} onSubmit={submit} data-setup-form="">
          <div className={css.field}>
            <label className={css.label} htmlFor="v2-setup-password">
              新密码
            </label>
            <Input
              id="v2-setup-password"
              type="password"
              value={password}
              placeholder="至少 8 位"
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              data-setup-password=""
            />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="v2-setup-confirm">
              确认密码
            </label>
            <Input
              id="v2-setup-confirm"
              type="password"
              value={confirm}
              placeholder="再次输入密码"
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setConfirm(event.target.value)}
              data-setup-confirm=""
            />
          </div>
          {error !== null ? (
            <p className={css.error} role="alert" data-setup-error="">
              {error}
            </p>
          ) : null}
          <div className={css.actionsStretch}>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={busy || password.length === 0 || confirm.length === 0}
              data-setup-submit=""
            >
              {busy ? "保存中…" : "设置密码并登录"}
            </Button>
          </div>
        </form>

        <p className={css.footNote}>设置完成后本机即启用登录；认证开关关闭（免登录）时本页会直接放行。</p>
      </div>
    </div>
  );
}
