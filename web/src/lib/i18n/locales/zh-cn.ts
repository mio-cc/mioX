/**
 * 简体中文语言包（默认语言）。
 *
 * 采用 gettext 风格的源文案作为 key：
 * - key 为英文时，这里提供中文译文；
 * - key 为中文时，不需要配置，翻译函数会原样回退。
 *
 * 缩写（LLM、API、Agent、HTTP、TCP、MITM、SOCKS 等）按产品惯例保留，不做强行翻译。
 */
const zhCN: Record<string, string> = {
  // 通用
  Language: "语言",
  "Interface Language": "界面语言",
  English: "English",
  "Simplified Chinese": "简体中文",
  Version: "版本",
  Save: "保存",
  Cancel: "取消",
  Configured: "已配置",
  Test: "测试",
  Testing: "测试中",
  "Restore Defaults": "恢复默认",
  Preferences: "偏好设置",
  "Customize your dashboard layout preferences.": "自定义仪表盘布局偏好。",

  // 布局设置
  "Theme Preset": "主题预设",
  Preset: "预设",
  Fonts: "字体",
  "Select font": "选择字体",
  "Theme Mode": "主题模式",
  Light: "浅色",
  Dark: "深色",
  System: "跟随系统",
  "Page Layout": "页面布局",
  Centered: "居中",
  "Full Width": "全宽",
  "Navbar Behavior": "导航栏行为",
  Sticky: "吸顶",
  Scroll: "滚动",
  "Sidebar Style": "侧边栏样式",
  Inset: "内嵌",
  Sidebar: "侧边栏",
  Floating: "悬浮",
  "Sidebar Collapse Mode": "侧边栏折叠模式",
  Icon: "仅图标",
  OffCanvas: "抽屉",
  "Toggle light": "切换浅色",
  "Toggle dark": "切换深色",
  "Toggle system": "切换跟随系统",
  "Toggle centered": "切换居中布局",
  "Toggle full-width": "切换全宽布局",
  "Toggle sticky": "切换吸顶导航",
  "Toggle scroll": "切换滚动导航",
  "Toggle inset": "切换内嵌侧边栏",
  "Toggle sidebar": "切换侧边栏样式",
  "Toggle floating": "切换悬浮侧边栏",
  "Toggle icon": "切换仅图标折叠",
  "Toggle offcanvas": "切换抽屉折叠",
  Default: "默认",
  Brutalist: "粗野主义",
  "Soft Pop": "柔和流行",
  Tangerine: "橘子",

  // 系统配置页英文术语
  "Brave Search API Key": "Brave 搜索 API Key",
  "Tavily Search API Key": "Tavily 搜索 API Key",
  DeepSeek: "DeepSeek",
  Key: "Key",
  Token: "Token",
  // 导航徽标
  "new": "新",
  soon: "即将",
};

export default zhCN;
