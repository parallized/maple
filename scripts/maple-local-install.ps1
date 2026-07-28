[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$MapleInstallStage = "reading installer configuration"
trap {
  try { Write-Progress -Id 1 -Activity "Installing Maple Local" -Completed } catch {}
  [Console]::Error.WriteLine("[maple-local] Installation failed during $MapleInstallStage.")
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
      if (Test-MapleProgressAvailable) {
        $progressBytes = if ($TotalBytes -gt 0) { $CompletedBytes + $downloaded } else { $downloaded }
        $progressTotal = if ($TotalBytes -gt 0) { $TotalBytes } else { $response.ContentLength }
        if ($progressTotal -gt 0) {
          $percent = [Math]::Min(100, [Math]::Floor(($progressBytes * 100) / $progressTotal))
          Write-Progress -Id $ProgressId -Activity $Activity `
            -Status "$Status - $(Format-MapleBytes $progressBytes) / $(Format-MapleBytes $progressTotal)" `
            -PercentComplete $percent
        } else {
          Write-Progress -Id $ProgressId -Activity $Activity `
            -Status "$Status - $(Format-MapleBytes $progressBytes)" -PercentComplete -1
        }
      }
    }
    return $downloaded
  } finally {
    if ($target) { $target.Dispose() }
    if ($source) { $source.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

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
$manifestUrl = "$serverUrl/downloads/maple-local/manifest-v2.txt"
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

$MapleInstallStage = "[1/9] preparing a safe staging directory"
Write-Host "[maple-local] [1/9] Preparing a safe staging directory..."
if (Test-Path -LiteralPath $stagingDir) { Remove-Item -LiteralPath $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $binDir, $runtimeDir, $stagingDir | Out-Null
if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
Write-Host "[maple-local]       Staging directory ready: $stagingDir"

try {
  $MapleInstallStage = "[2/9] checking Bun runtime"
  Write-Host "[maple-local] [2/9] Checking Bun runtime..."
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    Write-Host "[maple-local]       Bun was not found; installing it now."
    Invoke-RestMethod "https://bun.sh/install.ps1" | Invoke-Expression
    $bunPath = Join-Path $userHome ".bun/bin/bun.exe"
  } else {
    $bunPath = $bunCommand.Source
  }
  if (-not (Test-Path -LiteralPath $bunPath -PathType Leaf)) { throw "Bun installation failed." }
  Write-Host "[maple-local]       Using Bun: $bunPath"

  $MapleInstallStage = "[3/9] reading the Server, WebUI and CUI download manifest"
  Write-Host "[maple-local] [3/9] Downloading Server, WebUI and CUI..."
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
      throw "The Maple Local download manifest contains an invalid size entry."
    }
    $fileSize = [Convert]::ToInt64($parts[0], [Globalization.CultureInfo]::InvariantCulture)
    $relativePath = $parts[1]
    if ($relativePath.StartsWith("/") -or $relativePath.Contains("..") -or $relativePath.Contains("\")) {
      throw "The Maple Local download manifest contains an invalid path."
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
  if ($entries.Count -eq 0 -or $totalBytes -le 0) { throw "The Maple Local download manifest is empty." }
  Write-Host "[maple-local]       Payload: $($entries.Count) files, $(Format-MapleBytes $totalBytes)."
  $completedBytes = 0L
  $entryIndex = 0
  $activeComponent = ""
  try {
    foreach ($entry in $entries) {
      $entryIndex++
      $relativePath = $entry.Path
      $fileSize = [long]$entry.Size
      if ($entry.Component -ne $activeComponent) {
        if ($activeComponent) { Write-Host "[maple-local]       $activeComponent downloaded." }
        $activeComponent = $entry.Component
        Write-Host "[maple-local]       Downloading $activeComponent..."
      }
      $MapleInstallStage = "[3/9] downloading $($entry.Component) ($entryIndex/$($entries.Count)): $relativePath"
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
    if ($activeComponent) { Write-Host "[maple-local]       $activeComponent downloaded." }
  } finally {
    Write-Progress -Id 1 -Activity "Downloading Maple Local" -Completed
  }
  Remove-Item -LiteralPath $manifestPath -Force
  Write-Host "[maple-local]       Server, WebUI and CUI downloaded and validated."

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
  $MapleInstallStage = "[4/9] installing the platform image runtime"
  Write-Host "[maple-local] [4/9] Installing the platform image runtime..."
  Push-Location $stagingDir
  try { & $bunPath add --exact "sharp@0.35.3" } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Sharp runtime installation failed." }
  Write-Host "[maple-local]       Platform image runtime installed."

  $MapleInstallStage = "[5/9] verifying the downloaded version"
  Write-Host "[maple-local] [5/9] Verifying the downloaded version..."
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
  Write-Host "[maple-local]       Downloaded version verified."

  $MapleInstallStage = "[6/9] publishing the downloaded version"
  Write-Host "[maple-local] [6/9] Publishing the downloaded version..."
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
  Write-Host "[maple-local]       Version published to $appDir"

  $MapleInstallStage = "[7/9] configuring commands and user PATH"
  Write-Host "[maple-local] [7/9] Configuring commands and user PATH..."
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
  Write-Host "[maple-local]       Command ready: $wrapperPath"

  $MapleInstallStage = "[8/9] preparing Playwright screenshot runtime"
  Write-Host "[maple-local] [8/9] Preparing Playwright screenshot runtime..."
  if ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -ne "1") {
    $playwrightDir = Join-Path $runtimeDir "playwright"
    New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $playwrightDir "package.json"))) {
      [IO.File]::WriteAllText(
        (Join-Path $playwrightDir "package.json"),
        '{"name":"maple-playwright-runtime","private":true}' + "`n",
        $utf8NoBom
      )
    }
    $MapleInstallStage = "[8/9] installing the Playwright package"
    Write-Host "[maple-local]       Installing Playwright package..."
    Push-Location $playwrightDir
    try { & $bunPath add --exact "playwright@1.61.1" } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "Playwright package installation failed." }
    $MapleInstallStage = "[8/9] installing the Chromium browser"
    Write-Host "[maple-local]       Installing Chromium browser..."
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $playwrightDir "browsers"
    & $bunPath (Join-Path $playwrightDir "node_modules/playwright/cli.js") install chromium --only-shell
    if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed." }
    Write-Host "[maple-local]       Playwright and Chromium are ready."
  } else {
    Write-Host "[maple-local]       Skipped by MAPLE_SKIP_PLAYWRIGHT_INSTALL=1."
  }

  $MapleInstallStage = "[9/9] completing installation"
  Write-Host "[maple-local] [9/9] Installation complete."
  Write-Host "[maple-local] Installed in $appDir"
  Write-Host "[maple-local] Run: maple-local"
  Write-Host "[maple-local] Update later: maple-local update"
} finally {
  if (-not $published -and (Test-Path -LiteralPath $stagingDir)) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }
}
