param([string]$PackageRootOverride, [string]$DataRootOverride, [string]$BundleRootOverride, [int]$PortOverride = 0, [string]$ImagePathOverride)
$ErrorActionPreference = 'Stop'
$PackageRoot = 'D:\视频Agent\deploy\portable-test'
$DataRoot = 'D:\视频Agent\deploy\portable-test-data\reference-e2e'
$BundleRoot = 'D:\视频Agent\.runtime\h3-offline-bundle'
$ImagePath = Join-Path $BundleRoot 'runtime\ComfyUI_windows_portable\ComfyUI\input\example.png'
$Port = 33005
if ($PackageRootOverride) { $PackageRoot = $PackageRootOverride }
if ($DataRootOverride) { $DataRoot = $DataRootOverride }
if ($BundleRootOverride) { $BundleRoot = $BundleRootOverride }
if ($PortOverride -gt 0) { $Port = $PortOverride }
if ($ImagePathOverride) { $ImagePath = $ImagePathOverride }
$scriptPath = Join-Path $PackageRoot 'resources\app.asar.unpacked\out\main\media-service.js'
$electronPath = Join-Path $PackageRoot 'AionUi.exe'
New-Item -ItemType Directory -Force $DataRoot | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'; $env:AIONUI_MEDIA_PORT = [string]$Port; $env:AIONUI_DATA_DIR = $DataRoot; $env:AIONUI_H3_BUNDLE_ROOT = $BundleRoot
$out = Join-Path $DataRoot 'service.out.log'; $err = Join-Path $DataRoot 'service.err.log'
$service = Start-Process -FilePath $electronPath -ArgumentList @($scriptPath) -WorkingDirectory $DataRoot -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
try {
  for ($i=0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health").status -eq 'ok') { break } } catch { if ($i -eq 39) { throw } } }
  $body = @{ prompt='A person walking beside a quiet mountain lake at sunrise; preserve the composition and identity from Picture 1'; durationSeconds=4; megapixels=0.2; seed=11; referenceImagePath=$ImagePath } | ConvertTo-Json
  $job = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/h3/jobs" -ContentType 'application/json' -Body $body
  do { Start-Sleep -Seconds 1; $final = Invoke-RestMethod "http://127.0.0.1:$Port/api/h3/jobs/$($job.id)" } while ($final.status -notin @('succeeded','failed','cancelled'))
  [pscustomobject]@{ job=$final; versions=(Invoke-RestMethod "http://127.0.0.1:$Port/api/h3/versions"); stdout=Get-Content $out -Raw -ErrorAction SilentlyContinue; stderr=Get-Content $err -Raw -ErrorAction SilentlyContinue } | ConvertTo-Json -Depth 12 -Compress
} finally { if ($service -and !$service.HasExited) { & taskkill.exe /PID $service.Id /T /F | Out-Null } }
