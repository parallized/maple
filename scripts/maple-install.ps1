[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$MapleInstallStage = "reading installer configuration"
$script:MapleProgressActivity = ""
$script:MapleNextDownloadPercent = 0
trap {
  $failure = $_
  try { Write-Progress -Id 1 -Activity "Installing Maple" -Completed } catch {}
  [Console]::Error.WriteLine("[maple] Installation failed during $MapleInstallStage.")
  if ($failure.Exception.Message) {
    [Console]::Error.WriteLine("[maple] Cause: $($failure.Exception.Message)")
  }
  break
}

function Format-MapleBytes {
  param([long]$Bytes)
  if ($Bytes -ge 1GB) { return [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.0} GB", $Bytes / 1GB) }
  if ($Bytes -ge 1MB) { return [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.0} MB", $Bytes / 1MB) }
  if ($Bytes -ge 1KB) { return [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.0} KB", $Bytes / 1KB) }
  return "$Bytes B"
}

function Test-MapleProgressAvailable {
  try { return [Environment]::UserInteractive -and -not [Console]::IsOutputRedirected }
  catch { return $false }
}

function Invoke-MapleDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Activity,
    [Parameter(Mandatory = $true)][string]$Status,
    [long]$CompletedBytes = 0,
    [long]$TotalBytes = 0,
    [int]$ProgressId = 1
  )
  $request = [Net.HttpWebRequest]::Create($Uri)
  $request.AllowAutoRedirect = $true
  $response = $null
  $source = $null
  $target = $null
  try {
    $response = $request.GetResponse()
    $source = $response.GetResponseStream()
    $target = [IO.File]::Open($Destination, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $buffer = New-Object byte[] 65536
    $downloaded = 0L
    while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $target.Write($buffer, 0, $read)
      $downloaded += $read
      $progressBytes = if ($TotalBytes -gt 0) { $CompletedBytes + $downloaded } else { $downloaded }
      $progressTotal = if ($TotalBytes -gt 0) { $TotalBytes } else { $response.ContentLength }
      if ($script:MapleProgressActivity -ne $Activity) {
        $script:MapleProgressActivity = $Activity
        $script:MapleNextDownloadPercent = 0
      }
      if ($progressTotal -gt 0) {
        $percent = [Math]::Min(100, [Math]::Floor(($progressBytes * 100) / $progressTotal))
        if (Test-MapleProgressAvailable) {
          Write-Progress -Id $ProgressId -Activity $Activity `
            -Status "$Status - $(Format-MapleBytes $progressBytes) / $(Format-MapleBytes $progressTotal)" `
            -PercentComplete $percent
        } elseif ($percent -ge $script:MapleNextDownloadPercent) {
          Write-Host "[maple]       $Status - $percent% - $(Format-MapleBytes $progressBytes) / $(Format-MapleBytes $progressTotal)"
          do { $script:MapleNextDownloadPercent += 10 } while ($script:MapleNextDownloadPercent -le $percent)
        }
      } elseif (Test-MapleProgressAvailable) {
        Write-Progress -Id $ProgressId -Activity $Activity `
          -Status "$Status - $(Format-MapleBytes $progressBytes)" -PercentComplete -1
      }
    }
    return $downloaded
  } finally {
    if ($target) { $target.Dispose() }
    if ($source) { $source.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

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

$serverUrl = "__MAPLE_SERVER_URL__"
if (-not ($serverUrl.StartsWith("https://") -or $serverUrl.StartsWith("http://"))) {
  $serverUrl = if ($env:MAPLE_SERVER_URL) { $env:MAPLE_SERVER_URL } else { "http://127.0.0.1:45820" }
}
$serverUrl = $serverUrl.TrimEnd("/")
if (-not ($serverUrl.StartsWith("https://") -or $serverUrl.StartsWith("http://127.0.0.1") -or $serverUrl.StartsWith("http://localhost"))) {
  throw "Maple installer requires HTTPS for remote servers."
}

$userHome = [Environment]::GetFolderPath("UserProfile")
$mapleHome = if ($env:MAPLE_HOME_DIR) { [IO.Path]::GetFullPath($env:MAPLE_HOME_DIR) } else { Join-Path $userHome ".maple" }
$binDir = Join-Path $mapleHome "bin"
$runtimeDir = Join-Path $mapleHome "runtime"
$cliPath = Join-Path $binDir "maple-cli.js"
$wrapperPath = Join-Path $binDir "maple.cmd"
$appDir = Join-Path $mapleHome "local-app"
$stagingDir = Join-Path $mapleHome "local-app.installing.$PID"
$backupDir = Join-Path $mapleHome "local-app.previous.$PID"
$manifestUrl = "$serverUrl/downloads/maple-local/manifest-v2.txt"

foreach ($managedPath in @($stagingDir, $backupDir)) {
  $resolved = [IO.Path]::GetFullPath($managedPath)
  $prefix = [IO.Path]::GetFullPath($mapleHome).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Maple generated an unsafe installation path."
  }
}

$MapleInstallStage = "[1/12] preparing installation directories"
Write-Host "[maple] [1/12] Preparing installation directories..."
New-Item -ItemType Directory -Force -Path $binDir, $runtimeDir, $stagingDir | Out-Null
if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
Write-Host "[maple]       Directories ready: $mapleHome"

$MapleInstallStage = "[2/12] checking Bun runtime"
Write-Host "[maple] [2/12] Checking Bun runtime..."
$bunCommand = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCommand) {
  Write-Host "[maple]       Bun was not found; installing it now."
  Invoke-RestMethod "https://bun.sh/install.ps1" | Invoke-Expression
  $bunPath = Join-Path $userHome ".bun/bin/bun.exe"
} else {
  $bunPath = $bunCommand.Source
}
if (-not (Test-Path -LiteralPath $bunPath -PathType Leaf)) { throw "Bun installation failed." }
Write-Host "[maple]       Using Bun: $bunPath"

$MapleInstallStage = "[3/12] asking about the Playwright screenshot runtime"
Write-Host "[maple] [3/12] Asking about the Playwright screenshot runtime..."
if ($env:MAPLE_LAUNCHED_BY_UPDATER -eq "1") {
  Write-Host "[maple]       更新模式：沿用默认安装（跳过请设 MAPLE_SKIP_PLAYWRIGHT_INSTALL=1）。"
} elseif ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -eq "1") {
  Write-Host "[maple]       Playwright 已跳过（MAPLE_SKIP_PLAYWRIGHT_INSTALL=1）。"
} elseif (-not [Console]::IsInputRedirected) {
  $answer = Read-Host "[maple] 是否安装 Playwright 截图功能（可选截图验收用）？[Y/n]"
  if ($answer -match '^(n|no)$') {
    Write-Host "[maple]       Playwright 已跳过。"
    $env:MAPLE_SKIP_PLAYWRIGHT_INSTALL = "1"
  } else {
    Write-Host "[maple]       将安装 Playwright（截图验收用）。"
  }
} else {
  Write-Host "[maple]       非交互安装：默认安装 Playwright（跳过请设 MAPLE_SKIP_PLAYWRIGHT_INSTALL=1）。"
}

$MapleInstallStage = "[4/12] downloading the Maple CLI"
Write-Host "[maple] [4/12] Downloading the Maple CLI..."
$temporaryCli = "$cliPath.download"
Invoke-MapleDownload -Uri "$serverUrl/downloads/maple-cli.js" -Destination $temporaryCli `
  -Activity "Downloading Maple CLI" -Status "CLI" | Out-Null
Write-Progress -Id 1 -Activity "Downloading Maple CLI" -Completed
if ((Get-Item -LiteralPath $temporaryCli).Length -lt 10000) { throw "Downloaded CLI is incomplete." }
Move-Item -Force -LiteralPath $temporaryCli -Destination $cliPath
Write-Host "[maple]       CLI downloaded and validated."

$MapleInstallStage = "[5/12] configuring the maple command and user PATH"
Write-Host "[maple] [5/12] Configuring the maple command and user PATH..."
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$wrapper = "@echo off`r`n`"$bunPath`" `"%~dp0maple-cli.js`" %*`r`n"
[System.IO.File]::WriteAllText($wrapperPath, $wrapper, $utf8NoBom)

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntries = @($userPath -split ";" | Where-Object { $_ })
if (-not ($pathEntries | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") })) {
  [Environment]::SetEnvironmentVariable("Path", (($pathEntries + $binDir) -join ";"), "User")
}
$env:Path = "$binDir;$env:Path"
Write-Host "[maple]       Command ready: $wrapperPath"

# Starting the CLI once creates the managed MCP config under ~/.maple/runtime.
$MapleInstallStage = "[6/12] initializing and verifying the CLI runtime"
Write-Host "[maple] [6/12] Initializing and verifying the CLI runtime..."
& $bunPath $cliPath status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Maple CLI verification failed." }
Write-Host "[maple]       CLI runtime verified."

$MapleInstallStage = "[7/12] downloading the local service payload"
Write-Host "[maple] [7/12] Downloading the local service payload (Server + WebUI + CLI)..."
$manifestPath = Join-Path $stagingDir ".manifest"
Invoke-MapleDownload -Uri $manifestUrl -Destination $manifestPath `
  -Activity "Preparing Maple Local download" -Status "Reading payload manifest" | Out-Null
Write-Progress -Id 1 -Activity "Preparing Maple Local download" -Completed
$entries = @()
$totalBytes = 0L
foreach ($manifestLine in Get-Content -LiteralPath $manifestPath -Encoding UTF8) {
  if ([string]::IsNullOrWhiteSpace($manifestLine)) { continue }
  $parts = $manifestLine -split "`t", 2
  if ($parts.Count -ne 2 -or $parts[0] -notmatch '^\d+$') {
    throw "The Maple download manifest contains an invalid size entry."
  }
  $fileSize = [Convert]::ToInt64($parts[0], [Globalization.CultureInfo]::InvariantCulture)
  $relativePath = $parts[1]
  if ($relativePath.StartsWith("/") -or $relativePath.Contains("..") -or $relativePath.Contains("\")) {
    throw "The Maple download manifest contains an invalid path."
  }
  $component = if ($relativePath -eq "maple-local.js") {
    "Server + CUI"
  } elseif ($relativePath.StartsWith("web/")) {
    "WebUI"
  } else {
    "Runtime"
  }
  $entries += [PSCustomObject]@{ Path = $relativePath; Size = $fileSize; Component = $component }
  $totalBytes += $fileSize
}
if ($entries.Count -eq 0 -or $totalBytes -le 0) { throw "The Maple download manifest is empty." }
Write-Host "[maple]       Payload: $($entries.Count) files, $(Format-MapleBytes $totalBytes)."
$completedBytes = 0L
$entryIndex = 0
$activeComponent = ""
try {
  foreach ($entry in $entries) {
    $entryIndex++
    $relativePath = $entry.Path
    $fileSize = [long]$entry.Size
    if ($entry.Component -ne $activeComponent) {
      if ($activeComponent) { Write-Host "[maple]       $activeComponent downloaded." }
      $activeComponent = $entry.Component
      Write-Host "[maple]       Downloading $activeComponent..."
    }
    $MapleInstallStage = "[7/12] downloading $($entry.Component) ($entryIndex/$($entries.Count)): $relativePath"
    $targetPath = Join-Path $stagingDir $relativePath.Replace("/", [IO.Path]::DirectorySeparatorChar)
    $targetDirectory = Split-Path -Parent $targetPath
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
    $downloadedBytes = Invoke-MapleDownload `
      -Uri "$serverUrl/downloads/maple-local/$relativePath" `
      -Destination $targetPath `
      -Activity "Downloading Maple Local" `
      -Status "$($entry.Component) - $entryIndex/$($entries.Count)" `
      -CompletedBytes $completedBytes `
      -TotalBytes $totalBytes
    if ($downloadedBytes -ne $fileSize) { throw "Downloaded payload size mismatch: $relativePath" }
    $completedBytes += $fileSize
  }
  if ($activeComponent) { Write-Host "[maple]       $activeComponent downloaded." }
} finally {
  Write-Progress -Id 1 -Activity "Downloading Maple Local" -Completed
}
Remove-Item -LiteralPath $manifestPath -Force
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
Write-Host "[maple]       Server, WebUI and CLI downloaded and validated."

$MapleInstallStage = "[8/12] verifying the downloaded local service"
Write-Host "[maple] [8/12] Verifying the downloaded local service..."
$localEntry = Join-Path $stagingDir "maple-local.js"
$dashboardEntry = Join-Path $stagingDir "web/index.html"
if (-not (Test-Path -LiteralPath $localEntry -PathType Leaf)) { throw "CLI payload is incomplete." }
if (-not (Test-Path -LiteralPath $dashboardEntry -PathType Leaf)) { throw "WebUI payload is incomplete." }
& $bunPath $localEntry help | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Maple Local verification failed." }
Write-Host "[maple]       Downloaded version verified."

$MapleInstallStage = "[9/12] publishing the local service"
Write-Host "[maple] [9/12] Publishing the local service..."
if (Test-Path -LiteralPath $appDir) {
  try { Move-MapleDirectory -Source $appDir -Destination $backupDir }
  catch { throw "Close Maple Local before updating, then try again." }
}
try {
  Move-MapleDirectory -Source $stagingDir -Destination $appDir
} catch {
  if (Test-Path -LiteralPath $backupDir) { Move-MapleDirectory -Source $backupDir -Destination $appDir }
  throw
}
if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
Write-Host "[maple]       Version published to $appDir"

$MapleInstallStage = "[10/12] configuring the maple-local command and user PATH"
Write-Host "[maple] [10/12] Configuring the maple-local command and user PATH..."
$localWrapperPath = Join-Path $binDir "maple-local.cmd"
$localUpdaterPath = Join-Path $binDir "maple-local-update.ps1"
$writeLaunchers = $env:MAPLE_LAUNCHED_BY_UPDATER -ne "1" -or -not (Test-Path -LiteralPath $localWrapperPath -PathType Leaf) -or -not (Test-Path -LiteralPath $localUpdaterPath -PathType Leaf)
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
Invoke-RestMethod "$serverUrl/install.ps1" | Invoke-Expression
'@
  [IO.File]::WriteAllText($localUpdaterPath, $updater + "`r`n", $utf8NoBom)

  $localWrapper = "@echo off`r`nif /I `"%~1`"==`"update`" (`r`n  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$localUpdaterPath`"`r`n  exit /b %ERRORLEVEL%`r`n)`r`n`"$bunPath`" `"$appDir\maple-local.js`" %*`r`n"
  [IO.File]::WriteAllText($localWrapperPath, $localWrapper, $utf8NoBom)
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntries = @($userPath -split ";" | Where-Object { $_ })
if (-not ($pathEntries | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") })) {
  [Environment]::SetEnvironmentVariable("Path", (($pathEntries + $binDir) -join ";"), "User")
}
$env:Path = "$binDir;$env:Path"
Write-Host "[maple]       Command ready: $localWrapperPath"
Write-Host "[maple]       Update later: maple-local update"

$MapleInstallStage = "[11/12] preparing the Playwright screenshot runtime"
Write-Host "[maple] [11/12] Preparing the Playwright screenshot runtime..."
if ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -ne "1") {
  $playwrightDir = Join-Path $runtimeDir "playwright"
  New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null
  if (-not (Test-Path (Join-Path $playwrightDir "package.json"))) {
    [System.IO.File]::WriteAllText((Join-Path $playwrightDir "package.json"), '{"name":"maple-playwright-runtime","private":true}' + "`n", $utf8NoBom)
  }
  $MapleInstallStage = "[11/12] installing the Playwright package"
  Write-Host "[maple]       Installing Playwright package..."
  Push-Location $playwrightDir
  try { & $bunPath add --exact "playwright@1.61.1" } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Playwright package installation failed." }
  $MapleInstallStage = "[11/12] installing the Chromium browser"
  Write-Host "[maple]       Installing Chromium browser..."
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $playwrightDir "browsers"
  & $bunPath (Join-Path $playwrightDir "node_modules/playwright/cli.js") install chromium --only-shell
  if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed." }
  $playwrightWrapper = "@echo off`r`nset `"PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers`"`r`n`"$bunPath`" `"%~dp0node_modules\playwright\cli.js`" %*`r`n"
  [System.IO.File]::WriteAllText((Join-Path $playwrightDir "maple-playwright.cmd"), $playwrightWrapper, $utf8NoBom)
  Write-Host "[maple]       Playwright and Chromium are ready."
} else {
  Write-Host "[maple]       Skipped by MAPLE_SKIP_PLAYWRIGHT_INSTALL=1."
}

$MapleInstallStage = "[12/12] completing installation"
Write-Host "[maple] [12/12] Installation complete."
Write-Host "[maple] Installed in $mapleHome"
Write-Host "[maple] Connect with: maple connect --server $serverUrl"
Write-Host "[maple] Run local service with: maple-local"
