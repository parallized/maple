[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$MapleInstallStage = "reading installer configuration"
trap {
  try { Write-Progress -Id 1 -Activity "Installing Maple" -Completed } catch {}
  [Console]::Error.WriteLine("[maple] Installation failed during $MapleInstallStage.")
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
        if ($response.ContentLength -gt 0) {
          $percent = [Math]::Min(100, [Math]::Floor(($downloaded * 100) / $response.ContentLength))
          Write-Progress -Id $ProgressId -Activity $Activity `
            -Status "$Status - $(Format-MapleBytes $downloaded) / $(Format-MapleBytes $response.ContentLength)" `
            -PercentComplete $percent
        } else {
          Write-Progress -Id $ProgressId -Activity $Activity `
            -Status "$Status - $(Format-MapleBytes $downloaded)" -PercentComplete -1
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
  throw "Maple installer requires HTTPS for remote servers."
}

$userHome = [Environment]::GetFolderPath("UserProfile")
$mapleHome = Join-Path $userHome ".maple"
$binDir = Join-Path $mapleHome "bin"
$runtimeDir = Join-Path $mapleHome "runtime"
$cliPath = Join-Path $binDir "maple-cli.js"
$wrapperPath = Join-Path $binDir "maple.cmd"
$MapleInstallStage = "[1/7] preparing installation directories"
Write-Host "[maple] [1/7] Preparing installation directories..."
New-Item -ItemType Directory -Force -Path $binDir, $runtimeDir | Out-Null
Write-Host "[maple]       Directories ready: $mapleHome"

$MapleInstallStage = "[2/7] checking Bun runtime"
Write-Host "[maple] [2/7] Checking Bun runtime..."
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

$MapleInstallStage = "[3/7] downloading CUI"
Write-Host "[maple] [3/7] Downloading CUI..."
$temporaryCli = "$cliPath.download"
Invoke-MapleDownload -Uri "$serverUrl/downloads/maple-cli.js" -Destination $temporaryCli `
  -Activity "Downloading Maple CLI" -Status "CUI" | Out-Null
Write-Progress -Id 1 -Activity "Downloading Maple CLI" -Completed
if ((Get-Item -LiteralPath $temporaryCli).Length -lt 10000) { throw "Downloaded CLI is incomplete." }
Move-Item -Force -LiteralPath $temporaryCli -Destination $cliPath
Write-Host "[maple]       CUI downloaded and validated."

$MapleInstallStage = "[4/7] configuring the maple command and user PATH"
Write-Host "[maple] [4/7] Configuring the maple command and user PATH..."
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
$MapleInstallStage = "[5/7] initializing and verifying the CUI runtime"
Write-Host "[maple] [5/7] Initializing and verifying the CUI runtime..."
& $bunPath $cliPath status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Maple CLI verification failed." }
Write-Host "[maple]       CUI runtime verified."

$MapleInstallStage = "[6/7] preparing Playwright screenshot runtime"
Write-Host "[maple] [6/7] Preparing Playwright screenshot runtime..."
if ($env:MAPLE_SKIP_PLAYWRIGHT_INSTALL -ne "1") {
  $playwrightDir = Join-Path $runtimeDir "playwright"
  New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null
  if (-not (Test-Path (Join-Path $playwrightDir "package.json"))) {
    [System.IO.File]::WriteAllText((Join-Path $playwrightDir "package.json"), '{"name":"maple-playwright-runtime","private":true}' + "`n", $utf8NoBom)
  }
  $MapleInstallStage = "[6/7] installing the Playwright package"
  Write-Host "[maple]       Installing Playwright package..."
  Push-Location $playwrightDir
  try { & $bunPath add --exact "playwright@1.61.1" } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Playwright package installation failed." }
  $MapleInstallStage = "[6/7] installing the Chromium browser"
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

$MapleInstallStage = "[7/7] completing installation"
Write-Host "[maple] [7/7] Installation complete."
Write-Host "[maple] Installed in $mapleHome"
Write-Host "[maple] Connect with: maple connect --server $serverUrl"
