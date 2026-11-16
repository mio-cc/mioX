/**
 * 凭据掩码的纯函数层：识别文本里的凭据，给出"只改画出来的字"的显示形式。
 *
 * 对照 DSH `@deepseek-ai/dsh-client-ui-secret-mask`（`项目分析/dsh-src/`）：
 *
 * - `client/index.ts:2-4` —— "Masking changes only the drawn text; the message
 *   text, copy actions, and model input keep the original characters."
 *   所以本模块只产出"显示串"，调用方拿到的原文一个字符都不动。
 * - `client/credential-formats.ts:30` —— "Same-start candidates resolve by
 *   ascending kind, so a token used as an address password is masked completely."
 *   所以同起点按 kind 升序（KEY_BLOCK < ADDRESS < PREFIXED），重叠候选并进最早那个。
 * - `client/credential-masks.ts:8-10` —— `MASK = '*'`、`VISIBLE_PREFIX = 8`
 *   （前缀格式保留前 8 个字符，正好是服务商前缀）。
 * - `client/credential-masks.ts:28` —— "line breaks stay in place, one mark per
 *   code point."（换行原位保留，一个码点一个 mark；代理对算一个字符）
 * - `client/credential-masks.ts:55-74` —— `keyBlock()`：保留 BEGIN 行、END 行和
 *   每个换行，正文逐行遮；写成一行时整块遮。
 *
 * 本文件是数据驱动的：加一个服务商只要往 `CREDENTIAL_FORMATS` 里加一行。
 * 这里不碰 DOM、不碰 React，可直接被 node 单测（见 verify-phase4/secret-mask/unit.mjs）。
 */

// ── 字符类位掩码（同 credential-formats.ts:8-28）──────────────────────────────
/** `[A-Za-z0-9_-]` */
export const KEY = 1;
/** `[A-Za-z0-9]` */
export const ALNUM = 2;
/** `\w` */
export const WORD = 4;
/** `[A-Za-z0-9-]` */
export const ALNUM_DASH = 8;
/** `[A-Z0-9]` */
export const UPPER_ALNUM = 16;
/** `[A-Z0-9 ]` */
export const LABEL = 32;
/** `[^\s/:@?#]` */
export const USER = 256;
/** `[^\s/@?#]` */
export const PASSWORD = 512;

// ── literal 种类（同 credential-formats.ts:30-36）─────────────────────────────
/** `-----BEGIN` 开头的私钥块。 */
export const KEY_BLOCK = 0;
/** 带凭据的地址里的那段密码。 */
export const ADDRESS = 1;
/** 固定前缀之后的服务商密钥/token。 */
export const PREFIXED = 2;

// ── 前缀格式在前缀之后那段的形状（同 credential-formats.ts:38-48）─────────────
/** 整段 run，至少 `min`。 */
export const RUN = 0;
/** `min` 到 `max`，其后必须是词边界。 */
export const BOUNDED = 1;
/** 至少 `min`，且前 256 个字符里有一个数字。 */
export const SK = 2;
/** 三段，用 `.eyJ` 和 `.` 连接。 */
export const JWT = 4;

/** 一个被认出来的格式。 */
export interface CredentialFormat {
  /** 候选必须以它开头；任意两个 literal 互不为子串。 */
  readonly literal: string;
  readonly kind: number;
  /** 仅前缀格式：前缀之后那段的校验形状。 */
  readonly shape: number;
  /** 仅前缀格式：前缀之后那段的字符类位。 */
  readonly run: number;
  readonly min: number;
  readonly max: number;
}

const prefixed = (literal: string, shape: number, run: number, min: number, max = 0): CredentialFormat => ({
  literal,
  kind: PREFIXED,
  shape,
  run,
  min,
  max,
});

/**
 * 精简格式表：只挑渗透场景真正常见的凭据。DSH 的完整表还有 AIza / glpat- / npm_ /
 * hf_ / sk_live_ / xoxa- 等（credential-formats.ts:67-100），要加就在下面加一行。
 *
 * 与 DSH 的一处**有意偏差**：`sk-` 用 `RUN` 而不是 `SK`。DSH 的 `SK` 要求前缀之后
 * 256 个字符里必须有数字（credential-formats.ts:71 的注释：模型服务的 key 带数字，
 * 连字符标识符一般不带），但验收样本 `sk-abcdefghijklmnopqrstuvwxyz` 全字母，按 SK
 * 会漏遮。这里改成"20 个以上 KEY 类字符"——长度本身就足够特异，误报面没变大。
 */
