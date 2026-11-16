/**
 * Browser-side judgement of a typed API key.
 *
 * 逐条对齐 DSH `@deepseek-ai/dsh-client-ui-settings-models/src/client/apiKey.ts`：
 *   - :12  `LEGAL_API_KEY = /^[\x21-\x7E]+$/`（可打印 ASCII，空格除外）
 *   - :23  `ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/`（粘贴成 NAME=value 的环境行）
 *   - :32  `ApiKeyFailureKey = 'keyBlank' | 'keyIllegalCharacters'`
 *   - :35-39 `isQuoted()` 被一对引号包住
 *   - :44-45 **空值不是失败**：卡片打开时输入框就是空的，空 = 保留已存的那个
 *   - :19-21 注释明说这个启发式**只在 UI 跑**，不要放进 resolver：
 *     「a resolver applying it could lock a user out of a gateway whose key
 *      legitimately takes this shape」
 *   所以本文件只被表单调用，后端 resolver 里没有任何等价实现（grep 校验）。
 */

/** 可打印 ASCII、不含空格：`apiKey.ts:12`。 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;

/**
 * 被粘贴进来的 `NAME=value` 环境行：`apiKey.ts:23`。
 * 两条收窄让真 key 不会撞上它：名字必须全大写（`sk-` 形式在连字符处就断了），
 * 且 `=` 后面不能再是 `=`（全大写 key 的 base64 padding `ABCD==` 不会被误判）。
 */
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;

/**
 * 一份 typed key 为什么存不下去：`apiKey.ts:32`。
 * 被引号包住的粘贴与非法字符报**同一个**格式错——读者下一步动作完全一样
 * （看一眼 key 再粘一次），把两种原因分开只会占用字段那一行说一句废话。
 */
export type ApiKeyFailureKey = "keyBlank" | "keyIllegalCharacters";

/** 值是否被一对外形相同的引号包住：`apiKey.ts:35-39`。 */
export function isQuoted(value: string): boolean {
  const first = value[0];
  if (first !== '"' && first !== "'" && first !== "`") return false;
  return value.length > 1 && value.endsWith(first);
}

/**
 * 判断 key 输入框当前的值：`apiKey.ts:51-58`。
 *
 * **空输入框不是失败**：每张卡片打开时它都是空的，即便已经存了 key，那时空的意思是
 * 「保留已存的那个」。只有空白的输入框才算失败，免得用户敲进去的东西被静默丢掉。
 *
 * @param draft 输入框当前值，未 trim。
 * @returns 字段级失败的原因；`undefined` 表示允许提交。
 */
export function apiKeyFailure(draft: string): ApiKeyFailureKey | undefined {
  if (draft.length === 0) return undefined;
  const value = draft.trim();
  if (value.length === 0) return "keyBlank";
  if (ENV_LINE.test(value) || isQuoted(value)) return "keyIllegalCharacters";
  if (!LEGAL_API_KEY.test(value)) return "keyIllegalCharacters";
  return undefined;
}

/** 失败原因 → 给用户看的一句话（文案对齐 DSH locales.ts:304-306 的 zh 文案）。 */
export function apiKeyFailureText(key: ApiKeyFailureKey): string {
  return key === "keyBlank"
    ? "请输入 API 密钥；留空则保持已存储的密钥。"
    : "该 API 密钥格式错误，请检查（引号、空格、NAME=value 这类整行粘贴都不接受）。";
}

/**
 * 提交时真正要发出去的 key 值：`ProviderEditor.tsx:283-287`。
 * 空输入框 → 空串，调用方据此理解为「没有提供 key」而不是「key 是空串」，
 * 所以已存 key 的配置可以在不重输 key 的情况下被编辑。
 */
export function apiKeyWireValue(draft: string): string {
  return draft.trim();
}
