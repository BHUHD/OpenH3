import { describe, expect, it } from 'vitest';
import { assessH3RuntimePreflight } from '@/process/services/runtime/h3RuntimePreflight';
describe('H3 runtime preflight', () => {
  it('blocks native Windows when the portable runtime is not installed', () => {
    const result = assessH3RuntimePreflight({ os: 'win32', wslAvailable: false, pythonAvailable: false, ffmpegAvailable: false, comfyuiPresent: false, dockerAvailable: false });
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(['PYTHON_NOT_AVAILABLE', 'FFMPEG_NOT_AVAILABLE', 'COMFYUI_NOT_INSTALLED']);
    expect(result.nextSteps[0]).toContain('runtime');
  });
  it('allows a prepared native Windows portable ComfyUI runtime', () => {
    expect(assessH3RuntimePreflight({ os: 'win32', wslAvailable: false, pythonAvailable: true, ffmpegAvailable: true, comfyuiPresent: true, dockerAvailable: false }).ready).toBe(true);
  });
  it('allows an already prepared Linux runtime', () => {
    expect(assessH3RuntimePreflight({ os: 'wsl2', wslAvailable: true, pythonAvailable: true, ffmpegAvailable: true, comfyuiPresent: true, dockerAvailable: false }).ready).toBe(true);
  });
});
