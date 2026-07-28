[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$serverUrl = "__MAPLE_SERVER_URL__"
if (-not ($serverUrl.StartsWith("https://") -or $serverUrl.StartsWith("http://"))) {
  $serverUrl = if ($env:MAPLE_SERVER_URL) { $env:MAPLE_SERVER_URL } else { "http://127.0.0.1:45820" }
}
$serverUrl = $serverUrl.TrimEnd("/")
if (-not ($serverUrl.StartsWith("https://") -or $serverUrl.StartsWith("http://127.0.0.1") -or $serverUrl.StartsWith("http://localhost"))) {
  throw "Maple installer requires HTTPS for remote servers."
}

$userHome = [Environment]::GetFolderPath("UserProfile")
$mapleHome = Join-Path $userHome ".maple"
$binDir = Join-Path $mapleHome "bin"
$runtimeDir = Join-Path $mapleHome "runtime"
$cliPath = Join-Path $binDir "maple-cli.js"
$wrapperPath = Join-Path $binDir "maple.cmd"
New-Item -ItemType Directory -Force -Path $binDir, $runtimeDir | Out-Null

$bunCommand = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCommand) {
  Write-Host "[maple] Installing Bun runtime..."
  Invoke-RestMethod "https://bun.sh/install.ps1" | Invoke-Expression
  $bunPath = Join-Path $userHome ".bun/bin/bun.exe"
} else {
  $bunPath = $bunCommand.Source
}
if (-not (Test-Path -LiteralPath $bunPath -PathType Leaf)) { throw "Bun installation failed." }

Write-Host "[maple] Downloading CLI..."
$temporaryCli = "$cliPath.download"
Invoke-WebRequest -UseBasicParsing -Uri "$serverUrl/downloads/maple-cli.js" -OutFile $temporaryCli
if ((Get-Item -LiteralPath $temporaryCli).Length -lt 10000) { throw "Downloaded CLI is incomplete." }
Move-Item -Force -LiteralPath $temporaryCli -Destination $cliPath

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$wrapper = "@echo off`r`n`"$bunPath`" `"%~dp0maple-cli.js`" %*`r`n"
[System.IO.File]::WriteAllText($wrapperPath, $wrapper, $utf8NoBom)

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntries = @($userPath -split ";" | Where-Object { $_ })
if (-not ($pathEntries | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") })) {
  [Environment]::SetEnvironmentVariable("Path", (($pathEntries + $binDir) -join ";"), "User")
}
$env:Path = "$binDir;$env:Path"

# Starting the CLI once creates the managed Skill and MCP config under ~/.maple/runtime.
& $bunPath $cliPath status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Maple CLI verification failed." }

if ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -ne "1") {
  Write-Host "[maple] Installing Playwright runtime..."
  $playwrightDir = Join-Path $runtimeDir "playwright"
  New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null
  if (-not (Test-Path (Join-Path $playwrightDir "package.json"))) {
    [System.IO.File]::WriteAllText((Join-Path $playwrightDir "package.json"), '{"name":"maple-playwright-runtime","private":true}' + "`n", $utf8NoBom)
  }
  Push-Location $playwrightDir
  try { & $bunPath add --exact "playwright@1.61.1" } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Playwright package installation failed." }
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $playwrightDir "browsers"
  & $bunPath (Join-Path $playwrightDir "node_modules/playwright/cli.js") install chromium --only-shell
  if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed." }
  $playwrightWrapper = "@echo off`r`nset `"PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers`"`r`n`"$bunPath`" `"%~dp0node_modules\playwright\cli.js`" %*`r`n"
  [System.IO.File]::WriteAllText((Join-Path $playwrightDir "maple-playwright.cmd"), $playwrightWrapper, $utf8NoBom)
}

Write-Host "[maple] Installed in $mapleHome"
Write-Host "[maple] Connect with: maple connect --server $serverUrl"
