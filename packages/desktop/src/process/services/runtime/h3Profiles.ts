import { z } from 'zod';

export const h3ProfileSchema = z.object({
  id: z.string().min(1), runtime: z.enum(['vllm-omni', 'sglang', 'fastvideo', 'comfyui']), modelRevision: z.string().min(7),
  modelRepo: z.string().min(1), minDiskBytes: z.number().positive(), requiresLicenseConsent: z.literal(true),
  supportedOs: z.array(z.enum(['linux', 'wsl2', 'win32'])).min(1), notes: z.array(z.string()),
}).strict();
export type H3Profile = z.infer<typeof h3ProfileSchema>;

export const H3_FASTH3_VSA_PROFILE: H3Profile = {
  id: 'fasth3-vsa-preview-v1', runtime: 'fastvideo',
  modelRevision: '5ea076f35b84da4c3c82217112fa733d8eea2ae1',
  modelRepo: 'FastVideo/FastVideo-FastH3-4-step-Preview-v1-VSA-DataFree',
  minDiskBytes: 160_000_000_000, requiresLicenseConsent: true, supportedOs: ['linux', 'wsl2'],
  notes: ['T2VA preview profile only', 'Not the official 2K product pipeline', 'GPU and RAM require separate runtime validation'],
};
export const H3_MATLOWAI_COMFY_INT8_5080_PROFILE: H3Profile = {
  id: 'matlowai-h3-fused-int8-comfy-5080-experimental', runtime: 'comfyui',
  modelRevision: '8a8dffaa0cd99c6184833ae0a3b4e9b0089c17b3',
  modelRepo: 'MATLOWAI/minimax-h3-fused-turbo-int8-convrot', minDiskBytes: 30_000_000_000,
  requiresLicenseConsent: true, supportedOs: ['win32'],
  notes: ['ComfyUI-only fused INT8 model', '21GB ConvRot file', 'Requires ComfyUI custom nodes and H3 text/vae assets', 'Native Windows portable runtime smoke-tested on RTX 5080 at low resolution'],
};
export const H3_MATLOWAI_COMFY_MODEL_MANIFEST = {
  url: 'https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot/resolve/8a8dffaa0cd99c6184833ae0a3b4e9b0089c17b3/diffusion_models/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors',
  relativePath: 'models/diffusion_models/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors',
  sizeBytes: 20980178976,
  sha256: '4262e4e9963c553fa00016bbe83961407a4fc0a888be95fd836c8d4f2304e48b',
} as const;
export const H3_FASTH3_5080_EXPERIMENTAL_PROFILE: H3Profile = {
  id: 'fasth3-vsa-preview-5080-experimental', runtime: 'fastvideo',
  modelRevision: H3_FASTH3_VSA_PROFILE.modelRevision, modelRepo: H3_FASTH3_VSA_PROFILE.modelRepo,
  minDiskBytes: 160_000_000_000, requiresLicenseConsent: true, supportedOs: ['linux', 'wsl2'],
  notes: ['RTX 5080 16GB experimental candidate', 'Requires WSL2/Linux; native Windows is not validated', 'Use low resolution and short T2VA samples first', 'CPU/NVMe offload may be required'],
};

export function buildH3InstallPlan(profileInput: unknown, availableDiskBytes: number, os: string) {
  const profile = h3ProfileSchema.parse(profileInput);
  const reasons: string[] = [];
  if (!profile.supportedOs.includes(os as 'linux' | 'wsl2' | 'win32')) reasons.push('OS_NOT_SUPPORTED');
  if (!Number.isFinite(availableDiskBytes) || availableDiskBytes < profile.minDiskBytes) reasons.push('DISK_SPACE_BELOW_PROFILE');
  return { profileId: profile.id, modelRepo: profile.modelRepo, modelRevision: profile.modelRevision, installAllowed: reasons.length === 0, reasons, requiresLicenseConsent: profile.requiresLicenseConsent, dryRun: true };
}
