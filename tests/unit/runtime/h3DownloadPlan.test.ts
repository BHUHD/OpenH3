import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  buildH3DownloadPlan,
  inspectH3DownloadSpace,
  recordH3VerifiedDownload,
} from '@/process/services/runtime/h3DownloadPlan';
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

it('budgets pinned network assets separately from embedded workflows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-download-space-'));
  try {
    const plan = buildH3DownloadPlan();
    const space = inspectH3DownloadSpace(root);
    const networkBytes = plan.files
      .filter((file) => !file.embeddedBase64)
      .reduce((sum, file) => sum + file.sizeBytes, 0);
    expect(space.downloadBytes).toBe(networkBytes);
    expect(space.requiredBytes).toBe(plan.totalBytes + plan.reserveBytes);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

it('permits resuming on the remaining space using allocated partials and a verified download', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-download-resume-'));
  const plan = buildH3DownloadPlan();
  const completeContents = Buffer.alloc(8192, 1);
  const completed = { ...plan.files[0], relativePath: 'completed.bin', sizeBytes: completeContents.length };
  const pending = { ...plan.files[0], relativePath: 'pending.bin', sizeBytes: 16384 };
  const resumePlan = { ...plan, files: [completed, pending], totalBytes: completed.sizeBytes + pending.sizeBytes };
  const pretendDisk = vi.spyOn(fs, 'statfsSync');
  try {
    const completePath = path.join(root, completed.relativePath);
    fs.writeFileSync(completePath, completeContents);
    recordH3VerifiedDownload(root, completed);
    fs.writeFileSync(path.join(root, pending.relativePath + '.part'), Buffer.alloc(8192, 2));
    pretendDisk.mockReturnValue({ bavail: resumePlan.reserveBytes + 8192, bsize: 1 } as fs.StatsFs);
    expect(inspectH3DownloadSpace(root, resumePlan)).toMatchObject({
      downloadBytes: 8192,
      requiredBytes: resumePlan.reserveBytes + 8192,
      enough: true,
    });

    // Replacements at the same size must not inherit a checksum receipt.
    fs.writeFileSync(completePath, Buffer.alloc(8192, 3));
    fs.utimesSync(completePath, new Date(100_000), new Date(100_000));
    expect(inspectH3DownloadSpace(root, resumePlan)).toMatchObject({
      downloadBytes: 16384,
      requiredBytes: resumePlan.reserveBytes + 16384,
      enough: false,
    });
  } finally {
    pretendDisk.mockRestore();
    fs.rmSync(root, { recursive: true });
  }
});
