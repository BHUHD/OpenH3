import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { buildH3DownloadPlan } from '@/process/services/runtime/h3DownloadPlan';

it('bundled download worker switches sources, receives bytes and preserves a paused partial', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-worker-network-'));
  const packagedWorker = process.env.H3_TEST_PACKAGED_WORKER;
  const bundle = packagedWorker || path.join(root, 'worker.cjs');
  const plan = buildH3DownloadPlan();
  const firstAsset = plan.files.find((file) => file.url)!;
  const partialBytes = packagedWorker ? 0 : 1024 * 1024;
  const requests: { url: string; range?: string }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url!, range: req.headers.range });
    if (req.url!.startsWith('/missing/')) {
      res.writeHead(404).end();
      return;
    }
    if (partialBytes) {
      res.writeHead(206, {
        'Content-Length': firstAsset.sizeBytes - partialBytes,
        'Content-Range': `bytes ${partialBytes}-${firstAsset.sizeBytes - 1}/${firstAsset.sizeBytes}`,
      });
    } else {
      res.writeHead(200, { 'Content-Length': firstAsset.sizeBytes });
    }
    res.write(Buffer.alloc(1024 * 1024));
    // Keep the response open until the worker receives the user's pause command.
  });
  let worker: Worker | undefined;
  try {
    if (!packagedWorker) {
      const partial = path.join(root, firstAsset.relativePath + '.part');
      fs.mkdirSync(path.dirname(partial), { recursive: true });
      fs.writeFileSync(partial, Buffer.alloc(partialBytes, 1));
      const free = plan.reserveBytes + plan.totalBytes - partialBytes;
      await build({
        entryPoints: ['scripts/h3-install-worker.ts'],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        tsconfig: 'tsconfig.json',
        // Resume with exactly enough space for the still-missing payload and reserve.
        // The packaged-worker smoke path still uses the real disk preflight.
        banner: { js: `require('node:fs').statfsSync = () => ({ bavail: ${free}, bsize: 1 });` },
      });
    }
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    fs.writeFileSync(
      path.join(root, 'download-sources.json'),
      JSON.stringify({
        baseUrls: [`http://127.0.0.1:${port}/missing`, `http://127.0.0.1:${port}/available`],
        publicSources: false,
      })
    );
    const messages: Array<{ error?: string; detail?: { bytes?: number; filename?: string } }> = [];
    worker = new Worker(bundle, {
      workerData: { bundleRoot: root, download: true },
      env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' },
    });
    const owned = worker;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker did not finish pause')), 10000);
      owned.on('message', (message) => {
        messages.push(message);
        if (message.detail?.bytes > partialBytes) owned.postMessage({ pause: true });
      });
      owned.on('error', reject);
      owned.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    expect(
      messages
        .map((m) => m.error)
        .filter(Boolean)
        .join(' ')
    ).not.toContain('is not defined');
    expect(requests.find(({ url }) => url.startsWith('/available/'))).toMatchObject({
      url: expect.any(String),
      range: partialBytes ? `bytes=${partialBytes}-` : undefined,
    });
    const filename = messages.find((m) => m.detail?.filename)?.detail?.filename;
    expect(filename && fs.statSync(path.join(root, filename + '.part')).size).toBeGreaterThan(partialBytes);
  } finally {
    await worker?.terminate();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20000);
