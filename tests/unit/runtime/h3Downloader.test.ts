import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { downloadH3 } from '@/process/services/runtime/h3Downloader';

describe('H3 downloader', () => {
  it('retains reported bytes when paused from the progress callback', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-progress-pause-'));
    const destination = path.join(root, 'model.bin');
    const controller = new AbortController();
    let reported = 0;
    try {
      await expect(
        downloadH3(
          { url: 'https://example.com/model.bin', destination, sizeBytes: 1024 },
          {
            signal: controller.signal,
            fetchImpl: async () =>
              new Response(
                new ReadableStream({
                  start(stream) {
                    stream.enqueue(new Uint8Array(256));
                  },
                })
              ),
            onProgress: (bytes) => {
              reported = bytes;
              controller.abort();
            },
          }
        )
      ).rejects.toThrow();
      expect(reported).toBeGreaterThan(0);
      expect(fs.statSync(destination + '.part').size).toBe(reported);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('supports dry-run without touching the destination', async () => {
    const result = await downloadH3(
      { url: 'https://example.com/model.bin', destination: path.resolve('model.bin'), sizeBytes: 10 },
      { dryRun: true }
    );
    expect(result).toMatchObject({ status: 'dry-run', bytes: 10 });
  });
  it('rejects unsafe URLs and relative destinations', async () => {
    await expect(
      downloadH3({ url: 'file:///model.bin', destination: path.resolve('model.bin') }, { dryRun: true })
    ).rejects.toThrow('SCHEME');
    await expect(
      downloadH3({ url: 'https://example.com/model.bin', destination: 'model.bin' }, { dryRun: true })
    ).rejects.toThrow('ABSOLUTE');
  });
});
