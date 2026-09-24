import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('bundled download worker switches sources, receives bytes and preserves a paused partial', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-worker-network-'));
  const bundle = process.env.H3_TEST_PACKAGED_WORKER || path.join(root, 'worker.cjs');
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url!);
    if (req.url!.startsWith('/missing/')) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Length': '20980178976' });
    res.write(Buffer.alloc(1024 * 1024));
    // Keep the response open until the worker receives the user's pause command.
  });
  let worker: Worker | undefined;
  try {
    if (!process.env.H3_TEST_PACKAGED_WORKER) await build({ entryPoints: ['scripts/h3-install-worker.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', tsconfig: 'tsconfig.json' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    fs.writeFileSync(path.join(root, 'download-sources.json'), JSON.stringify({ baseUrls: [`http://127.0.0.1:${port}/missing`, `http://127.0.0.1:${port}/available`], publicSources: false }));
    const messages: Array<{ error?: string; detail?: { bytes?: number; filename?: string } }> = [];
    worker = new Worker(bundle, { workerData: { bundleRoot: root, download: true }, env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' } });
    const owned = worker;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker did not finish pause')), 10000);
      owned.on('message', message => {
        messages.push(message);
        if (message.detail?.bytes > 0) owned.postMessage({ pause: true });
      });
      owned.on('error', reject);
      owned.on('exit', () => { clearTimeout(timeout); resolve(); });
    });
    expect(messages.map(m => m.error).filter(Boolean).join(' ')).not.toContain('is not defined');
    expect(requests.some(url => url.startsWith('/available/'))).toBe(true);
    const filename = messages.find(m => m.detail?.filename)?.detail?.filename;
    expect(filename && fs.statSync(path.join(root, filename + '.part')).size).toBeGreaterThan(0);
  } finally {
    await worker?.terminate();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20000);
