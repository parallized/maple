export const SERVER_VERSION = "0.2.9";

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
    version: "0.2.9",
    releasedAt: "2026-08-06T00:27:43.000Z",
    summary: "打磨安装与看板执行体验。",
    changes: [
      "图片处理改用 Bun 原生管线",
      "DeepSeek 长会话自动压缩",
      "Windows 沙箱权限一键修复",
      "失败报告给出下一步指引",
      "看板可中止执行中任务",
      "拖拽手柄改小图标按钮",
      "安装器不再内置 sharp"
    ]
  },
  {
    version: "0.2.8",
    releasedAt: "2026-08-05T01:39:03.000Z",
    summary: "看板表格化与用量明细升级。",
    changes: [
      "看板表格式拖拽排序",
      "状态徽标与 hover 条带修复",
      "概览环形图与 token 用量表格",
      "Runner 备注与稳定排序",
      "调试列新增一键导出",
      "树形连线与待确认图标优化",
      "设置页并发滑块与提醒音频",
      "返工任务自动上浮",
      "CLI 沙箱自适应与派单约束",
      "Runner 平台图标识别"
    ]
  },
  {
    version: "0.2.7",
    releasedAt: "2026-08-04T21:14:22.000Z",
    summary: "连接与沙箱体验再简化。",
    changes: [
      "Windows 沙箱权限自动修复",
      "连接官方服务一键直连，不再选地址",
      "TUI 可直接更新到新版",
      "Leader 标签总量控制并优先复用",
      "看板标签列自适应宽度",
      "安装命令去掉 local 脚本"
    ]
  },
  {
    version: "0.2.6",
    releasedAt: "2026-08-03T13:12:51.000Z",
    summary: "安装一体，看板信息更全。",
    changes: [
      "安装脚本合一，本地服务一键装好",
      "安装时询问是否装 Playwright 截图",
      "TUI 新增连接官方服务与启动本地服务",
      "本地服务打开直接进入看板",
      "任务详情可直接编辑标签",
      "看板新增调试列：缓存/总价/SID",
      "Runner 展示平台图标"
    ]
  },
  {
    version: "0.2.5",
    releasedAt: "2026-08-01T20:21:30.000Z",
    summary: "提醒音频与用量计费升级。",
    changes: [
      "任务完成可播放自定义提醒音频",
      "用量按会话增量换算，计费更准",
      "Leader 自动给任务打 1-3 个标签",
      "标签自动注册莫兰迪配色与图标",
      "工作流串行等待与并发等待区分显示",
      "修复 BlockNote 斜杠菜单与富文本组件",
      "看板支持音频媒体与树形连线优化"
    ]
  },
  {
    version: "0.2.4",
    releasedAt: "2026-08-01T09:25:52.000Z",
    summary: "任务父子层级与返工体验。",
    changes: [
      "任务支持父子层级，看板树形展示",
      "子任务状态随父任务级联调整",
      "返工保留结果报告，不再清空",
      "已完成任务沉底，返工浮回未完成区",
      "并发执行数可调，满员自动标排队",
      "CLI 版本条与一键更新（Ctrl+U / Ctrl+P）",
      "全局宪法输入后自动保存",
      "修复本地看板地址与 Kimi 参数"
    ]
  },
  {
    version: "0.2.3",
    releasedAt: "2026-08-01T07:38:22.000Z",
    summary: "云端凭证与首页提速。",
    changes: [
      "在线 Server 支持云端 DeepSeek 凭证",
      "凭证按工作区加密，仅 HTTPS 管理",
      "WSL 与无桌面 Linux 终端选目录",
      "目录绑定前校验并解析 Git 根",
      "Dashboard 独立打包，首页提速",
      "侧栏品牌区可点击返回主页",
      "清理冗余文档与图片资源"
    ]
  },
  {
    version: "0.2.2",
    releasedAt: "2026-08-01T06:28:28.000Z",
    summary: "用量成本与固定 Worker。",
    changes: [
      "概览用量图拆分明细，新增成本估算",
      "模型定价同步支持系统代理，失败自动重试",
      "Workflow 绑定固定 Worker，优化串行续接会话",
      "Worker 汇报精简",
      "移除项目本地内置 Skill 注入",
      "修复版本弹窗层级遮挡"
    ]
  },
  {
    version: "0.2.1",
    releasedAt: "2026-07-31T12:31:58.000Z",
    summary: "新增 DeepSeek Worker。",
    changes: [
      "新增 DeepSeek Worker，支持凭证安全存储",
      "任务投递 outbox，断线重连后不丢消息",
      "权限阻塞检测与敏感信息脱敏",
      "Runner 断线自动重连与状态校准",
      "CLI 安装进度实时展示",
      "侧栏底部显示版本号"
    ]
  },
  {
    version: "0.2.0",
    releasedAt: "2026-07-28T12:57:34.000Z",
    summary: "v2 架构：服务端 + Web 看板 + Runner。",
    changes: [
      "v2 架构：服务端 + Web 看板 + Runner",
      "多项目看板与任务全生命周期管理",
      "Claude / Codex / Kimi 多 Worker 并行"
    ]
  },
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

