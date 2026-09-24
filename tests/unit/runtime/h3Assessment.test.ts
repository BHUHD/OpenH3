import { describe, expect, it } from 'vitest';
import { assessH3Readiness } from '@process/services/runtime/h3Assessment';
import { parseNvidiaReport, type HardwareSnapshot } from '@process/services/runtime/hardwareProbe';

const hardware: HardwareSnapshot = {
  platform: 'linux',
  totalMemoryBytes: 384 * 2 ** 30,
  freeMemoryBytes: 300 * 2 ** 30,
  gpuProbe: { status: 'ok' },
  driverVersion: '580.0',
  driverCudaCapability: '13.0',
  gpus: [{ name: 'NVIDIA GeForce RTX 5090', totalMemoryMiB: 32768, freeMemoryMiB: 30000 }],
};

describe('H3 recipe preflight is not deployment certification', () => {
  it('does not confuse nominal memory with driver-reported memory on a real 5090', () => {
    const report = parseNvidiaReport(`<nvidia_smi_log><gpu><product_name>NVIDIA GeForce RTX 5090</product_name>
      <fb_memory_usage><total>32607 MiB</total><free>32000 MiB</free></fb_memory_usage></gpu></nvidia_smi_log>`);
    expect(assessH3Readiness({ ...hardware, ...report }).status).toBe('needs-validation');
  });
  it('never labels an untested matching machine supported or ready', () => {
    const result = assessH3Readiness(hardware);
    expect(result.status).toBe('needs-validation');
    expect(result.installAllowed).toBe(false);
    expect(result.pendingChecks).toContain('REAL_GENERATION_SMOKE_TEST');
  });

  it('reports both memory and GPU limitations of the current development host', () => {
    const result = assessH3Readiness({
      ...hardware,
      platform: 'win32',
      totalMemoryBytes: 32 * 2 ** 30,
      freeMemoryBytes: 16 * 2 ** 30,
      gpus: [{ name: 'NVIDIA GeForce GTX 1080', totalMemoryMiB: 8192, freeMemoryMiB: 7000 }],
    });
    expect(result.status).toBe('recipe-mismatch');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['GPU_NOT_IN_RECIPE', 'AVAILABLE_RAM_BELOW_RECIPE', 'WINDOWS_WSL_NOT_VALIDATED'])
    );
  });

  it('uses available RAM, not installed RAM, for the offload budget', () => {
    expect(assessH3Readiness({ ...hardware, freeMemoryBytes: 199 * 2 ** 30 }).reasons).toContain(
      'AVAILABLE_RAM_BELOW_RECIPE'
    );
  });

  it('does not combine unsupported cards into a supported GPU', () => {
    const gpu = { name: 'NVIDIA GeForce RTX 4060', totalMemoryMiB: 8192, freeMemoryMiB: 8000 };
    expect(assessH3Readiness({ ...hardware, gpus: [gpu, gpu, gpu, gpu] }).reasons).toContain('GPU_NOT_IN_RECIPE');
  });

  it('distinguishes a failed query from no NVIDIA GPUs', () => {
    const result = assessH3Readiness({
      ...hardware,
      gpuProbe: { status: 'unavailable', reason: 'NVIDIA_PROBE_FAILED' },
      gpus: [],
    });
    expect(result.reasons).toContain('GPU_PROBE_UNAVAILABLE');
    expect(result.reasons).not.toContain('GPU_NOT_IN_RECIPE');
  });

  it('does not certify unknown GPU memory', () => {
    const gpus = [{ ...hardware.gpus[0], totalMemoryMiB: null }];
    expect(assessH3Readiness({ ...hardware, gpus }).reasons).toContain('GPU_MEMORY_UNAVAILABLE');
  });
});
