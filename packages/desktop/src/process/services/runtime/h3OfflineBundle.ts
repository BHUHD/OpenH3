import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type H3OfflineFile = { relativePath: string; sizeBytes: number; sha256: string; required: boolean };
export type H3OfflineBundle = { profileId: string; modelRevision: string; files: H3OfflineFile[] };

export const MATLOWAI_PORTABLE_RUNTIME_ARCHIVE = {
  relativePath: 'runtime/ComfyUI_windows_portable_nvidia.7z',
  sizeBytes: 1910039517,
  sha256: '6fb005a8269c6f5972a8fb76d7a4fc251578ccc7906671a801b382591c791dd2',
  source: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.35.0/ComfyUI_windows_portable_nvidia.7z',
  status: 'downloaded-and-verified',
} as const;

export const MATLOWAI_ARCHIVE_EXTRACTOR = {
  relativePath: 'runtime/7zr.exe',
  sizeBytes: 602624,
  sha256: 'ad4c82fadcbdf93c03b4fc440f300509c7d60c5c2f4d183e35d9d70d6957037d',
  source: 'https://www.7-zip.org/download.html',
} as const;

export const MATLOWAI_CUSTOM_NODE_ARCHIVES = [
  { id: 'comfyui-mainodes', source: 'https://github.com/matlowai/ComfyUI-MAINodes', revision: 'f4868b4a08e8a504ce86db54a17961d399ffa2bc', relativePath: 'custom-node-sources/ComfyUI-MAINodes.zip', targetDirectory: 'ComfyUI-MAINodes-f4868b4a08e8a504ce86db54a17961d399ffa2bc', sizeBytes: 97516766, sha256: '053029c608cb52bd6da0784f8434806d4e954fa9c4da943c1b3bd9cb2bbee60e' },
  { id: 'h3-sla-node', source: 'https://github.com/ethanfel/ComfyUI-PlagueKind-Nodes-only-sparse', revision: 'fd26ffb89dee294ca740a59632e5b3423b9a9d2a', relativePath: 'custom-node-sources/ComfyUI-PlagueKind-Nodes-only-sparse.zip', targetDirectory: 'ComfyUI-PlagueKind-Nodes-only-sparse-fd26ffb89dee294ca740a59632e5b3423b9a9d2a', sizeBytes: 23514, sha256: '1225b4f57f07430dcfc047ccb58ed6f6287a30d9cdeef0239ed17c566fb28f47' },
  { id: 'comfyui-kjnodes', source: 'https://github.com/kijai/ComfyUI-KJNodes', revision: 'd3cfe21625e5170126ce06fbfcfe1d88108688c3', relativePath: 'custom-node-sources/ComfyUI-KJNodes.zip', targetDirectory: 'ComfyUI-KJNodes-d3cfe21625e5170126ce06fbfcfe1d88108688c3', sizeBytes: 1131840, sha256: 'cf4d48541219ecf8ef693b7fc25871eae9fbb6e417449871b39753bc087a6109' },
] as const;

export const MATLOWAI_MODEL_ASSETS = [
  { relativePath: 'models/diffusion_models/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors', sizeBytes: 20980178976 },
  { relativePath: 'models/vae/minimax_h3_video_vae_int8_convrot.safetensors', sizeBytes: 3171670912 },
  { relativePath: 'models/vae/minimax_h3_audio_vae_fp32.safetensors', sizeBytes: 605254808 },
  { relativePath: 'models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', sizeBytes: 15687142551 },
] as const;

export function matlowaiCoreOfflineBundle(): H3OfflineBundle {
  return {
    profileId: 'matlowai-h3-fused-int8-comfy-5080-experimental',
    modelRevision: '8a8dffaa0cd99c6184833ae0a3b4e9b0089c17b3',
    files: [{ relativePath: 'models/diffusion_models/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors', sizeBytes: 20980178976, sha256: '4262e4e9963c553fa00016bbe83961407a4fc0a888be95fd836c8d4f2304e48b', required: true }],
  };
}
export function matlowaiLowvramWorkflowBundle(): H3OfflineBundle {
  const core = matlowaiCoreOfflineBundle();
  return { ...core, files: [...core.files,
    { relativePath: 'workflows/lowvram/01_reference_4step_sla_lowvram.api.json', sizeBytes: 4139, sha256: 'f622f57e30056f45355079203e7d3fc6ea4db60451686293d1eda47c9f471487', required: true },
    { relativePath: 'workflows/lowvram/04_i2v_fl2v_4step_sla_lowvram.api.json', sizeBytes: 4327, sha256: '5993d7f12f7cb43cb446d8c71c1a6c56d0c35dfc49cf6998db64979de70f6f4d', required: false },
    { relativePath: 'workflows/lowvram/05_ref2va_4step_sla_lowvram.api.json', sizeBytes: 4737, sha256: 'c3bf8dc9bb5d8265648f5a49d31c4323a1f132206ddc3a4230c4e5e07bd979c4', required: false },
  ] };
}

