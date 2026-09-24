import { expect, it } from 'vitest';
import { buildH3DownloadPlan } from '@/process/services/runtime/h3DownloadPlan';
import { matlowaiCompleteOfflineBundle } from '@/process/services/runtime/h3OfflineBundle';
it('covers every pinned dependency without HTML or floating model revisions', () => {
  const plan = buildH3DownloadPlan();
  expect(plan.files.map((f) => f.relativePath).sort()).toEqual(
    matlowaiCompleteOfflineBundle()
      .files.map((f) => f.relativePath)
      .sort()
  );
  for (const file of plan.files) {
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Boolean(file.url) !== Boolean(file.embeddedBase64)).toBe(true);
    if (file.url) expect(file.url).not.toContain('.html');
    if (file.url?.includes('huggingface')) expect(file.url).toMatch(/resolve\/[a-f0-9]{40}\//);
  }
  expect(plan.totalBytes).toBeGreaterThan(42_000_000_000);
  expect(plan.reserveBytes).toBeGreaterThanOrEqual(15 * 2 ** 30);
});
it('embedded workflows retain original bytes and hashes', async () => {
  const { createHash } = await import('node:crypto');
  const files = buildH3DownloadPlan().files.filter((f) => f.embeddedBase64);
  expect(files).toHaveLength(3);
  for (const file of files) {
    const bytes = Buffer.from(file.embeddedBase64!, 'base64');
    expect(bytes.length).toBe(file.sizeBytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  }
});

it('supports a fully isolated LAN source for models, runtime and node archives', () => {
  const plan = buildH3DownloadPlan({ baseUrls: ['http://192.168.1.20/h3'], publicSources: false });
  for (const file of plan.files.filter((f) => !f.embeddedBase64)) {
    expect(file.urls).toEqual([
      'http://192.168.1.20/h3/' + file.relativePath.split('/').map(encodeURIComponent).join('/'),
    ]);
  }
});
it('keeps pinned hashes when adding mirrors and refuses an empty isolated source list', () => {
  const file = buildH3DownloadPlan().files.find((f) => f.url?.includes('huggingface.co'))!;
  expect(file.urls?.[0]).toContain('https://hf-mirror.com/');
  expect(file.urls?.[1]).toBe(file.url);
  expect(() => buildH3DownloadPlan({ publicSources: false })).toThrow('NO_SOURCE');
});
