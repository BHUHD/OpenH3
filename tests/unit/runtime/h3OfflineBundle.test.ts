import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { matlowaiCompleteOfflineBundle, matlowaiLowvramWorkflowBundle, validateOfflineBundle } from '@/process/services/runtime/h3OfflineBundle';
describe('H3 offline bundle', () => {
  it('reports missing and size-mismatched files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-bundle-'));
    fs.mkdirSync(path.join(root, 'models')); fs.writeFileSync(path.join(root, 'models', 'model.bin'), 'abc');
    expect(validateOfflineBundle(root, { profileId: 'test', modelRevision: 'revision1', files: [{ relativePath: 'models/model.bin', sizeBytes: 3, sha256: '0'.repeat(64), required: true }, { relativePath: 'vae/video.safetensors', sizeBytes: 1, sha256: '0'.repeat(64), required: true }] })).toEqual({ ok: false, missing: ['vae/video.safetensors'], mismatched: ['models/model.bin'] });
  });
  it('includes the pinned core model and lowvram workflow', () => {
    const bundle = matlowaiLowvramWorkflowBundle();
    expect(bundle.files[0]).toMatchObject({ sizeBytes: 20980178976, required: true });
    expect(bundle.files.some((file) => file.relativePath.includes('01_reference_4step_sla_lowvram'))).toBe(true);
  });
  it('includes the exact INT8 VAE and locked encoder assets', () => {
    const files = matlowaiCompleteOfflineBundle().files;
    expect(files.find((file) => file.relativePath.includes('video_vae_int8'))).toMatchObject({ sizeBytes: 3171670912, required: true });
    expect(files.find((file) => file.relativePath.includes('qwen3vl'))).toMatchObject({ sizeBytes: 15687142551, required: true });
  });
  it('hashes files in chunks instead of allocating a whole model-sized buffer', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-chunked-'));
    fs.mkdirSync(path.join(root, 'models'));
    const model = path.join(root, 'models', 'model.bin');
    fs.writeFileSync(model, Buffer.alloc(70 * 1024 * 1024 + 17, 7));
    const hash = createHash('sha256').update(fs.readFileSync(model)).digest('hex');
    expect(validateOfflineBundle(root, { profileId: 'test', modelRevision: 'revision1', files: [{ relativePath: 'models/model.bin', sizeBytes: fs.statSync(model).size, sha256: hash, required: true }] })).toEqual({ ok: true, missing: [], mismatched: [] });
  });
});
