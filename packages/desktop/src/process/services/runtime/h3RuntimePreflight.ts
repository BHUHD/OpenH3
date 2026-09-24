export type H3RuntimeProbe = { os: string; wslAvailable: boolean; pythonAvailable: boolean; ffmpegAvailable: boolean; comfyuiPresent: boolean; dockerAvailable: boolean };

export function assessH3RuntimePreflight(probe: H3RuntimeProbe): { ready: boolean; blockers: string[]; nextSteps: string[] } {
  const blockers: string[] = [];
  if (!['linux', 'wsl2', 'win32'].includes(probe.os)) blockers.push('OS_NOT_SUPPORTED');
  if (!probe.pythonAvailable) blockers.push('PYTHON_NOT_AVAILABLE');
  if (!probe.ffmpegAvailable) blockers.push('FFMPEG_NOT_AVAILABLE');
  if (!probe.comfyuiPresent) blockers.push('COMFYUI_NOT_INSTALLED');
  return { ready: blockers.length === 0, blockers, nextSteps: probe.os === 'win32' ? ['Install or import the pinned ComfyUI portable runtime', 'Keep H3 assets under the offline bundle root', 'Re-run preflight before generation'] : ['Install missing runtime dependencies', 'Re-run preflight'] };
}
