import { expect, it } from 'vitest';
import { inspectSetupCapabilities } from '@/process/services/runtime/h3SetupCapabilities';
it('reports missing classes separately for all three modes without claiming generation', () => {
  const result = inspectSetupCapabilities({});
  expect(result.nodesAvailable).toBe(false);
  expect(result.generationVerified).toBe(false);
  expect(result.modes.map(m => m.mode).sort()).toEqual(['fl2v', 'ref2va', 't2v']);
  const classes = Object.fromEntries(result.modes.flatMap(m => m.missingNodes).map(name => [name, {}]));
  expect(inspectSetupCapabilities(classes).nodesAvailable).toBe(true);
});
it('does not equate registered loaders with available model files', () => {
  const result = inspectSetupCapabilities({ UNETLoader: { input: { required: { unet_name: [[]] } } } });
  expect(result.modelsAvailable).toBe(false);
  expect(result.missingModels).toHaveLength(4);
});
it('checks all four exact filenames in loader enums', () => {
  const result = inspectSetupCapabilities({
    UNETLoader: { input: { required: { unet_name: [['minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors']] } } },
    VAELoader: { input: { required: { vae_name: [['minimax_h3_video_vae_int8_convrot.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']] } } },
    CLIPLoader: { input: { required: { clip_name: [['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']] } } },
  });
  expect(result.modelsAvailable).toBe(true);
  expect(result.generationVerified).toBe(false);
});