export const CREDENTIAL_FORMATS: readonly CredentialFormat[] = [
  // 私钥块：`-----BEGIN ... PRIVATE KEY-----` 到 `-----END ... PRIVATE KEY-----`。
  { literal: "-----BEGIN ", kind: KEY_BLOCK, shape: RUN, run: 0, min: 0, max: 0 },
  // URL 里的 `user:password@host`，只遮密码那一段。
  { literal: "://", kind: ADDRESS, shape: RUN, run: 0, min: 0, max: 0 },
  // 模型服务：`sk-` 同时覆盖 OpenAI 的 `sk-` 和 Anthropic 的 `sk-ant-`（`-` 属于 KEY 类）。
  prefixed("sk-", RUN, KEY, 20),
  // 代码托管。
  prefixed("ghp_", RUN, ALNUM, 36),
  prefixed("gho_", RUN, ALNUM, 36),
  prefixed("github_pat_", RUN, WORD, 22),
  // 云访问密钥 ID。
  prefixed("AKIA", BOUNDED, UPPER_ALNUM, 16, 16),
  prefixed("ASIA", BOUNDED, UPPER_ALNUM, 16, 16),
  // 协作服务。
  prefixed("xoxb-", RUN, ALNUM_DASH, 10),
  prefixed("xoxp-", RUN, ALNUM_DASH, 10),
  // JWT：`eyJ...` 三段。
  prefixed("eyJ", JWT, KEY, 8, 2048),
];

/** 每个被隐藏字符的替身（credential-masks.ts:8）。 */
export const MASK = "*";
/** 前缀格式保留可读的头部字符数：服务商前缀 + 一点点（credential-masks.ts:10）。 */
export const VISIBLE_PREFIX = 8;

/** 一个被识别出来的凭据区间。 */
export interface SecretSpan {
  /** 在原文里的起始偏移。 */
  readonly start: number;
  /** 在原文里的结束偏移（不含）。 */
  readonly end: number;
  readonly kind: number;
  /** 显示形式：换行原位保留，一个码点一个 mark。 */
  readonly masked: string;
}

interface Candidate {
  start: number;
  end: number;
  kind: number;
}

// ── 字符类查表（同 format-tables.ts:61-75）────────────────────────────────────
const CLASSES: Uint16Array = buildClasses();

function buildClasses(): Uint16Array {
  const classes = new Uint16Array(128);
  for (let code = 0; code < 128; code++) {
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;
    const alnum = upper || lower || digit;
    // authority 段：`\s`、`/`、`@`、`?`、`#` 之外都算。
    const authority = !((code >= 9 && code <= 13) || code === 32 || code === 47 || code === 64 || code === 63 || code === 35);
    classes[code] =
      (alnum || code === 95 || code === 45 ? KEY : 0) |
      (alnum ? ALNUM : 0) |
      (alnum || code === 95 ? WORD : 0) |
      (alnum || code === 45 ? ALNUM_DASH : 0) |
      (upper || digit ? UPPER_ALNUM : 0) |
      (upper || digit || code === 32 ? LABEL : 0) |
      (authority && code !== 58 ? USER : 0) |
      (authority ? PASSWORD : 0);
  }
  return classes;
}

/** `\s` 在 ASCII 之上（credential-scanner.ts:36-39）。 */
function isWideSpace(code: number): boolean {
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** `\w` 在 `index` 处（越界不算）。 */
function isWordAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code < 128 && (CLASSES[code] & WORD) !== 0;
}

/** `USER` 类的一个 UTF-16 码元；NaN（越界）不算。 */
function isUserCode(code: number): boolean {
  return code < 128 ? (CLASSES[code] & USER) !== 0 : code === code && !isWideSpace(code);
}

/** `PASSWORD` 类的一个 UTF-16 码元；NaN（越界）不算。 */
function isPasswordCode(code: number): boolean {
  return code < 128 ? (CLASSES[code] & PASSWORD) !== 0 : code === code && !isWideSpace(code);
}

/** 从 `start` 起 `bits` 类字符的 run 末端。 */
function runEnd(text: string, start: number, bits: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 128 || (CLASSES[code] & bits) === 0) break;
    index++;
  }
  return index;
}

function userRunEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length && isUserCode(text.charCodeAt(index))) index++;
  return index;
}

function passwordRunEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length && isPasswordCode(text.charCodeAt(index))) index++;
  return index;
}

/** `start` 之后第一个 ASCII 数字的位置，没有就是文本长度（credential-scanner.ts:221-227）。 */
function nextDigit(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 48 && code <= 57) return index;
    index++;
  }
  return text.length;
}

// ── 各格式的候选校验 ─────────────────────────────────────────────────────────

