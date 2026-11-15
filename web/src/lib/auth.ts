import { LOGIN_USERNAME } from "@/config/app-config";

const TOKEN_KEY = "artex_token";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 天（秒）

// 认证开关（后端 config.json 的 auth.disabled，默认关闭）。为 true 时不存在
// 登录/密码，路由守卫直接放行，侧边栏也隐藏「修改密码 / 退出登录」。
// 由主布局在拿到 /api/auth/status 后写入，模块级变量足够：只在客户端读。
let authDisabled = false;

export function setAuthDisabled(value: boolean): void {
  authDisabled = value;
}

export function isAuthDisabled(): boolean {
  return authDisabled;
}

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
}

export const auth = {
  getToken(): string | null {
    if (typeof window === "undefined") return null;
    // Mock demo：无真实登录，返回一个假 token 让路由守卫放行、直接进主界面。
    return localStorage.getItem(TOKEN_KEY) ?? (process.env.NEXT_PUBLIC_MOCK === "1" ? "mock-demo" : null);
  },

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    // 同步写 cookie，供 Next.js middleware 服务端读取
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
  },

  // 从 JWT payload 的 sub 字段解析当前用户，仅用于展示，不做签名验证。
  getCurrentUser(): CurrentUser | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      // base64url → base64
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      // 用户名是后端签发的登录凭据（server/auth.go 固定 "ARTEX"），不是品牌名；
      // 品牌已更替为 mioX，这里继续以 JWT 的 sub 为准。
      const username: string = payload.sub ?? LOGIN_USERNAME;
      return { id: "1", name: username, username, email: "", avatar: "", role: "operator" };
    } catch {
      return null;
    }
  },
};
