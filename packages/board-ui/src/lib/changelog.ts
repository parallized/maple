export type ChangelogEntry = {
  version: string;
  /** 发布日期，YYYY-MM-DD。 */
  date: string;
  highlights: { zh: string[]; en: string[] };
};

/** 版本更新历史，新版本追加在数组最前。 */
export const CHANGELOG: ChangelogEntry[] = [
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
