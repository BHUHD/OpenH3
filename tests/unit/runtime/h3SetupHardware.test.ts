import { expect, it } from 'vitest';
import { assessSetupHardware } from '@/process/services/runtime/h3SetupHardware';
import type { HardwareSnapshot } from '@/process/services/runtime/hardwareProbe';
const baseline: HardwareSnapshot = { platform: 'win32', totalMemoryBytes: 128 * 2 ** 30, freeMemoryBytes: 80 * 2 ** 30, driverVersion: '591.44', driverCudaCapability: '13.1', gpuProbe: { status: 'ok' }, gpus: [{ name: 'NVIDIA GeForce RTX 5080', totalMemoryMiB: 16303, freeMemoryMiB: 15000 }] };
it('recognizes the tested configuration without claiming generation success', () => {
  expect(assessSetupHardware(baseline)).toMatchObject({ status: 'baseline-match', generationVerified: false });
});
it('blocks the local GTX1080 from this CUDA13 profile', () => {
  expect(assessSetupHardware({ ...baseline, gpus: [{ name: 'GTX 1080', totalMemoryMiB: 8192, freeMemoryMiB: 8000 }] }).status).toBe('blocked');
});
it('keeps untested GPUs and lower RAM explicit rather than claiming support', () => {
  expect(assessSetupHardware({ ...baseline, totalMemoryBytes: 32 * 2 ** 30 }).status).toBe('unverified');
  expect(assessSetupHardware({ ...baseline, gpus: [{ ...baseline.gpus[0], name: 'RTX 5090' }] }).status).toBe('unverified');
});
it('blocks missing GPU tooling, wrong OS and insufficient driver capability', () => {
  expect(assessSetupHardware({ ...baseline, platform: 'linux' }).status).toBe('blocked');
  expect(assessSetupHardware({ ...baseline, driverCudaCapability: '12.8' }).status).toBe('blocked');
  expect(assessSetupHardware({ ...baseline, gpuProbe: { status: 'unavailable', reason: 'NVIDIA_PROBE_FAILED' } }).status).toBe('blocked');
});
