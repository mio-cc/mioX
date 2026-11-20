/**
 * Localized chrome for the four tool cards, ported from ui-lab's thread. Every
 * card takes its copy as a prop; this module is the single owner for the ported
 * surface so a future locale can replace it wholesale.
 *
 * P1:E1：Markdown 正文的文案见文件末尾的 MARKDOWN_LABELS。
 */
const TERMINAL_LABELS = {
  commandLine: (n: number) => `命令行 ${n}`,
  signal: (s: string) => `信号 ${s}`,
  exitCode: (n: number) => `退出码 ${n}`,
  noExitCode: "无退出码",
  running: "运行中",
  failed: "失败",
  done: "完成",
  copy: "复制",
  copied: "已复制",
  noOutput: "无输出",
  collapseAria: "折叠输出",
  expandAria: (hidden: number) => `展开剩余 ${hidden} 行`,
  collapse: "折叠",
  expand: (hidden: number) => `展开 ${hidden} 行`,
};

const DIFF_LABELS = {
  copy: "复制",
  copied: "已复制",
  collapseAria: "折叠差异",
  expandAria: (hidden: number) => `展开剩余 ${hidden} 行`,
  collapse: "折叠",
  expand: (hidden: number) => `展开 ${hidden} 行`,
  wrap: "自动换行",
  nowrap: "不换行",
  codeLabel: "代码",
  wrapLabel: "自动换行",
  unwrapLabel: "不换行",
};

const SEARCH_LABELS = {
  pathsSummary: (shown: number, total: number, truncated: boolean) =>
    `${shown}${truncated ? ` / ${total}` : ""} 个路径`,
  matchesSummary: (shown: number, total: number, files: number, truncated: boolean) =>
    `${files} 个文件 · ${shown}${truncated ? ` / ${total}` : ""} 条匹配`,
  copy: "复制",
  copied: "已复制",
  noResults: "无匹配",
  collapseAria: "折叠搜索结果",
  expandAria: (hidden: number) => `展开剩余 ${hidden} 行`,
  collapse: "折叠",
  expand: (hidden: number) => `展开 ${hidden} 行`,
};

const READ_LABELS = {
  window: (shown: number, total: number) => `显示 ${shown} / ${total} 行`,
  copy: "复制",
  copied: "已复制",
  collapseAria: "折叠内容",
  expandAria: (hidden: number) => `展开剩余 ${hidden} 行`,
  collapse: "折叠",
  expand: (hidden: number) => `展开 ${hidden} 行`,
  codeLabel: "代码",
  wrapLabel: "自动换行",
  unwrapLabel: "不换行",
};

/**
 * Markdown 正文（消息、思考展开体、工具详情、过程行）的代码块与脚注文案（P1:E1）。
 * 必须是模块顶层常量：每次渲染新建对象会让 `MarkdownText` 丢掉渲染缓存。
 * 写法同 `components/v2/task-views/ReportView.tsx` 的 `MD_LABELS`。
 */
const MARKDOWN_LABELS = {
  code: {
    copyLabel: "复制",
    copiedLabel: "已复制",
    toolbarLabels: { codeLabel: "代码", wrapLabel: "自动换行", unwrapLabel: "不换行" },
  },
  footnotes: "脚注",
};

export { TERMINAL_LABELS, DIFF_LABELS, SEARCH_LABELS, READ_LABELS, MARKDOWN_LABELS };
