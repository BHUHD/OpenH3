import type { HardwareSnapshot } from '@process/services/runtime/hardwareProbe';

/** A research recipe, deliberately not a product-supported deployment profile. */
export const H3_RECIPE = {
  id: 'vllm-omni-h3-5090-dlo-research',
  source: 'https://github.com/vllm-project/vllm-omni/blob/main/recipes/MiniMaxAI/MiniMax-H3-5090.md',
  reviewedOn: '2026-09-11',
  minimumAvailableRamBytes: 200 * 2 ** 30,
  nominalGpuMemoryMiB: 32 * 1024,
  approximatePartitionBytes: 135 * 2 ** 30,
} as const;

/** Compare observed hardware to a single recipe without authorizing installation. */
export function assessH3Readiness(hardware: HardwareSnapshot): {
  recipeId: string;
  status: 'recipe-mismatch' | 'needs-validation';
  installAllowed: false;
  reasons: string[];
  pendingChecks: string[];
} {
  const reasons: string[] = [];
  if (hardware.gpuProbe.status !== 'ok') reasons.push('GPU_PROBE_UNAVAILABLE');
  else if (
    hardware.gpus.length < 1 ||
    hardware.gpus.length > 2 ||
    hardware.gpus.some((gpu) => !/\bRTX 5090$/.test(gpu.name))
  ) {
    reasons.push('GPU_NOT_IN_RECIPE');
  } else if (
    hardware.gpus.some(
      (gpu) => gpu.totalMemoryMiB === null || !Number.isFinite(gpu.totalMemoryMiB) || gpu.totalMemoryMiB <= 0
    )
  ) {
    reasons.push('GPU_MEMORY_UNAVAILABLE');
  }
  // Driver-reserved memory reduces the reported total; capacity is verified by a real run, not the nominal label.
  if (!Number.isFinite(hardware.freeMemoryBytes) || hardware.freeMemoryBytes < H3_RECIPE.minimumAvailableRamBytes) {
    reasons.push('AVAILABLE_RAM_BELOW_RECIPE');
  }
  if (hardware.platform === 'win32') reasons.push('WINDOWS_WSL_NOT_VALIDATED');
  else if (hardware.platform !== 'linux') reasons.push('OS_NOT_IN_RECIPE');
  return {
    recipeId: H3_RECIPE.id,
    status: reasons.length ? 'recipe-mismatch' : 'needs-validation',
    installAllowed: false,
    reasons,
    pendingChecks: [
      'PINNED_RUNTIME_AND_MODEL_REVISION',
      'MODEL_LICENSE_CONSENT',
      'TARGET_DISK_CAPACITY',
      'DRIVER_AND_RUNTIME_COMPATIBILITY',
      'AVAILABLE_VRAM_AND_TOPOLOGY',
      'REAL_GENERATION_SMOKE_TEST',
    ],
  };
}
