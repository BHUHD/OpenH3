import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMediaBinary } from '@/process/services/media/mediaBinary';

describe('media binary resolution', () => {
  it('prefers an explicit environment override', () => {
    expect(resolveMediaBinary('ffprobe', { env: { AIONUI_FFPROBE_PATH: 'X:/tools/ffprobe.exe' } })).toBe(
      'X:/tools/ffprobe.exe'
    );
  });

  it('uses the packaged binary before falling back to PATH', () => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-media-bin-'));
    const binary = path.join(resourcesPath, 'ffmpeg', 'ffprobe.exe');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, 'fixture');
    expect(resolveMediaBinary('ffprobe', { platform: 'win32', resourcesPath, cwd: 'X:/missing' })).toBe(binary);
    fs.rmSync(resourcesPath, { recursive: true, force: true });
  });
});
