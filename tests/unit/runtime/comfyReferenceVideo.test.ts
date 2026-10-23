import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withComfyReferenceVideo } from '@/process/services/media/comfy/referenceVideo';
import { resolveMediaBinary } from '@/process/services/media/mediaBinary';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-video-ref-test-'));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('Omni reference video timing', () => {
  it('normalizes to 24fps losslessly, preserves the soundtrack/source, and removes temporary files', async () => {
    const source = path.join(directory, 'source.mkv');
    execFileSync(
      resolveMediaBinary('ffmpeg'),
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=96x64:rate=30:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=8000:duration=2',
        '-c:v',
        'ffv1',
        '-c:a',
        'pcm_s16le',
        '-shortest',
        source,
      ],
      { windowsHide: true, timeout: 30_000, stdio: 'pipe' }
    );
    const original = fs.readFileSync(source);
    let temporary = '';
    await withComfyReferenceVideo(source, 30, new AbortController().signal, async (file) => {
      temporary = file;
      expect(file).not.toBe(source);
      const metadata = JSON.parse(
        execFileSync(
          resolveMediaBinary('ffprobe'),
          ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
          { windowsHide: true, encoding: 'utf8' }
        )
      );
      expect(
        metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').avg_frame_rate
      ).toBe('24/1');
      expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
      expect(Number(metadata.format.duration)).toBeCloseTo(2, 1);
    });
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.readFileSync(source)).toEqual(original);
    await expect(
      withComfyReferenceVideo(source, 30, new AbortController().signal, async (file) => {
        temporary = file;
        throw new Error('upload failed');
      })
    ).rejects.toThrow('upload failed');
    expect(fs.existsSync(temporary)).toBe(false);
  });

  it('reuses a 24fps source', async () => {
    const source = path.join(directory, 'source.mkv');
    fs.writeFileSync(source, 'fixture');
    await withComfyReferenceVideo(source, 24, new AbortController().signal, async (file) => {
      expect(file).toBe(source);
    });
  });

  it('normalizes a source whose frame rate could not be detected', async () => {
    const source = path.join(directory, 'unknown-rate.mkv');
    execFileSync(
      resolveMediaBinary('ffmpeg'),
      ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=30:duration=1', '-c:v', 'ffv1', source],
      { windowsHide: true, timeout: 30_000, stdio: 'pipe' }
    );

    await withComfyReferenceVideo(source, undefined, new AbortController().signal, async (file) => {
      expect(file).not.toBe(source);
      const metadata = JSON.parse(
        execFileSync(
          resolveMediaBinary('ffprobe'),
          ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'json', file],
          { windowsHide: true, encoding: 'utf8' }
        )
      );
      expect(metadata.streams[0].avg_frame_rate).toBe('24/1');
    });
  });
});
