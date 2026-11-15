import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "mioX",
  version: packageJson.version,
  copyright: `© ${currentYear}, mioX.`,
  meta: {
    title: "mioX — 自主渗透测试控制台",
    description: "LLM 驱动的自主渗透测试系统控制台",
  },
};

/**
 * Protocol-level login username. The Go backend hard-codes this value in
 * `server/auth.go` (`req.Username != "ARTEX"` rejects the request), so it is a
 * credential, not a display string: it must keep matching the server even
 * though the product is branded mioX. Change both sides together.
 */
export const LOGIN_USERNAME = "ARTEX";
