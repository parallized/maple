$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

param(
  [string]$McpUrl = "http://localhost:45819/mcp"
)

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "[maple-installer] $Message"
}

function Get-UserHome {
  if ($env:HOME -and $env:HOME.Trim()) { return $env:HOME.Trim() }
  return [Environment]::GetFolderPath("UserProfile")
}

function Write-TextFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Try-GetCommandPath {
  param([Parameter(Mandatory = $true)][string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  return $cmd.Source
}

function ConvertTo-HashtableRecursive {
  param([Parameter(Mandatory = $true)]$Value)

  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IDictionary]) {
    $result = @{}
    foreach ($key in $Value.Keys) {
      $result[$key] = ConvertTo-HashtableRecursive $Value[$key]
    }
    return $result
  }
  if ($Value -is [pscustomobject]) {
    $result = @{}
    foreach ($prop in $Value.PSObject.Properties) {
      $result[$prop.Name] = ConvertTo-HashtableRecursive $prop.Value
    }
    return $result
  }
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    return @($Value | ForEach-Object { ConvertTo-HashtableRecursive $_ })
  }
  return $Value
}

function Install-Codex {
  Write-Step "Installing Maple MCP for Codex"
  if (-not (Try-GetCommandPath "codex")) {
    Write-Warning "[maple-installer] codex not found; skipped."
    return
  }

  try { & codex mcp remove maple *> $null } catch { }
  & codex mcp add maple --url $McpUrl | Out-Null

  Write-Step "Installing local Maple skill for Codex"
  $home = Get-UserHome
  $skillPath = Join-Path $home ".codex/skills/maple/SKILL.md"
  Write-TextFile -Path $skillPath -Content @"
---
name: maple
description: "Run /maple workflow for Maple development tasks."
---

# maple

When user asks `/maple`:
1. Work in the current working directory (do NOT cd elsewhere).
2. Use Maple MCP tools (query_project_todos, query_recent_context) to gather tasks/context.
3. Always run typecheck/build verification before marking done.
4. For each task, call `submit_task_report` to set `进行中` when execution starts, then set `已完成` / `已阻塞` / `需要更多信息` when execution ends.
5. Before ending, call `query_project_todos` and ensure no `待办` / `队列中` / `进行中` task remains.
6. Call `finish_worker` as the final MCP call.
7. Output `mcp_decision` with status, comment, and tags.
"@

  Write-Host ""
  Write-Host "[maple-installer] Codex setup done."
  Write-Host "[maple-installer] MCP registered as HTTP server at $McpUrl"
  Write-Host "[maple-installer] Restart Codex session to load ~/.codex/skills/maple"
}

function Install-Claude {
  Write-Step "Installing Maple MCP for Claude Code"
  if (-not (Try-GetCommandPath "claude")) {
    Write-Warning "[maple-installer] claude not found; skipped."
    return
  }

  try { & claude mcp remove maple --scope user *> $null } catch { }
  & claude mcp add --scope user --transport http maple $McpUrl | Out-Null

  Write-Step "Installing local /maple command for Claude Code"
  $home = Get-UserHome
  $commandPath = Join-Path $home ".claude/commands/maple.md"
  Write-TextFile -Path $commandPath -Content @"
Run Maple workflow in the current working directory:

1. Use Maple MCP tools (query_project_todos, query_recent_context) to get tasks
2. Implement the requested changes in the current project
3. Run typecheck/build before finishing
4. For each task call submit_task_report: set status to 进行中 at start, then set to 已完成 / 已阻塞 / 需要更多信息 at finish
5. Before ending, call query_project_todos and ensure no 待办 / 队列中 / 进行中 task remains
6. Call finish_worker as the final MCP call
7. Output mcp_decision with status, comment, and tags
"@

  Write-Host ""
  Write-Host "[maple-installer] Claude setup done."
  Write-Host "[maple-installer] MCP registered as HTTP server at $McpUrl"
  Write-Host "[maple-installer] Open Claude Code and run /maple"
}

