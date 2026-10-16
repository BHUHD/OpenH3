import { describe, expect, it } from 'vitest';
import { comfyProfileSchema, comfyInstallPlanSchema } from '@/common/chat/document/creation/comfy';

const profile = {
  id: 'z-image-balanced',
  family: 'z-image',
  name: 'Z-Image balanced',
  kind: 'image',
  version: 'abc123',
  quantization: 'BF16 + BF16 encoder',
  capabilities: ['text-to-image'],
  environment: { root: 'D:/ComfyUI', python: 'D:/venv/python.exe', baseUrl: 'http://127.0.0.1:8188' },
  components: [
    {
      role: 'diffusion',
      name: 'z.safetensors',
      path: 'D:/ComfyUI/models/z.safetensors',
      version: 'abc123',
      precision: 'BF16',
    },
  ],
  nodes: [{ id: 'ComfyUI', version: 'abc123' }],
  workflowPath: 'D:/workflows/z.api.json',
  bindings: { prompt: [{ nodeId: '1', input: 'text' }] },
  defaults: {},
  state: 'downloaded',
};
describe('Comfy profile contracts', () => {
  it('keeps mixed component precisions and distinct versions in an atomic profile', () => {
    const parsed = comfyProfileSchema.parse({
      ...profile,
      components: [
        ...profile.components,
        {
          role: 'vae',
          name: 'ae.safetensors',
          path: 'D:/ComfyUI/models/ae.safetensors',
          version: 'def456',
          precision: 'FP32',
        },
      ],
    });
    expect(parsed.components.map((component) => component.precision)).toEqual(['BF16', 'FP32']);
  });
  it('rejects remote runtime endpoints and floating component versions', () => {
    expect(
      comfyProfileSchema.safeParse({
        ...profile,
        environment: { ...profile.environment, baseUrl: 'https://example.com' },
      }).success
    ).toBe(false);
    expect(
      comfyProfileSchema.safeParse({ ...profile, components: [{ ...profile.components[0], version: 'latest' }] })
        .success
    ).toBe(false);
  });
  it('requires explicit family and an API workflow for standalone installs', () => {
    const { state: _state, ...candidate } = profile;
    const plan = {
      ...candidate,
      targetRoot: 'D:/ComfyUI',
      downloadBytes: 12,
      requiredBytes: 24,
      reason: 'Compatible target interpreter; memory budget validated',
      evidence: ['upstream workflow'],
      workflow: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } },
      commands: [],
      smokeInput: { prompt: 'A red sphere', width: 256, height: 256 },
    };
    expect(comfyInstallPlanSchema.safeParse(plan).success).toBe(true);
    expect(comfyInstallPlanSchema.safeParse({ ...plan, workflow: { nodes: [] } }).success).toBe(false);
  });
});
