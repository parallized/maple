# Maple MCP 与 Skills 指南

## Monorepo 拆分位置

- `packages/mcp-tools`：Maple MCP 工具能力（项目待办查询、最近上下文查询、工具清单）
- `packages/worker-skills`：Maple Skills 能力（任务执行 Prompt、技能定义）

## 与 Notion 的关系（关键）

- `Maple MCP + Maple Skills` 是应用内能力，和 Notion 没有强依赖。
- 只有在使用 NPT（Notion Project Tracker）同步任务时，才需要额外接入 Notion MCP。
- 不使用 NPT 时，Maple 仍可正常运行本地 MCP/Skills 流程。

## 在 Maple 仓库内安装

1. 在仓库根目录执行依赖安装：

```bash
pnpm install
```

2. 验证拆分后的包已被桌面端正确引用：

```bash
pnpm typecheck
pnpm build
```

## 在其他工程中复用这两个包

```bash
pnpm add @maple/mcp-tools @maple/worker-skills
```

## 继续扩展 Maple MCP 与 Skills

- MCP 工具扩展：编辑 `packages/mcp-tools/src/index.ts`，新增工具定义与查询函数。
- Skills 扩展：编辑 `packages/worker-skills/src/index.ts`，新增技能项并调整提示词模板。
- 扩展后统一验证：

```bash
pnpm typecheck
pnpm build
```

## （可选）接入 Notion MCP（仅 NPT 需要）

```bash
codex mcp add notion --url https://mcp.notion.com/mcp
codex mcp login notion
codex mcp list
```

`codex mcp list` 中出现 `notion` 且状态正常，即安装完成。

## （可选）Codex 侧安装 Skills

1. 推荐：在 Codex 会话中使用 `$skill-installer`，按技能名安装。
2. 手动：把技能目录放入 `~/.codex/skills/<skill-name>`。
3. 安装后重启 Codex 会话，使新技能生效。
