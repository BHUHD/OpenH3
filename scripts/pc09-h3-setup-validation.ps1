param([string]$Root = 'D:\h3-setup-validation', [int]$Port = 33012)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$bundle = 'D:\视频Agent\.runtime\h3-offline-bundle'
$electron = 'D:\视频Agent\deploy\portable-test\AionUi.exe'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:NODE_PATH = Join-Path (Split-Path $electron) 'resources\app.asar.unpacked\node_modules'
$env:AIONUI_MEDIA_PORT = [string]$Port
$env:AIONUI_DATA_DIR = Join-Path $Root 'data'
$env:AIONUI_H3_BUNDLE_ROOT = $bundle
$env:AIONUI_H3_URL = 'http://127.0.0.1:8188'
$env:AIONUI_H3_ACCEL_MODE = 'dense'
$service = $null
$base = "http://127.0.0.1:$Port"
try {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $service = Start-Process -FilePath $electron -ArgumentList @((Join-Path $Root 'media-service.js')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Root 'stdout.log') -RedirectStandardError (Join-Path $Root 'stderr.log')
  $healthy = $false
  for ($i=0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try { if ((Invoke-RestMethod "$base/health" -TimeoutSec 2).status -eq 'ok') { $healthy=$true; break } } catch {}
  }
  if (-not $healthy) { throw 'SERVICE_NOT_READY' }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $start = Invoke-RestMethod -Method Post "$base/api/h3/setup/start" -ContentType 'application/json' -Body '{}' -TimeoutSec 180
  $startupSeconds = $watch.Elapsed.TotalSeconds
  $capabilities = Invoke-RestMethod "$base/api/h3/setup/capabilities" -TimeoutSec 30
  if (-not $capabilities.nodesAvailable -or -not $capabilities.modelsAvailable) { throw ($capabilities | ConvertTo-Json -Depth 8 -Compress) }
  $watch.Restart()
  $job = Invoke-RestMethod -Method Post "$base/api/h3/jobs" -ContentType 'application/json' -Body '{"prompt":"A quiet mountain lake at sunrise, gentle camera movement, natural ambient sound.","durationSeconds":4,"megapixels":0.2,"seed":42,"mode":"t2v","references":[]}' -TimeoutSec 15
  for ($i=0; $i -lt 600; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod "$base/api/h3/jobs/$($job.id)" -TimeoutSec 10
    if ($job.status -in @('succeeded','failed','cancelled')) { break }
  }
  $generationSeconds = $watch.Elapsed.TotalSeconds
  if ($job.status -ne 'succeeded' -or -not $job.artifacts.Count) { throw ($job | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-WebRequest "$base$($job.artifacts[0].resourcePath)" -OutFile (Join-Path $Root 'smoke.mp4') -TimeoutSec 60 -UseBasicParsing
  @{ startupSeconds=$startupSeconds; generationSeconds=$generationSeconds; start=$start; capabilities=$capabilities; job=$job; artifactBytes=(Get-Item (Join-Path $Root 'smoke.mp4')).Length } | ConvertTo-Json -Depth 15 | Set-Content (Join-Path $Root 'result.json') -Encoding UTF8
  Get-Content (Join-Path $Root 'result.json') -Raw
} finally {
  if ($service -and -not $service.HasExited) { & taskkill.exe /PID $service.Id /T /F | Out-Null }
}
