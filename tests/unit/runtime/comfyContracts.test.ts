import { describe, expect, it } from 'vitest';
import {
  comfyFamilySchema,
  comfyFamilyKind,
  comfyGenerationInputSchema,
  validateComfyGenerationInputForFamily,
  comfyProfileSchema,
  comfyInstallPlanSchema,
} from '@/common/chat/document/creation/comfy';

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

describe('additional image model families', () => {
  it.each(['flux-3-image-klein', 'moss-image-base', 'moss-image-sft', 'krea2'] as const)(
    'accepts %s as a distinct image profile without requiring reference media',
    (family) => {
      expect(comfyFamilySchema.parse(family)).toBe(family);
      expect(comfyFamilyKind(family)).toBe('image');
      expect(comfyProfileSchema.parse({ ...profile, family, state: 'downloaded' }).family).toBe(family);
      expect(validateComfyGenerationInputForFamily(family, { prompt: 'A detailed studio photograph.' })).toEqual({
        prompt: 'A detailed studio photograph.',
      });
    }
  );
});
describe('Comfy profile contracts', () => {
  it('accepts the FastH3-Omni family and preserves ordered multimodal references', () => {
    expect(comfyFamilySchema.parse('fasth3-omni')).toBe('fasth3-omni');
    expect(comfyFamilyKind('fasth3-omni')).toBe('video');
    expect(comfyFamilyKind('h3')).toBe('video');
    expect(comfyFamilyKind('z-image')).toBe('image');
    const references = [
      { type: 'image', path: 'D:/refs/one.png' },
      { type: 'video', path: 'D:/refs/clip.mp4' },
      { type: 'audio', path: 'D:/refs/voice.wav' },
    ] as const;
    expect(comfyGenerationInputSchema.parse({ prompt: 'scene', references }).references).toEqual(references);
  });

  it('rejects ambiguous legacy imagePaths alongside ordered references', () => {
    expect(
      comfyGenerationInputSchema.safeParse({
        prompt: 'scene',
        imagePaths: ['D:/refs/one.png'],
        references: [{ type: 'image', path: 'D:/refs/two.png' }],
      }).success
    ).toBe(false);
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', imagePaths: [], references: [] }).success).toBe(
      false
    );
  });

  it('limits ordered reference counts to 9 images, 3 videos, 3 audio files, and 12 total', () => {
    const image = { type: 'image', path: 'D:/refs/image.png' } as const;
    const video = { type: 'video', path: 'D:/refs/video.mp4' } as const;
    const audio = { type: 'audio', path: 'D:/refs/audio.wav' } as const;
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', references: Array(9).fill(image) }).success).toBe(
      true
    );
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', references: Array(10).fill(image) }).success).toBe(
      false
    );
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', references: Array(3).fill(video) }).success).toBe(
      true
    );
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', references: Array(4).fill(video) }).success).toBe(
      false
    );
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', references: Array(3).fill(audio) }).success).toBe(
      true
    );
    expect(comfyGenerationInputSchema.safeParse({ prompt: 'scene', references: Array(4).fill(audio) }).success).toBe(
      false
    );
    expect(
      comfyGenerationInputSchema.safeParse({
        prompt: 'scene',
        references: [...Array(9).fill(image), ...Array(3).fill(video)],
      }).success
    ).toBe(true);
    expect(
      comfyGenerationInputSchema.safeParse({
        prompt: 'scene',
        references: [...Array(9).fill(image), ...Array(3).fill(video), audio],
      }).success
    ).toBe(false);
  });

  it('keeps the legacy imagePaths contract for existing callers', () => {
    expect(comfyGenerationInputSchema.parse({ prompt: 'edit', imagePaths: ['D:/refs/old.png'] }).imagePaths).toEqual([
      'D:/refs/old.png',
    ]);
  });

  it('requires an image or video reference for FastH3-Omni but accepts legacy imagePaths', () => {
    expect(() => validateComfyGenerationInputForFamily('fasth3-omni', { prompt: 'scene' })).toThrow(
      'COMFY_OMNI_REFERENCE_REQUIRED'
    );
    expect(() =>
      validateComfyGenerationInputForFamily('fasth3-omni', {
        prompt: 'scene',
        references: [{ type: 'audio', path: 'D:/refs/voice.wav' }],
      })
    ).toThrow('COMFY_OMNI_REFERENCE_REQUIRED');
    expect(
      validateComfyGenerationInputForFamily('fasth3-omni', {
        prompt: 'scene',
        imagePaths: ['D:/refs/still.png'],
      }).imagePaths
    ).toEqual(['D:/refs/still.png']);
    expect(
      validateComfyGenerationInputForFamily('fasth3-omni', {
        prompt: 'scene',
        references: [{ type: 'video', path: 'D:/refs/clip.mp4' }],
      }).references
    ).toEqual([{ type: 'video', path: 'D:/refs/clip.mp4' }]);
  });

  it('restricts Omni output duration to the released 5-15 second range', () => {
    const input = { prompt: 'scene', imagePaths: ['D:/refs/still.png'] };
    for (const durationSeconds of [5, 15])
      expect(validateComfyGenerationInputForFamily('fasth3-omni', { ...input, durationSeconds }).durationSeconds).toBe(
        durationSeconds
      );
    for (const durationSeconds of [4.99, 15.01])
      expect(() => validateComfyGenerationInputForFamily('fasth3-omni', { ...input, durationSeconds })).toThrow(
        'COMFY_OMNI_DURATION_RANGE:5:15'
      );
  });

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
