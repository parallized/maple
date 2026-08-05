export type ChangelogEntry = {
  version: string;
  /** 发布日期，YYYY-MM-DD。 */
  date: string;
  highlights: { zh: string[]; en: string[] };
};

/** 版本更新历史，新版本追加在数组最前。 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.2.8",
    date: "2026-08-05",
    highlights: {
      zh: [
        "看板表格行拖拽排序",
        "状态徽标与 hover 条带修复",
        "概览环形图与 token 用量表格",
        "Runner 备注与稳定排序",
        "调试列新增一键导出",
        "树形连线与待确认图标优化",
        "设置页并发滑块与提醒音频",
        "返工任务自动上浮",
        "CLI 沙箱自适应与派单约束",
        "Runner 平台图标识别",
      ],
      en: [
        "Drag rows to reorder the board",
        "Status badge and hover strip fixes",
        "Overview ring chart and token table",
        "Runner remarks and stable sorting",
        "One-click debug export",
        "Tree guides and confirm icon polish",
        "Concurrency slider and reminder audio",
        "Reworked tasks float back up",
        "CLI sandbox adaptivity and dispatch rules",
        "Runner platform icon detection",
      ],
    },
  },
  {
    version: "0.2.7",
    date: "2026-08-05",
    highlights: {
      zh: [
        "Windows 沙箱权限自动修复",
        "连接官方服务一键直达，不再选地址",
        "TUI 可直接更新到新版",
        "Leader 标签总量控制并优先复用",
        "看板标签列自适应宽度",
        "安装命令去掉 local 脚本",
      ],
      en: [
        "Windows sandbox ACL self-heal",
        "Connect cloud with one click",
        "Update right from the TUI",
        "Leader reuses existing tags",
        "Tag column auto-width",
        "Install command drops local",
      ],
    },
  },
  {
    version: "0.2.6",
    date: "2026-08-03",
    highlights: {
      zh: [
        "安装脚本合一，本地服务一键装好",
        "安装时询问是否装 Playwright 截图",
        "TUI 新增连接官方服务与启动本地服务",
        "本地服务打开直接进入看板",
        "任务详情可直接编辑标签",
        "看板新增调试列：缓存率/总价/SID",
        "Runner 展示平台图标",
      ],
      en: [
        "One installer for CLI and local",
        "Playwright asked during install",
        "TUI cloud / local entry",
        "Local service opens dashboard",
        "Task tags editable in panel",
        "Debug column with run metrics",
        "Runner platform icons",
      ],
    },
  },
  {
    version: "0.2.5",
    date: "2026-08-02",
    highlights: {
      zh: [
        "任务完成可播放自定义提醒音频",
        "用量按会话增量换算，计费更准",
        "Leader 自动给任务打 1-3 个标签",
        "标签自动注册莫兰迪配色与图标",
        "工作流串行等待与并发等待区分显示",
        "修复 BlockNote 斜杠菜单与富文本组件",
        "看板支持音频媒体与树形连线优化",
      ],
      en: [
        "Completion reminder audio plays",
        "Usage billed as per-run delta",
        "Leader auto-tags todos (1-3)",
        "Tags get colors and icons",
        "Serial vs concurrency waiting",
        "BlockNote slash menu fixed",
        "Audio media + tree guide polish",
      ],
    },
  },
  {
    version: "0.2.4",
    date: "2026-08-01",
    highlights: {
      zh: [
        "任务支持父子层级，看板树形展示",
        "子任务状态随父任务级联调整",
        "返工保留结果报告，不再清空",
        "已完成任务沉底，返工浮回未完成区",
        "并发执行数可调，满员自动标排队",
        "CLI 版本条与一键更新（Ctrl+U / Ctrl+P）",
        "全局宪法输入后自动保存",
        "修复本地看板地址与 Kimi 参数",
      ],
      en: [
        "Parent / child task tree on board",
        "Subtask status follows parent",
        "Rework keeps the result report",
        "Completed sink to bottom",
        "Concurrency with queue badge",
        "CLI version bar and hotkeys",
        "Constitution auto-saves",
        "Fixed dev URL and Kimi flags",
      ],
    },
  },
  {
    version: "0.2.3",
    date: "2026-08-01",
    highlights: {
      zh: [
        "在线 Server 支持云端 DeepSeek 凭据",
        "凭据按工作区加密，仅 HTTPS 管理",
        "WSL 与无桌面 Linux 终端选目录",
        "目录绑定前校验并解析 Git 根",
        "Dashboard 独立打包，首页提速",
        "侧栏品牌区可点击返回主页",
        "清理冗余文档与图片资源",
      ],
      en: [
        "Hosted Server now manages cloud DeepSeek credentials",
        "Workspace-scoped encrypted credentials, HTTPS only",
        "Terminal directory picker on WSL / headless Linux",
        "Directories validated and resolved to the Git root",
        "Dashboard split into its own bundle, faster homepage",
        "Sidebar brand now navigates back to homepage",
        "Removed stale docs and binary assets",
      ],
    },
  },
  {
    version: "0.2.2",
    date: "2026-08-01",
    highlights: {
      zh: [
        "概览用量图拆分明细，新增成本估算",
        "模型定价同步支持系统代理，失败自动重试",
        "Workflow 绑定固定 Worker，优化串行续接会话",
        "Worker 回报精简",
        "移除项目本地内置 Skill 注入",
        "修复版本弹窗层级遮挡",
      ],
      en: [
        "Usage chart splits Worker / Leader detail with cost estimates",
        "Model pricing sync honors system proxy and retries on failure",
        "Workflows bind to a fixed worker; related todos resume serially",
        "Worker reports read like plain conversation",
        "Dropped project-local Skill injection; runtime context via MCP only",
        "Fixed version popup layering and invisible dashed leader bars",
      ],
    },
  },
  {
    version: "0.2.1",
    date: "2026-07-31",
    highlights: {
      zh: [
        "新增 DeepSeek Worker，支持凭证安全存储",
        "任务投递 outbox，断线重连后不丢消息",
        "权限阻塞检测与敏感信息脱敏",
        "Runner 断线自动重连与状态校准",
        "CLI 安装进度实时展示",
        "侧栏底部显示版本号",
      ],
      en: [
        "New DeepSeek worker with secure credential storage",
        "Delivery outbox keeps messages across reconnects",
        "Permission-blocker detection and secret redaction",
        "Runner auto-reconnect and state reconciliation",
        "Live CLI install progress",
        "Version number shown at sidebar bottom",
      ],
    },
  },
  {
    version: "0.2.0",
    date: "2026-07-28",
    highlights: {
      zh: [
        "v2 架构：服务端 + Web 看板 + Runner",
        "多项目看板与任务全生命周期管理",
        "Claude / Codex / Kimi 多 Worker 并行",
      ],
      en: [
        "v2 architecture: server + web board + runner",
        "Multi-project board with full task lifecycle",
        "Parallel Claude / Codex / Kimi workers",
      ],
    },
  },
];