export function matlowaiCompleteOfflineBundle(): H3OfflineBundle {
  const bundle = matlowaiLowvramWorkflowBundle();
  return {
    ...bundle,
    files: [
      ...bundle.files,
      { relativePath: 'models/vae/minimax_h3_video_vae_int8_convrot.safetensors', sizeBytes: 3171670912, sha256: '9bb2d96f218c76babd85e0611b85ca8fb330a90546c01a0005e8a58a59593410', required: true },
      { relativePath: 'models/vae/minimax_h3_audio_vae_fp32.safetensors', sizeBytes: 605254808, sha256: '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48', required: true },
      { relativePath: 'models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', sizeBytes: 15687142551, sha256: '35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6', required: true },
      { relativePath: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.relativePath, sizeBytes: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.sizeBytes, sha256: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.sha256, required: true },
      { relativePath: MATLOWAI_ARCHIVE_EXTRACTOR.relativePath, sizeBytes: MATLOWAI_ARCHIVE_EXTRACTOR.sizeBytes, sha256: MATLOWAI_ARCHIVE_EXTRACTOR.sha256, required: true },
      ...MATLOWAI_CUSTOM_NODE_ARCHIVES.map(({ relativePath, sizeBytes, sha256 }) => ({ relativePath, sizeBytes, sha256, required: true })),
    ],
  };
}

export const MATLOWAI_RUNTIME_DEPENDENCIES = [
  { id: 'comfyui-core', source: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.source, revision: 'v0.35.0', relativePath: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.relativePath, sizeBytes: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.sizeBytes, sha256: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.sha256, required: true, status: 'locked' },
  { id: 'h3-video-vae', source: 'GuangyuanSD/minimax_h3_video_vae_int8_convrot', revision: 'fc2f3c9dcb4449ef08d46fc3dc6b0e353a586321', relativePath: 'models/vae/minimax_h3_video_vae_int8_convrot.safetensors', sizeBytes: 3171670912, sha256: '9bb2d96f218c76babd85e0611b85ca8fb330a90546c01a0005e8a58a59593410', required: true, status: 'locked' },
  { id: 'h3-audio-vae', source: 'Comfy-Org/MiniMax-H3', revision: 'a98869194787969724c7425d95d0ed73ce9202af', relativePath: 'models/vae/minimax_h3_audio_vae_fp32.safetensors', sizeBytes: 605254808, sha256: '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48', required: true, status: 'locked' },
  { id: 'h3-text-encoder', source: 'Comfy-Org/MiniMax-H3', revision: 'a98869194787969724c7425d95d0ed73ce9202af', relativePath: 'models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', sizeBytes: 15687142551, sha256: '35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6', required: true, status: 'locked' },
  { ...MATLOWAI_CUSTOM_NODE_ARCHIVES[0], required: true, status: 'locked' },
  { ...MATLOWAI_CUSTOM_NODE_ARCHIVES[1], required: true, status: 'locked' },
  { ...MATLOWAI_CUSTOM_NODE_ARCHIVES[2], required: true, status: 'locked' },
] as const;

export const MATLOWAI_WORKFLOW_MODEL_FILES = [
  { relativePath: 'models/vae/minimax_h3_video_vae_int8_convrot.safetensors', required: true },
  { relativePath: 'models/vae/minimax_h3_audio_vae_fp32.safetensors', required: true },
  { relativePath: 'models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', required: true },
  { relativePath: 'custom_nodes/ComfyUI-MAINodes', required: true },
  { relativePath: 'custom_nodes/ComfyUI-PlagueKind-Nodes-only-sparse', required: true },
  { relativePath: 'custom_nodes/KJNodes', required: true },
] as const;

export type OfflineDependencyStatus = 'locked' | 'pending-download-metadata' | 'external-runtime';
export const MATLOWAI_OFFLINE_DEPENDENCY_STATUS: ReadonlyArray<{ id: string; status: OfflineDependencyStatus; note: string }> = [
  { id: 'fused-diffusion-model', status: 'locked', note: 'Revision, size and SHA256 are fixed.' },
  { id: 'lowvram-workflows', status: 'locked', note: 'Three API workflows are downloaded and SHA256-verified.' },
  { id: 'video-vae', status: 'locked', note: 'GuangyuanSD INT8 ConvRot VAE revision, size and SHA256 are fixed.' },
  { id: 'audio-vae', status: 'locked', note: 'Revision, size and SHA256 are fixed.' },
  { id: 'qwen3vl-text-encoder', status: 'locked', note: 'Revision, size and SHA256 are fixed.' },
  { id: 'comfyui-and-custom-nodes', status: 'locked', note: 'ComfyUI v0.35.0 portable runtime and three custom-node archives are commit- and SHA256-pinned; KJNodes Triton VAE remains optional.' },
];

export function isMatlowaiBundleComplete(): boolean {
  return MATLOWAI_OFFLINE_DEPENDENCY_STATUS.every((item) => item.status === 'locked');
}

export const MATLOWAI_WORKFLOW_COMPATIBILITY = {
  requestedVideoVae: 'minimax_h3_video_vae_int8_convrot.safetensors',
  knownOfficialVideoVae: 'minimax_h3_video_vae_fp16.safetensors',
  status: 'resolved-source-found',
} as const;

export function validateOfflineBundle(root: string, bundle: H3OfflineBundle): { ok: boolean; missing: string[]; mismatched: string[] } {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const file of bundle.files) {
    const target = path.resolve(root, file.relativePath);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(target)) { missing.push(file.relativePath); continue; }
    if (fs.statSync(target).size !== file.sizeBytes) { mismatched.push(file.relativePath); continue; }
    const hash = createHash('sha256');
    const descriptor = fs.openSync(target, 'r');
    const chunk = Buffer.allocUnsafe(64 * 1024 * 1024);
    try {
      let offset = 0;
      let read = 0;
      do { read = fs.readSync(descriptor, chunk, 0, chunk.length, offset); if (read > 0) hash.update(chunk.subarray(0, read)); offset += read; } while (read > 0);
    } finally { fs.closeSync(descriptor); }
    if (hash.digest('hex').toLowerCase() !== file.sha256.toLowerCase()) mismatched.push(file.relativePath);
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

// End of offline bundle definitions.
