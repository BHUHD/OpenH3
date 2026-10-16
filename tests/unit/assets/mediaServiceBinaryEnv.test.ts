import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { MediaServiceProcess } from '@/process/services/media/MediaServiceProcess';

it('passes the resolved packaged media validators into the child independently of its data cwd', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-binary-env-'));
  const original = process.resourcesPath;
  const resources = path.join(root, 'resources');
  fs.mkdirSync(path.join(resources, 'ffmpeg'), { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const name of ['ffmpeg', 'ffprobe']) fs.writeFileSync(path.join(resources, 'ffmpeg', name + suffix), 'binary');
  const script = path.join(root, 'service.js');
  fs.writeFileSync(script, '');
  process.resourcesPath = resources;
  const spawnProcess = vi.fn(() => Object.assign(new EventEmitter(), { kill: vi.fn() }) as unknown as ChildProcess);
  try {
    const service = new MediaServiceProcess({
      scriptPath: script,
      dataDir: path.join(root, 'data'),
      spawnProcess,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch,
      sleep: async () => undefined,
    });
    await service.start();
    const env = spawnProcess.mock.calls[0]?.[2].env;
    expect(env?.AIONUI_FFMPEG_PATH).toBe(path.join(resources, 'ffmpeg', 'ffmpeg' + suffix));
    expect(env?.AIONUI_FFPROBE_PATH).toBe(path.join(resources, 'ffmpeg', 'ffprobe' + suffix));
    service.stop();
  } finally {
    process.resourcesPath = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
