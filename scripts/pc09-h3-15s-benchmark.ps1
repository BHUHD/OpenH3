param([int]$Port = 33006)
$ErrorActionPreference = 'Stop'
$PackageRoot = 'D:\视频Agent\deploy\portable-test'
$DataRoot = 'D:\h3-15s-e2e'
$BundleRoot = 'D:\视频Agent\.runtime\h3-offline-bundle'
New-Item -ItemType Directory -Force $DataRoot | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'; $env:AIONUI_MEDIA_PORT = [string]$Port; $env:AIONUI_DATA_DIR = $DataRoot; $env:AIONUI_H3_BUNDLE_ROOT = $BundleRoot
$scriptPath = Join-Path $PackageRoot 'resources\app.asar.unpacked\out\main\media-service.js'
$electronPath = Join-Path $PackageRoot 'AionUi.exe'
$out = Join-Path $DataRoot 'service.out.log'; $err = Join-Path $DataRoot 'service.err.log'
$service = Start-Process -FilePath $electronPath -ArgumentList @($scriptPath) -WorkingDirectory $DataRoot -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
$total = [Diagnostics.Stopwatch]::StartNew()
try {
  for ($i=0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 250; try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health").status -eq 'ok') { break } } catch { if ($i -eq 59) { throw } } }
  $submit = [Diagnostics.Stopwatch]::StartNew()
  $job = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/h3/jobs" -ContentType 'application/json' -Body (@{prompt='A cinematic aerial shot of a calm ocean at sunrise, gentle waves and warm natural light';durationSeconds=15;megapixels=0.9216;seed=2026}|ConvertTo-Json)
  $submit.Stop(); $final=$null
  do { Start-Sleep -Seconds 1; $final=Invoke-RestMethod "http://127.0.0.1:$Port/api/h3/jobs/$($job.id)" } while ($final.status -notin @('succeeded','failed','cancelled'))
  $total.Stop()
  $artifact = $final.artifacts[0]
  $videoPath = Join-Path $BundleRoot ('runtime\ComfyUI_windows_portable\ComfyUI\output\' + $artifact.subfolder + '\' + $artifact.filename)
  $probe = & 'D:\Downloads\ffmpeg\bin\ffprobe.exe' -v error -show_entries stream=width,height,r_frame_rate,duration -of json $videoPath 2>$null | ConvertFrom-Json
  [pscustomobject]@{jobId=$final.id;status=$final.status;progress=$final.progress;submitMs=$submit.ElapsedMilliseconds;totalMs=$total.ElapsedMilliseconds;artifact=$artifact.filename;sizeBytes=(Get-Item $videoPath).Length;streams=$probe.streams}|ConvertTo-Json -Depth 8 -Compress
} finally { if ($service -and !$service.HasExited) { & taskkill.exe /PID $service.Id /T /F | Out-Null } }
