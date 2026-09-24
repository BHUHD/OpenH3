import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadH3 } from '@/process/services/runtime/h3Downloader';

describe('H3 downloader', () => {
  it('supports dry-run without touching the destination', async () => {
    const result = await downloadH3({ url: 'https://example.com/model.bin', destination: path.resolve('model.bin'), sizeBytes: 10 }, { dryRun: true });
    expect(result).toMatchObject({ status: 'dry-run', bytes: 10 });
  });
  it('rejects unsafe URLs and relative destinations', async () => {
    await expect(downloadH3({ url: 'file:///model.bin', destination: path.resolve('model.bin') }, { dryRun: true })).rejects.toThrow('SCHEME');
    await expect(downloadH3({ url: 'https://example.com/model.bin', destination: 'model.bin' }, { dryRun: true })).rejects.toThrow('ABSOLUTE');
  });
});
