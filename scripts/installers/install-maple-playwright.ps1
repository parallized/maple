[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host ""
  Write-Host "[maple-installer] $Message"
}

function Get-UserHome {
  if ($env:HOME -and $env:HOME.Trim()) { return $env:HOME.Trim() }
  return [Environment]::GetFolderPath("UserProfile")
}

function Assert-NativeCommand {
  param([Parameter(Mandatory = $true)][string]$Description)
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

if ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -eq "1") {
  Write-Host "[maple-installer] Playwright installation skipped."
  return
}

$homePath = Get-UserHome
if (-not $homePath) {
  throw "User home is unavailable; cannot install the Playwright runtime."
}

$runtimePath = Join-Path $homePath ".maple/runtime/playwright"
$packageJsonPath = Join-Path $runtimePath "package.json"
$rawPlaywrightCommand = Join-Path $runtimePath "node_modules/.bin/playwright.cmd"
$playwrightCommand = Join-Path $runtimePath "maple-playwright.cmd"
$requestedPlaywrightVersion = if ($env:MAPLE_PLAYWRIGHT_VERSION -and $env:MAPLE_PLAYWRIGHT_VERSION.Trim()) {
  $env:MAPLE_PLAYWRIGHT_VERSION.Trim()
} else {
  "1.61.1"
}

Write-Step "Installing screenshot runtime (Playwright + Chromium)"
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $packageJson = '{"name":"maple-playwright-runtime","private":true,"version":"1.0.0"}' + "`n"
  [System.IO.File]::WriteAllText($packageJsonPath, $packageJson, $utf8NoBom)
}

$npm = Get-Command "npm" -ErrorAction SilentlyContinue
$bun = Get-Command "bun" -ErrorAction SilentlyContinue
if ($npm) {
  & $npm.Source install --prefix $runtimePath --save-exact --no-audit --no-fund "playwright@$requestedPlaywrightVersion"
  Assert-NativeCommand "Playwright package installation"
} elseif ($bun) {
  Push-Location $runtimePath
  try {
    & $bun.Source add --exact "playwright@$requestedPlaywrightVersion"
    Assert-NativeCommand "Playwright package installation"
  } finally {
    Pop-Location
  }
} else {
  throw "npm or Bun is required to install Playwright."
}

if (-not (Test-Path -LiteralPath $rawPlaywrightCommand -PathType Leaf)) {
  throw "Playwright executable was not created: $rawPlaywrightCommand"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$wrapper = @'
@echo off
setlocal
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"
call "%~dp0node_modules\.bin\playwright.cmd" %*
exit /b %ERRORLEVEL%
'@
[System.IO.File]::WriteAllText($playwrightCommand, $wrapper + "`r`n", $utf8NoBom)

& $playwrightCommand install chromium --only-shell
Assert-NativeCommand "Chromium installation"

$installedPlaywrightVersion = & $playwrightCommand --version
Assert-NativeCommand "Playwright verification"
Write-Host "[maple-installer] Screenshot runtime ready: $installedPlaywrightVersion"
Write-Host "[maple-installer] Runtime: $runtimePath"
Write-Host "[maple-installer] Browser cache: $(Join-Path $runtimePath 'browsers')"
