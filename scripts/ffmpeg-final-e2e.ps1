$ErrorActionPreference = 'Stop'
$root = 'D:\ffmpeg-e2e'
$ffmpeg = 'D:\Downloads\ffmpeg\bin\ffmpeg.exe'
New-Item -ItemType Directory -Force $root | Out-Null
$input = Join-Path $root 'input.mp4'
$fixture = Start-Process -FilePath $ffmpeg -ArgumentList @('-y','-f','lavfi','-i','color=c=blue:s=320x180:r=12','-t','2','-pix_fmt','yuv420p',$input) -Wait -PassThru -NoNewWindow
if ($fixture.ExitCode -ne 0) { throw "FFMPEG_FIXTURE_CREATE_FAILED:$($fixture.ExitCode)" }
if (-not (Test-Path -LiteralPath $input)) { throw 'FFMPEG_FIXTURE_CREATE_FAILED' }
$env:ELECTRON_RUN_AS_NODE = '1'; $env:AIONUI_MEDIA_PORT = '33004'; $env:AIONUI_DATA_DIR = $root
$out = Join-Path $root 'service.out.log'; $err = Join-Path $root 'service.err.log'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$electron = Join-Path $repoRoot 'out\win-unpacked\AionUi.exe'
$serviceScript = Join-Path $repoRoot 'out\main\media-service.js'
$p = Start-Process -FilePath $electron -ArgumentList @($serviceScript) -WorkingDirectory $root -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
try {
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 250; try { if ((Invoke-RestMethod 'http://127.0.0.1:33004/health').status -eq 'ok') { break } } catch { if ($i -eq 29) { throw } } }
  $frame = Join-Path $root 'frame.png'; $transcoded = Join-Path $root 'transcoded.mp4'
  foreach ($spec in @(@{kind='extract-frame';sourcePath=$input;outputPath=$frame;startSeconds=0.5}, @{kind='transcode';sourcePath=$input;outputPath=$transcoded;videoCodec='libx264';audioCodec='aac'})) {
    $job = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:33004/api/media-jobs' -ContentType 'application/json' -Body ($spec | ConvertTo-Json)
    do { Start-Sleep -Milliseconds 250; $final = Invoke-RestMethod "http://127.0.0.1:33004/api/media-jobs/$($job.id)" } while ($final.status -notin @('succeeded','failed','cancelled'))
    if ($final.status -ne 'succeeded') { throw ($final | ConvertTo-Json -Compress) }
  }
  [pscustomobject]@{ frameExists = Test-Path $frame; frameBytes = (Get-Item $frame).Length; transcodeExists = Test-Path $transcoded; transcodeBytes = (Get-Item $transcoded).Length } | ConvertTo-Json -Compress
} finally { if ($p -and !$p.HasExited) { Stop-Process -Id $p.Id -Force } }