/** `\b[a-z][a-z0-9+.-]{1,15}$` 是否结束于 `at`（credential-scanner.ts:266-276）。 */
const SCHEME_TAIL = /(?:^|[^\w])[a-z][a-z0-9+.-]{1,15}$/;

function schemeBefore(text: string, at: number): boolean {
  return SCHEME_TAIL.test(text.slice(Math.max(0, at - 17), at));
}

const BEGIN_LABEL = "-----BEGIN ";
const END_LABEL = "-----END ";
const PRIVATE_KEY_LABEL = "PRIVATE KEY-----";
const PRIVATE_KEY_WORD = "PRIVATE KEY";

/**
 * `[A-Z0-9 ]{0,40}PRIVATE KEY-----` 在 `start` 处结束的偏移，或 -1
 * （credential-scanner.ts:229-242）。
 */
function labelEnd(text: string, start: number): number {
  const limit = Math.min(text.length, start + 52);
  let index = start;
  while (index < limit) {
    const code = text.charCodeAt(index);
    if (code > 127 || (CLASSES[code] & LABEL) === 0) break;
    index++;
  }
  const tail = index - PRIVATE_KEY_WORD.length;
  return index < start + 52 && tail >= start && text.startsWith(PRIVATE_KEY_LABEL, tail)
    ? tail + PRIVATE_KEY_LABEL.length
    : -1;
}

/** 私钥块在 `at` 处的末端：第一条完整 END 行之后，或文本末尾（credential-scanner.ts:244-264）。 */
function keyBlockEnd(text: string, at: number): number {
  const header = labelEnd(text, at + BEGIN_LABEL.length);
  if (header < 0) return -1;
  for (let line = text.indexOf(END_LABEL, header); line >= 0; line = text.indexOf(END_LABEL, line + 1)) {
    const end = labelEnd(text, line + END_LABEL.length);
    if (end >= 0) return end;
  }
  return text.length;
}

/** `\b[a-z][a-z0-9+.-]{1,15}://[^\s/:@?#]{0,256}:[^\s/@?#]+@` 里那段密码（credential-scanner.ts:284-295）。 */
function addressPassword(text: string, at: number): Candidate | null {
  if (!schemeBefore(text, at)) return null;
  const userStart = at + "://".length;
  const userEnd = userRunEnd(text, userStart);
  if (userEnd - userStart > 256 || text.charCodeAt(userEnd) !== 58) return null;
  const start = userEnd + 1;
  const end = passwordRunEnd(text, start);
  if (end === start || text.charCodeAt(end) !== 64) return null;
  return { start, end, kind: ADDRESS };
}

/** 前缀格式在前缀之后那段的末端，或 -1（credential-scanner.ts:330-357）。 */
function prefixedEnd(text: string, format: CredentialFormat, at: number): number {
  if (isWordAt(text, at - 1)) return -1;
  const start = at + format.literal.length;
  const min = format.min;
  if (format.shape === SK) {
    const end = runEnd(text, start, KEY);
    const digit = nextDigit(text, start);
    return end - start >= min && digit - start <= 255 && digit < end ? end : -1;
  }
  const end = runEnd(text, start, format.run);
  const length = end - start;
  if (length < min) return -1;
  if (format.shape === RUN) return end;
  if (format.shape === BOUNDED) return length <= format.max && !isWordAt(text, end) ? end : -1;
  // JWT：`eyJ` 之后 `{8,2048}\.eyJ{8,}\.{8,}`
  if (length > format.max || !text.startsWith(".eyJ", end)) return -1;
  const payloadStart = end + ".eyJ".length;
  const payloadEnd = runEnd(text, payloadStart, KEY);
  if (payloadEnd - payloadStart < min || text.charCodeAt(payloadEnd) !== 46) return -1;
  const signatureEnd = runEnd(text, payloadEnd + 1, KEY);
  return signatureEnd - (payloadEnd + 1) >= min ? signatureEnd : -1;
}

/** 位置 `at` 上 `format` 给出的候选，或 null。 */
function candidateAt(text: string, at: number, format: CredentialFormat): Candidate | null {
  if (format.kind === KEY_BLOCK) {
    const end = keyBlockEnd(text, at);
    return end < 0 ? null : { start: at, end, kind: KEY_BLOCK };
  }
  if (format.kind === ADDRESS) return addressPassword(text, at);
  const end = prefixedEnd(text, format, at);
  return end < 0 ? null : { start: at, end, kind: PREFIXED };
}

