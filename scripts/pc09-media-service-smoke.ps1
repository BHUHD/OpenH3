param(
  [string]$PackageRoot = 'D:\视频Agent\deploy\portable-test',
  [string]$DataRoot = 'D:\视频Agent\deploy\portable-test-data\media-direct',
  [string]$BundleRoot = 'D:\视频Agent\.runtime\h3-offline-bundle',
  [int]$Port = 33002
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PackageRoot 'resources\app.asar.unpacked\out\main\media-service.js'
$electronPath = Join-Path $PackageRoot 'AionUi.exe'
$logRoot = Split-Path $DataRoot -Parent
$stdoutPath = Join-Path $logRoot 'media-direct.out.log'
$stderrPath = Join-Path $logRoot 'media-direct.err.log'

if (-not (Test-Path -LiteralPath $scriptPath)) { throw "MEDIA_SERVICE_SCRIPT_NOT_FOUND: $scriptPath" }
if (-not (Test-Path -LiteralPath $electronPath)) { throw "ELECTRON_EXECUTABLE_NOT_FOUND: $electronPath" }
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

$env:AIONUI_MEDIA_PORT = [string]$Port
$env:AIONUI_DATA_DIR = $DataRoot
$env:AIONUI_H3_BUNDLE_ROOT = $BundleRoot
$env:ELECTRON_RUN_AS_NODE = '1'
$process = Start-Process -FilePath $electronPath -ArgumentList @($scriptPath) -WorkingDirectory $DataRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
try {
  $healthy = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
  }
  if (-not $healthy) { throw 'MEDIA_SERVICE_START_TIMEOUT' }
  if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $status = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/h3/status" -TimeoutSec 15 -SkipHttpErrorCheck
    $statusBody = $status.Content
  } else {
    try {
      $status = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/h3/status" -TimeoutSec 15
      $statusBody = $status.Content
    } catch [System.Net.WebException] {
      if (-not $_.Exception.Response) { throw }
      $errorResponse = $_.Exception.Response
      $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
      try { $statusBody = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
  }
  [pscustomobject]@{
    pid = $process.Id
    health = $response.Content | ConvertFrom-Json
    h3Status = $statusBody | ConvertFrom-Json
    stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
    stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
