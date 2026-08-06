#Requires -RunAsAdministrator
<#
  fix-codex-sandbox-acls.ps1 — 通用修复 Codex Windows 沙箱的工作区写入权限。

  本脚本不包含任何用户目录 / 盘符 / 机器信息，任何用户、任何机器都可直接使用：
    1. 命令行参数可指定任意项目目录；
    2. 默认从 ~/.codex/cap_sid 读取 Codex 自己登记的工作区（随用户环境自动变化）；
    3. 自动包含当前所在目录。

  背景：Codex 沙箱主体 CodexSandboxUsers 需要对工作区目录拥有
  "显式 + 可继承 + Modify" 的 ACE。Maple 每次启动会话都会自动补齐；
  仅当目录所有者不是当前用户（换机、移动盘符等）时，自动补齐才会因缺少
  权限而失败。本脚本以管理员身份运行一次，同时修正所有者（takeown）与
  授权（icacls），此后 Maple 可自行维护，无需再手动处理。

  用法（管理员 PowerShell）：
    .\scripts\fix-codex-sandbox-acls.ps1                 # 自动发现并修复
    .\scripts\fix-codex-sandbox-acls.ps1 D:\project      # 指定任意目录
    .\scripts\fix-codex-sandbox-acls.ps1 -SkipOwnership  # 只授权，不改所有者
    .\scripts\fix-codex-sandbox-acls.ps1 -Recursive      # 递归修正子目录所有者
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths,
  [switch]$SkipOwnership,
  [switch]$Recursive
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$CodexSandboxGroup = "CodexSandboxUsers"
$MaxImmediateSubdirTargets = 32

function Test-ExplicitInheritableModifyAce {
  param([string]$Output, [string]$Principal)
  $needle = "${Principal}:"
  foreach ($line in $Output -split "`r?`n") {
    $idx = $line.IndexOf($needle)
    if ($idx -lt 0) { continue }
    $rights = $line.Substring($idx + $needle.Length).Trim()
    if ($rights -match "\(I\)") { continue }
    if ($rights -match "\(OI\)" -and $rights -match "\(CI\)" -and ($rights -match "\(M\)|\(M,|\(F\)")) {
      return $true
    }
  }
  return $false
}

function Get-DiscoveredWorkspaces {
  $found = New-Object System.Collections.Generic.List[string]
  # Codex 工作区注册表；路径通过 $HOME 推导，随用户自动变化。
  $capFile = Join-Path $HOME ".codex\cap_sid"
  if (Test-Path -LiteralPath $capFile) {
    try {
      $cap = Get-Content -LiteralPath $capFile -Raw | ConvertFrom-Json
      $candidates = @()
      if ($null -ne $cap.workspace_by_cwd) { $candidates += $cap.workspace_by_cwd.PSObject.Properties.Name }
      if ($null -ne $cap.writable_root_by_path) { $candidates += $cap.writable_root_by_path.PSObject.Properties.Name }
      $profileRoot = if ($env:USERPROFILE) { $env:USERPROFILE.TrimEnd("\") } else { "" }
      $systemRoot = if ($env:SystemRoot) { $env:SystemRoot.TrimEnd("\") } else { "" }
      foreach ($candidate in $candidates) {
        # cap_sid 里是正斜杠（如 e:/codespace/maple），统一转成反斜杠再判断。
        $path = ([string]$candidate).Replace("/", "\")
        if ($path -notmatch "^[A-Za-z]:\\") { continue }
        if ($path -match "^[A-Za-z]:\\$") { continue }
        if ($profileRoot -and $path.StartsWith($profileRoot + "\", [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($systemRoot -and $path.StartsWith($systemRoot + "\", [StringComparison]::OrdinalIgnoreCase)) { continue }
        if (Test-Path -LiteralPath $path -PathType Container) { $found.Add($path) }
      }
    } catch {
      Write-Warning "无法解析 $capFile，已跳过自动发现：$($_.Exception.Message)"
    }
  }
  # 当前所在目录（用户在哪运行，就覆盖哪）。
  if ($PWD) {
    $cwd = [string]$PWD.Path
    if (Test-Path -LiteralPath $cwd -PathType Container) { $found.Add($cwd) }
  }
  # 脚本所在仓库根（在 maple 仓库内运行时，一次覆盖本项目）。
  if ($PSScriptRoot) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    if (Test-Path -LiteralPath $repoRoot -PathType Container) { $found.Add($repoRoot) }
  }
  return ($found | Where-Object { $_ } | Sort-Object -Unique)
}

$targets = @()
if ($Paths.Count -gt 0) {
  $targets = @($Paths | ForEach-Object { [string]$_ })
} else {
  $targets = @(Get-DiscoveredWorkspaces)
}
$targets = @($targets | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Sort-Object -Unique)

if ($targets.Count -eq 0) {
  Write-Host "[maple] 未发现需要处理的工作区目录，无需修复。"
  exit 0
}

Write-Host "[maple] 正在为 Codex Windows 沙箱补齐工作区写入权限 ..."
$fixed = New-Object System.Collections.Generic.List[string]
$failed = New-Object System.Collections.Generic.List[string]
$skipped = 0

foreach ($root in $targets) {
  if (-not $SkipOwnership) {
    Write-Host "[maple] 修正所有者（当前用户）：$root"
    if ($Recursive) {
      & takeown /F $root /R /D Y 2>&1 | Out-Null
    } else {
      & takeown /F $root 2>&1 | Out-Null
    }
  }
  $dirTargets = @($root)
  $dirTargets += @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Select-Object -First $MaxImmediateSubdirTargets | ForEach-Object { $_.FullName })
  foreach ($dir in ($dirTargets | Sort-Object -Unique)) {
    $acl = & icacls $dir 2>&1 | Out-String
    if (Test-ExplicitInheritableModifyAce $acl $CodexSandboxGroup) {
      $skipped++
      continue
    }
    $grant = & icacls $dir /grant "${CodexSandboxGroup}:(OI)(CI)M" 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
      $fixed.Add($dir)
      continue
    }
    if ($grant -match "no mapping between account names|没有完成的映射|找不到") {
      $current = "$env:USERDOMAIN\$env:USERNAME"
      $fallback = & icacls $dir /grant "${current}:(OI)(CI)M" 2>&1 | Out-String
      if ($LASTEXITCODE -eq 0) {
        $fixed.Add("$dir (fallback: $current)")
      } else {
        $failed.Add($dir)
      }
    } else {
      $failed.Add($dir)
    }
  }
}

Write-Host ""
Write-Host "[maple] 完成：已修复 $($fixed.Count) 个目录，已就绪 $skipped 个目录，失败 $($failed.Count) 个目录。"
if ($failed.Count -gt 0) {
  Write-Host "[maple] 以下目录未能修复（请确认 CodexSandboxUsers 本地组存在）："
  $failed | ForEach-Object { Write-Host "  - $_" }
  exit 1
}
Write-Host "[maple] 无需再手动维护目录清单：Maple 之后会自动为工作区补齐权限。"