function Install-iFlow {
  Write-Step "Installing Maple MCP for iFlow"
  if (-not (Try-GetCommandPath "iflow")) {
    Write-Warning "[maple-installer] iflow not found; skipped."
    return
  }

  try { & iflow mcp remove maple *> $null } catch { }
  & iflow mcp add --scope user --transport http maple $McpUrl | Out-Null

  Write-Step "Installing Maple workflow/skill assets for iFlow (~/.iflow)"
  $home = Get-UserHome
  $workflowPath = Join-Path $home ".iflow/workflows/maple.md"
  $skillIndexPath = Join-Path $home ".iflow/skills/SKILL.md"
  $skillPath = Join-Path $home ".iflow/skills/maple/SKILL.md"

  Write-TextFile -Path $workflowPath -Content @"
/maple

Work in the current working directory (do NOT cd elsewhere).
Use Maple MCP tools to query tasks and submit results.
Run typecheck/build before finishing.
For each task call submit_task_report: set status to 进行中 at start, then set to 已完成 / 已阻塞 / 需要更多信息 at finish.
Before ending, call query_project_todos and ensure no 待办 / 队列中 / 进行中 task remains.
Call finish_worker as the final MCP call.
Output mcp_decision with status, comment, and tags.
"@

  Write-TextFile -Path $skillIndexPath -Content @"
---
name: maple
description: "Project-local maple skill index."
---

# maple

Use `~/.iflow/skills/maple/SKILL.md` for the full maple execution skill.
"@

  Write-TextFile -Path $skillPath -Content @"
---
name: maple
description: "Run maple workflow in this repository."
---

# maple

Maple execution skill:
- execute tasks end-to-end
- use Maple MCP + local skills first
- run typecheck/build before completion
- use submit_task_report to mark each task as 进行中 at start, then settle to 已完成 / 已阻塞 / 需要更多信息
- call query_project_todos before ending, and keep no 待办 / 队列中 / 进行中 tasks
- call finish_worker as the final MCP call
- keep Maple on the standalone execution path
"@

  Write-Host ""
  Write-Host "[maple-installer] iFlow setup done."
  Write-Host "[maple-installer] MCP registered as HTTP server at $McpUrl"
  Write-Host "[maple-installer] Assets written to $workflowPath and $skillPath"
}

function Install-Windsurf {
  Write-Step "Installing Maple MCP for Windsurf"

  $home = Get-UserHome
  $windsurfConfigDir = Join-Path $home ".codeium/windsurf"
  $windsurfConfigPath = Join-Path $windsurfConfigDir "mcp_config.json"
  New-Item -ItemType Directory -Force -Path $windsurfConfigDir | Out-Null

  $config = @{}
  if (Test-Path $windsurfConfigPath) {
    $raw = (Get-Content -Raw -ErrorAction SilentlyContinue $windsurfConfigPath).Trim()
    if ($raw) {
      try {
        $config = $raw | ConvertFrom-Json -ErrorAction Stop
      } catch {
        Write-Warning "[maple-installer] invalid JSON in $windsurfConfigPath; overwriting."
        $config = @{}
      }
    }
  }
  $config = ConvertTo-HashtableRecursive $config
  if (-not ($config -is [hashtable])) {
    $config = @{}
  }
  if (-not $config.ContainsKey("mcpServers") -or -not ($config.mcpServers -is [hashtable])) {
    $config.mcpServers = @{}
  }
  $config.mcpServers.maple = @{ url = $McpUrl }

  $json = $config | ConvertTo-Json -Depth 100
  Write-TextFile -Path $windsurfConfigPath -Content ($json + "`n")

  Write-Step "Installing local /maple workflow for Windsurf"
  $mapleRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  $workflowPath = Join-Path $mapleRoot ".windsurf/workflows/maple.md"
  Write-TextFile -Path $workflowPath -Content @"
# /maple

当用户输入 `/maple` 时，按以下流程执行：

1. 在当前项目根目录执行，使用 Maple MCP + Maple Skills 作为唯一执行链路。
2. 先调用 Maple MCP 查询能力获取任务与上下文：
   - `query_project_todos`：拉取当前项目未完成任务（按更新时间倒序）。
   - `query_recent_context`：拉取近期报告与 Worker 日志上下文（可按关键词过滤）。
3. 对每条任务执行端到端实现：代码修改、类型检查、构建校验。
4. 仅通过 Maple Skills 的 MCP 决策输出决定任务结果：
   - 必须产出 `mcp_decision.status`、`mcp_decision.comment`、`mcp_decision.tags[]`。
   - 缺少 `mcp_decision` 时，不得标记完成，统一标记为阻塞并说明原因。
5. 对每条任务调用 `submit_task_report`：开始执行先更新为 `进行中`，结束后再更新为 `已完成` / `已阻塞` / `需要更多信息`。
6. 结束前必须再次调用 `query_project_todos`，确认不存在 `待办` / `队列中` / `进行中` 任务。
7. 仅在第 6 步满足后，调用 `finish_worker`（必须作为最后一个 MCP 调用）。
8. 输出本轮执行汇总（已完成 / 需更多信息 / 已阻塞 / 剩余）。

输出语言默认使用中文，除非用户明确要求其他语言。
"@

  Write-Host ""
  Write-Host "[maple-installer] Windsurf setup done."
  Write-Host "[maple-installer] MCP config written to $windsurfConfigPath"
  Write-Host "[maple-installer] Workflow written to $workflowPath"
  Write-Host "[maple-installer] Restart Windsurf to load updated MCP config."
}

Write-Host "[maple-install] Installing maple MCP + skills for Codex / Claude / iFlow / Windsurf..."
Install-Codex
Install-Claude
Install-iFlow
Install-Windsurf
Write-Host "[maple-install] Done."
