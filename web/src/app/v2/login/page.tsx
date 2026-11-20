"use client";

/**
 * /v2/login：账号登录页（DSH 风格的居中卡片）。
 * 旧页面依据：ARTEX/web/src/app/(auth)/login/page.tsx:44-85（进入即探测：
 *   本地有 token 直接进主界面、免登录直接进主界面、未初始化跳 /setup；
 *   提交走 api.login(LOGIN_USERNAME, password)，成功存 token 再跳主界面）。
 * DSH 依据：DSH 无登录页（前端只连本机 dsh web），按 /v2 独立路由扩展；
 *   卡片与字段样式照 components/v2/auth/auth.module.css（变量来自 styles/dsw.css）。
 * 对照表行：P3:C1 P3:C2
 *
 * 未搬旧页的「我已阅读并同意《使用须知》」勾选与条款弹窗：它的作用是在客户端拦一次
 * 提交，而《使用须知》正文是纯静态文案、后端也没有对应的确认字段，搬进 /v2 只会变成
 * 一个必须点击的装饰。旧页的 LOGIN_USERNAME 固定用户名照旧展示为只读行。
 */
import { type ReactNode, useEffect, useState } from "react";

import { LOGIN_USERNAME } from "@/config/app-config";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconShieldOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Input } from "@/vendor/dsh/primitives/Input";

import { clearToken, hasToken, login, probeAuthMode, saveToken } from "@/v2/data/auth";

import css from "./auth.module.css";

/** 登录成功后进入的界面（/v2 的默认外壳）。 */
const HOME_PATH = "/v2/shell";

export default function LoginPage(): ReactNode {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 进入页面时先探一次：已登录/免登录/未初始化三种情况各自直达，不在登录表单上停留。
  const [checking, setChecking] = useState(true);
  // 查不到认证模式时不能把表单摆出来（用户填了也登不上），照旧页 setup/page.tsx:20-22 的口径关闭入口。
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    if (hasToken()) {
      // 本地已有 token：直接进主界面（旧登录页 login/page.tsx:46-53 同义）。
      window.location.replace(HOME_PATH);
      return () => {
        alive = false;
      };
    }
    probeAuthMode()
      .then((probe) => {
        if (!alive) return;
        if (probe.status === null) {
          setError(probe.error);
          setUnavailable(true);
          return;
        }
        if (probe.status.auth_disabled) {
          // 免登录模式没有登录这回事（旧页 login/page.tsx:56-60）。
          window.location.replace(HOME_PATH);
          return;
        }
        if (!probe.status.initialized) {
          window.location.replace("/v2/setup");
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
    setBusy(true);
    setError(null);
    login(LOGIN_USERNAME, password)
      .then(({ token }) => {
        saveToken(token);
        window.location.replace(HOME_PATH);
      })
      .catch((reason: unknown) => {
        // 后端对密码错误返回 401 与固定文案；原样显示后端信息（红线：失败文案要能对上真实原因）。
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };

  if (checking) {
    return (
      <div className={css.screen}>
        <p className={css.checkLine} role="status">
          正在检查登录状态…
        </p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className={css.screen}>
        <div className={css.card}>
          <div className={css.head}>
            <span className={css.headIcon}>
              <IconShieldOutlineRegular size={16} aria-hidden="true" />
            </span>
            <h1 className={css.title}>无法确认登录状态</h1>
          </div>
          <p className={css.lead}>
            后端服务暂时不可用，登录入口已临时关闭。
            {error !== null ? `（${error}）` : ""}
          </p>
          <div className={css.actionsStretch}>
            <Button
              variant="primary"
              size="md"
              onClick={() => window.location.reload()}
              data-login-retry=""
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
      <div className={css.card}>
        <div className={css.head}>
          <span className={css.headIcon}>
            <IconShieldOutlineRegular size={16} aria-hidden="true" />
          </span>
          <h1 className={css.title}>登录</h1>
        </div>
        <p className={css.lead}>欢迎回来，请输入密码以继续使用 mioX。</p>

        <form className={css.form} onSubmit={submit} data-login-form="">
          <div className={css.field}>
            <span className={css.label} id="v2-login-username">
              用户名
            </span>
            <span className={css.readonlyField} aria-labelledby="v2-login-username" data-login-username="">
              {LOGIN_USERNAME}
            </span>
            <span className={css.hint}>用户名固定，由后端约定，不可修改。</span>
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="v2-login-password">
              密码
            </label>
            <Input
              id="v2-login-password"
              type="password"
              value={password}
              placeholder="请输入密码"
              autoComplete="current-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              data-login-password=""
            />
          </div>
          {error !== null ? (
            <p className={css.error} role="alert" data-login-error="">
              {error}
            </p>
          ) : null}
          <div className={css.actionsStretch}>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={busy || password.length === 0}
              data-login-submit=""
            >
              {busy ? "登录中…" : "登录"}
            </Button>
          </div>
        </form>

        <p className={css.footNote}>
          <button
            type="button"
            className={css.footLink}
            onClick={() => {
              // 清掉可能残留的本地凭据后再重问一次认证模式（旧布局 layout.tsx:56-59 同义）。
              clearToken();
              window.location.reload();
            }}
          >
            清除本机登录凭据并重试
          </button>
        </p>
      </div>
    </div>
  );
}
