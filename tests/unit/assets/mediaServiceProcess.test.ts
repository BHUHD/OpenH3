import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MediaServiceProcess } from '@/process/services/media/MediaServiceProcess';

describe('media service process', () => {
  it('starts one controlled child with data and H3 bundle environment', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-service-process-'));
    const scriptPath = path.join(root, 'media-service.js');
    fs.writeFileSync(scriptPath, '');
    let started: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdio: unknown } | undefined;
    const manager = new MediaServiceProcess({
      scriptPath,
      dataDir: root,
      bundleRoot: path.join(root, 'h3-bundle'),
      sleep: async () => undefined,
      spawnProcess: (command, args, options) => { started = { command, args, env: options.env, stdio: options.stdio }; return { once: () => undefined, kill: () => undefined } as never; },
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    await manager.start();
    expect(started?.args).toEqual([scriptPath]);
    expect(started?.env.AIONUI_MEDIA_PORT).toBe('33002');
    expect(started?.env.AIONUI_DATA_DIR).toBe(root);
    expect(started?.env.AIONUI_H3_BUNDLE_ROOT).toBe(path.join(root, 'h3-bundle'));
    expect(fs.existsSync(path.join(root, 'media-service.log'))).toBe(true);
  });
});
