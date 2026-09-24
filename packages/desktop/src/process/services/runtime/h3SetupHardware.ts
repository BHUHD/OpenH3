import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectHardware, type HardwareSnapshot } from './hardwareProbe';
import type { H3HardwareAssessment } from '@/common/chat/document/h3Setup';

export function assessSetupHardware(hw: HardwareSnapshot): H3HardwareAssessment {
  const reasons: string[] = [];
  if (hw.platform !== 'win32') reasons.push('WINDOWS_REQUIRED');
  if (hw.gpuProbe.status !== 'ok' || hw.gpus.length === 0) reasons.push('NVIDIA_UNAVAILABLE');
  if (!hw.driverCudaCapability || Number(hw.driverCudaCapability) < 13 || !Number.isFinite(Number(hw.driverCudaCapability))) reasons.push('CUDA13_DRIVER_REQUIRED');
  // A product support gate for this pinned recipe, not a universal H3 minimum.
  if (!hw.gpus.some(gpu => (gpu.totalMemoryMiB ?? 0) >= 15000 && !/GTX\s*10\d\d/i.test(gpu.name))) reasons.push('GPU_OUTSIDE_CURRENT_PROFILE');
  const blocked = reasons.length > 0;
  if (!hw.gpus.some(gpu => /RTX\s*5080\b/i.test(gpu.name))) reasons.push('GPU_NOT_REAL_TESTED');
  if (hw.totalMemoryBytes < 120 * 2 ** 30) reasons.push('RAM_BELOW_TESTED_BASELINE');
  return { status: blocked ? 'blocked' : reasons.length ? 'unverified' : 'baseline-match', reasons, generationVerified: false,
    gpuNames: hw.gpus.map(gpu => gpu.name), memoryGiB: hw.totalMemoryBytes / 2 ** 30, driver: hw.driverVersion };
}
export async function probeSetupHardware(): Promise<H3HardwareAssessment> {
  const run = promisify(execFile);
  return assessSetupHardware(await collectHardware({ platform: process.platform, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    execute: async (file, args) => (await run(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })).stdout }));
}