// ── 扫描 ────────────────────────────────────────────────────────────────────
const escapeLiteral = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const FORMAT_BY_LITERAL = new Map(CREDENTIAL_FORMATS.map((format) => [format.literal, format] as const));
/** 只认 literal 的交替式：没有任何量词，不会回溯爆炸（format-tables.ts:106-113 的思路）。 */
const LITERAL_SCAN = new RegExp(CREDENTIAL_FORMATS.map((format) => escapeLiteral(format.literal)).join("|"), "g");

/** 扫出全部候选，按起点（同起点按 kind 升序）合并重叠区间。 */
function scanCandidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  LITERAL_SCAN.lastIndex = 0;
  for (let match = LITERAL_SCAN.exec(text); match !== null; match = LITERAL_SCAN.exec(text)) {
    const at = match.index;
    const format = FORMAT_BY_LITERAL.get(match[0]);
    if (format) {
      const candidate = candidateAt(text, at, format);
      if (candidate) found.push(candidate);
    }
    // 从下一个字符继续：私钥块正文里可能还藏着 `sk-` 之类，起点不能跳过。
    LITERAL_SCAN.lastIndex = at + 1;
  }
  if (found.length < 2) return found;
  found.sort((a, b) => a.start - b.start || a.kind - b.kind);
  const merged: Candidate[] = [found[0]];
  for (let index = 1; index < found.length; index++) {
    const current = merged[merged.length - 1];
    const next = found[index];
    if (next.start <= current.end) {
      // kind 取最早那个候选的（credential-formats.ts:30）：地址密码里塞的 token 会跟着整段全遮。
      if (next.end > current.end) current.end = next.end;
    } else {
      merged.push(next);
    }
  }
  return merged;
}

// ── 掩码渲染（同 credential-masks.ts:30-126）──────────────────────────────────

/** `text[start, end)` 全遮：换行原位保留，一个码点一个 mark。 */
function rangeMask(text: string, start: number, end: number): string {
  let masked = "";
  let count = 0;
  for (let index = start; index < end; index++) {
    const code = text.charCodeAt(index);
    if (code === 10 || code === 13) {
      masked += MASK.repeat(count) + (code === 10 ? "\n" : "\r");
      count = 0;
      continue;
    }
    // 高代理 + 低代理算一个字符。
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < end) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
    count++;
  }
  return masked + MASK.repeat(count);
}

/** 私钥块：保留 BEGIN 行、END 行和每个换行，正文逐行遮；写成一行时整块遮（credential-masks.ts:55-74）。 */
function keyBlockMask(text: string, start: number, end: number): string {
  let bodyStart = start;
  for (let index = start; index < end; index++) {
    if (text.charCodeAt(index) === 10) {
      bodyStart = index + 1;
      break;
    }
  }
  let bodyEnd = end;
  for (let index = end - "\n-----END".length; index >= bodyStart; index--) {
    if (text.charCodeAt(index) === 10 && text.startsWith("-----END", index + 1)) {
      bodyEnd = index;
      break;
    }
  }
  return text.slice(start, bodyStart) + rangeMask(text, bodyStart, bodyEnd) + text.slice(bodyEnd, end);
}

/** 一个候选区间的显示形式（credential-masks.ts:30-37）。 */
function maskRange(text: string, kind: number, start: number, end: number): string {
  if (kind === ADDRESS) return rangeMask(text, start, end);
  if (kind === PREFIXED) {
    const split = Math.min(start + VISIBLE_PREFIX, end);
    return text.slice(start, split) + rangeMask(text, split, end);
  }
  return keyBlockMask(text, start, end);
}

/**
 * 文本里所有凭据区间，按起点升序。区间不重叠：重叠的候选并进最早那个。
 * @param text - 原文。
 * @returns 凭据区间；没有就是空数组。
 */
export function findSecrets(text: string): SecretSpan[] {
  if (text === "") return [];
  const candidates = scanCandidates(text);
  if (candidates.length === 0) return [];
  return candidates.map((candidate) => ({
    start: candidate.start,
    end: candidate.end,
    kind: candidate.kind,
    masked: maskRange(text, candidate.kind, candidate.start, candidate.end),
  }));
}

/**
 * 显示形式：把每个凭据区间换成掩码，区间外的字符原样保留。
 * 原文长度、换行个数、行数都不变——只有被遮的字符变了。
 * @param text - 原文。
 * @returns 可直接画出来的串；没有凭据时原样返回。
 */
export function maskSecrets(text: string): string {
  const spans = findSecrets(text);
  if (spans.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + span.masked;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

/**
 * 文本里有没有凭据。
 * @param text - 原文。
 * @returns 有就 true。
 */
export function hasSecrets(text: string): boolean {
  return findSecrets(text).length > 0;
}
