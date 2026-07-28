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
  throw "Maple Local requires HTTPS for remote downloads."
}

$userHome = [Environment]::GetFolderPath("UserProfile")
$mapleHome = if ($env:MAPLE_HOME_DIR) { [IO.Path]::GetFullPath($env:MAPLE_HOME_DIR) } else { Join-Path $userHome ".maple" }
$binDir = Join-Path $mapleHome "bin"
$runtimeDir = Join-Path $mapleHome "runtime"
$appDir = Join-Path $mapleHome "local-app"
$stagingDir = Join-Path $mapleHome "local-app.installing.$PID"
$backupDir = Join-Path $mapleHome "local-app.previous.$PID"
$manifestUrl = "$serverUrl/downloads/maple-local/manifest.txt"
$published = $false

function Move-MapleDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Move-Item -LiteralPath $Source -Destination $Destination
      return
    } catch {
      if ($attempt -eq 3) { throw }
      Start-Sleep -Seconds 1
    }
  }
}

foreach ($managedPath in @($stagingDir, $backupDir)) {
  $resolved = [IO.Path]::GetFullPath($managedPath)
  $prefix = [IO.Path]::GetFullPath($mapleHome).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Maple Local generated an unsafe installation path."
  }
}

if (Test-Path -LiteralPath $stagingDir) { Remove-Item -LiteralPath $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $binDir, $runtimeDir, $stagingDir | Out-Null
if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }

try {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    Write-Host "[maple-local] Installing Bun runtime..."
    Invoke-RestMethod "https://bun.sh/install.ps1" | Invoke-Expression
    $bunPath = Join-Path $userHome ".bun/bin/bun.exe"
  } else {
    $bunPath = $bunCommand.Source
  }
  if (-not (Test-Path -LiteralPath $bunPath -PathType Leaf)) { throw "Bun installation failed." }

  Write-Host "[maple-local] Downloading Server, WebUI and CLI..."
  $manifestPath = Join-Path $stagingDir ".manifest"
  Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl -OutFile $manifestPath
  foreach ($relativePath in Get-Content -LiteralPath $manifestPath -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
    if ($relativePath.StartsWith("/") -or $relativePath.Contains("..") -or $relativePath.Contains("\")) {
      throw "The Maple Local download manifest contains an invalid path."
    }
    $targetPath = Join-Path $stagingDir $relativePath.Replace("/", [IO.Path]::DirectorySeparatorChar)
    $targetDirectory = Split-Path -Parent $targetPath
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri "$serverUrl/downloads/maple-local/$relativePath" -OutFile $targetPath
  }
  Remove-Item -LiteralPath $manifestPath -Force

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText(
    (Join-Path $stagingDir "package.json"),
    '{"name":"maple-local-runtime","private":true}' + "`n",
    $utf8NoBom
  )
  [IO.File]::WriteAllText(
    (Join-Path $stagingDir ".update-source"),
    $serverUrl + "`n",
    $utf8NoBom
  )
  Write-Host "[maple-local] Installing the platform image runtime..."
  Push-Location $stagingDir
  try { & $bunPath add --exact "sharp@0.35.3" } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Sharp runtime installation failed." }

  $localEntry = Join-Path $stagingDir "maple-local.js"
  $dashboardEntry = Join-Path $stagingDir "web/index.html"
  if (-not (Test-Path -LiteralPath $localEntry -PathType Leaf)) { throw "CLI payload is incomplete." }
  if (-not (Test-Path -LiteralPath $dashboardEntry -PathType Leaf)) { throw "WebUI payload is incomplete." }
  $nativeRoot = Join-Path $stagingDir "node_modules/@img"
  if (-not (Get-ChildItem -LiteralPath $nativeRoot -Recurse -Filter "*.node" -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    throw "Platform image runtime is incomplete."
  }
  & $bunPath $localEntry help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Maple Local verification failed." }

  if (Test-Path -LiteralPath $appDir) {
    try { Move-MapleDirectory -Source $appDir -Destination $backupDir }
    catch { throw "Close Maple Local before updating, then try again." }
  }
  try {
    Move-MapleDirectory -Source $stagingDir -Destination $appDir
    $published = $true
  } catch {
    if (Test-Path -LiteralPath $backupDir) { Move-MapleDirectory -Source $backupDir -Destination $appDir }
    throw
  }
  if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }

  $wrapperPath = Join-Path $binDir "maple-local.cmd"
  $updaterPath = Join-Path $binDir "maple-local-update.ps1"
  $writeLaunchers = $env:MAPLE_LAUNCHED_BY_UPDATER -ne "1" -or -not (Test-Path -LiteralPath $wrapperPath -PathType Leaf) -or -not (Test-Path -LiteralPath $updaterPath -PathType Leaf)
  if ($writeLaunchers) {
    $updater = @'
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$mapleHome = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $mapleHome "local-app/.update-source"
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Maple Local update source is unavailable. Re-run the original installer."
}
$serverUrl = [IO.File]::ReadAllText($sourcePath).Trim().TrimEnd("/")
if (-not ($serverUrl.StartsWith("https://") -or $serverUrl.StartsWith("http://127.0.0.1") -or $serverUrl.StartsWith("http://localhost"))) {
  throw "The saved Maple Local update source is not trusted."
}

Write-Host "[maple-local] Checking for the latest version..."
$env:MAPLE_HOME_DIR = $mapleHome
$env:MAPLE_LAUNCHED_BY_UPDATER = "1"
Invoke-RestMethod "$serverUrl/install-local.ps1" | Invoke-Expression
'@
    [IO.File]::WriteAllText($updaterPath, $updater + "`r`n", $utf8NoBom)

    $wrapper = "@echo off`r`nif /I `"%~1`"==`"update`" (`r`n  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$updaterPath`"`r`n  exit /b %ERRORLEVEL%`r`n)`r`n`"$bunPath`" `"$appDir\maple-local.js`" %*`r`n"
    [IO.File]::WriteAllText($wrapperPath, $wrapper, $utf8NoBom)
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathEntries = @($userPath -split ";" | Where-Object { $_ })
  if (-not ($pathEntries | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") })) {
    [Environment]::SetEnvironmentVariable("Path", (($pathEntries + $binDir) -join ";"), "User")
  }
  $env:Path = "$binDir;$env:Path"

  if ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -ne "1") {
    Write-Host "[maple-local] Installing Playwright runtime..."
    $playwrightDir = Join-Path $runtimeDir "playwright"
    New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $playwrightDir "package.json"))) {
      [IO.File]::WriteAllText(
        (Join-Path $playwrightDir "package.json"),
        '{"name":"maple-playwright-runtime","private":true}' + "`n",
        $utf8NoBom
      )
    }
    Push-Location $playwrightDir
    try { & $bunPath add --exact "playwright@1.61.1" } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "Playwright package installation failed." }
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $playwrightDir "browsers"
    & $bunPath (Join-Path $playwrightDir "node_modules/playwright/cli.js") install chromium --only-shell
    if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed." }
  }

  Write-Host "[maple-local] Installed in $appDir"
  Write-Host "[maple-local] Run: maple-local"
  Write-Host "[maple-local] Update later: maple-local update"
} finally {
  if (-not $published -and (Test-Path -LiteralPath $stagingDir)) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }
}
