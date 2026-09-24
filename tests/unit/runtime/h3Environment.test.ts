import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistH3BundleRoot, resolveH3BundleRoot } from '@/process/services/runtime/h3BundlePath';
import { H3RuntimeManager } from '@/process/services/runtime/H3RuntimeManager';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('H3 persisted environment', () => {
  it('resolves the saved location for both explicit and service data directories', () => {
    vi.stubEnv('AIONUI_H3_BUNDLE_ROOT', '');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-config-')); roots.push(data);
    const bundle = path.join(data, '中文 环境');
    persistH3BundleRoot(data, bundle);
    expect(resolveH3BundleRoot(data)).toBe(bundle);
    vi.stubEnv('AIONUI_DATA_DIR', data);
    expect(resolveH3BundleRoot()).toBe(bundle);
    expect(fs.existsSync(path.join(data, 'h3-environment.json.tmp'))).toBe(false);
  });
  it('keeps the explicit deployment override ahead of UI preferences', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-config-')); roots.push(data);
    persistH3BundleRoot(data, path.join(data, 'saved'));
    vi.stubEnv('AIONUI_H3_BUNDLE_ROOT', path.join(data, 'override'));
    expect(resolveH3BundleRoot(data)).toBe(path.join(data, 'override'));
  });
  it('does not launch a local runtime when an external endpoint is offline', async () => {
    const spawn = vi.fn();
    const runtime = new H3RuntimeManager({ systemStats: async () => { throw new Error('external offline'); } }, { external: true, spawnProcess: spawn });
    await expect(runtime.ensureStarted()).rejects.toThrow('external offline');
    expect(spawn).not.toHaveBeenCalled();
  });
});
