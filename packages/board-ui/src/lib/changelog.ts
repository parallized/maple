export type ChangelogEntry = {
  version: string;
  /** 发布日期，YYYY-MM-DD。 */
  date: string;
  highlights: { zh: string[]; en: string[] };
};

/** 版本更新历史，新版本追加在数组最前。 */
export const CHANGELOG: ChangelogEntry[] = [
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
