param(
  [string]$PackageRoot = 'D:\视频Agent\deploy\portable-test',
  [string]$DataRoot = 'D:\视频Agent\deploy\portable-test-data\package-h3-e2e',
  [string]$BundleRoot = 'D:\视频Agent\.runtime\h3-offline-bundle',
  [int]$Port = 33003,
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PackageRoot 'resources\app.asar.unpacked\out\main\media-service.js'
$electronPath = Join-Path $PackageRoot 'AionUi.exe'
$logPath = Join-Path $DataRoot 'media-service.out.log'
$errorLogPath = Join-Path $DataRoot 'media-service.err.log'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "MEDIA_SERVICE_SCRIPT_NOT_FOUND: $scriptPath" }
if (-not (Test-Path -LiteralPath $electronPath)) { throw "ELECTRON_EXECUTABLE_NOT_FOUND: $electronPath" }
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

$env:ELECTRON_RUN_AS_NODE = '1'
$env:AIONUI_MEDIA_PORT = [string]$Port
$env:AIONUI_DATA_DIR = $DataRoot
$env:AIONUI_H3_BUNDLE_ROOT = $BundleRoot
$service = Start-Process -FilePath $electronPath -ArgumentList @($scriptPath) -WorkingDirectory $DataRoot -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath -PassThru
$resultPath = Join-Path $DataRoot 'result.json'
try {
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2).status -eq 'ok') { $healthy = $true; break } } catch { }
  }
  if (-not $healthy) { throw 'MEDIA_SERVICE_START_TIMEOUT' }
  $job = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/h3/jobs" -ContentType 'application/json' -Body (@{ prompt = 'A quiet mountain lake at sunrise'; durationSeconds = 4; megapixels = 0.2; seed = 7 } | ConvertTo-Json)
  $final = $null
  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    Start-Sleep -Seconds 1
    $final = Invoke-RestMethod "http://127.0.0.1:$Port/api/h3/jobs/$($job.id)"
    if ($final.status -in @('succeeded', 'failed', 'cancelled')) { break }
  }
  if (-not $final -or $final.status -notin @('succeeded', 'failed', 'cancelled')) { throw 'H3_PACKAGE_E2E_TIMEOUT' }
  [pscustomobject]@{ job = $final; stdout = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue; stderr = Get-Content -LiteralPath $errorLogPath -Raw -ErrorAction SilentlyContinue } | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
  [pscustomobject]@{ error = $_.Exception.Message; stdout = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue; stderr = Get-Content -LiteralPath $errorLogPath -Raw -ErrorAction SilentlyContinue } | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8
} finally {
  if ($service -and -not $service.HasExited) { & taskkill.exe /PID $service.Id /T /F | Out-Null }
}
