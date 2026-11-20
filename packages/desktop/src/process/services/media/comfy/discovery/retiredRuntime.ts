import fs from 'node:fs';
import path from 'node:path';
import { runComfyCommand, type ComfyCommandRunner } from './environment';

// CIM omits ExecutablePath for elevated processes seen by a normal desktop user.
// QueryFullProcessImageName requires only a limited query handle. An inaccessible
// candidate or failed enumeration is inconclusive, never evidence that Python exited.
const PYTHON_PROCESSES = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Text;
using System.Runtime.InteropServices;
public static class ProcessImage {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder path, ref uint length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static string Read(uint pid) {
    var handle = OpenProcess(0x1000, false, pid);
    if (handle == IntPtr.Zero) throw new Win32Exception();
    try {
      uint length = 32768;
      var path = new StringBuilder((int)length);
      if (!QueryFullProcessImageName(handle, 0, path, ref length)) throw new Win32Exception();
      return path.ToString();
    } finally { CloseHandle(handle); }
  }
}
'@
$images = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'python%.exe'" | ForEach-Object {
  $image = [ProcessImage]::Read($_.ProcessId)
  if ([IO.Path]::GetFileName($image) -ne $_.Name) { throw 'Process identity changed' }
  $image
})
ConvertTo-Json -InputObject $images -Compress
`;

/** Check the previous local Comfy interpreter after a refused initial connection or cleanup. */
export async function retiredComfyInterpreter(
  baseUrl: string,
  interpreter: string,
  error: unknown,
  run: ComfyCommandRunner = runComfyCommand
): Promise<boolean> {
  if (
    process.platform !== 'win32' ||
    !path.win32.isAbsolute(interpreter) ||
    !/^pythonw?(?:\d+(?:\.\d+)*)?\.exe$/i.test(path.win32.basename(interpreter))
  )
    return false;
  try {
    const url = new URL(baseUrl);
    const host = url.hostname === '[::1]' ? '::1' : url.hostname;
    const cause = (error as { cause?: NodeJS.ErrnoException & { address?: string; port?: number } })?.cause;
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '::1'].includes(host) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      cause?.code !== 'ECONNREFUSED' ||
      cause.syscall !== 'connect' ||
      cause.address !== host ||
      cause.port !== Number(url.port || 80)
    )
      return false;
    const old = fs.statSync(interpreter, { bigint: true });
    if (!old.isFile() || old.ino === BigInt(0)) return false;
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PYTHON_PROCESSES], {
      windowsHide: true,
      timeout: 6000,
      maxBuffer: 256 * 1024,
    });
    const images: unknown = JSON.parse(output);
    if (!Array.isArray(images)) return false;
    return images.every((image) => {
      if (
        typeof image !== 'string' ||
        !path.win32.isAbsolute(image) ||
        image.toLowerCase() === interpreter.toLowerCase()
      )
        return false;
      const candidate = fs.statSync(image, { bigint: true });
      return (
        candidate.isFile() && candidate.ino !== BigInt(0) && (candidate.dev !== old.dev || candidate.ino !== old.ino)
      );
    });
  } catch {
    return false;
  }
}
