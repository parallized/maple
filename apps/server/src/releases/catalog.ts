export const SERVER_VERSION = "0.1.6";

export interface ReleaseDefinition {
  version: string;
  releasedAt: string;
  summary: string;
  changes: readonly string[];
}

/**
 * Published releases are kept in source so deployed Servers do not depend on
 * Git metadata. Add the newest release first when publishing a new version.
 */
export const RELEASE_CATALOG = [
  {
    version: "0.1.6",
    releasedAt: "2026-03-21T04:38:53.000Z",
    summary: "提升命令行运行环境的兼容性。",
    changes: ["修复 PowerShell 8 环境下的启动兼容问题。"]
  },
  {
    version: "0.1.5",
    releasedAt: "2026-03-18T10:29:40.000Z",
    summary: "改进 Worker 稳定性与多模型执行体验。",
    changes: [
      "修复 Worker 启动与顶部导航问题。",
      "改进 Gemini CLI 参数处理。",
      "调整 Windows 下的 WSL 执行策略。"
    ]
  },
  {
    version: "0.1.4",
    releasedAt: "2026-03-02T08:21:09.000Z",
    summary: "扩展 Worker 集成并优化看板交互。",
    changes: [
      "新增 OpenCode 与 Gemini CLI 支持。",
      "优化状态展示、弹出菜单与整体样式。"
    ]
  },
  {
    version: "0.1.3",
    releasedAt: "2026-02-28T07:29:25.000Z",
    summary: "完善安装引导与 Worker 重试流程。",
    changes: ["新增安装指引。", "改进 Worker 失败重试。"]
  },
  {
    version: "0.1.2",
    releasedAt: "2026-02-27T07:27:03.000Z",
    summary: "增强桌面任务流与内容展示。",
    changes: ["改进任务详情、Markdown 与桌面运行体验。"]
  },
  {
    version: "0.1.1",
    releasedAt: "2026-02-26T14:56:40.000Z",
    summary: "补齐安装、托盘与任务详情能力。",
    changes: ["完善安装器和 WSL 安装。", "新增任务托盘与执行内容展示。"]
  },
  {
    version: "0.1.0",
    releasedAt: "2026-02-23T08:01:04.000Z",
    summary: "Maple 首个公开版本。",
    changes: ["提供桌面看板、任务详情与基础打包流程。"]
  }
] as const satisfies readonly ReleaseDefinition[];

