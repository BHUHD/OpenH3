import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  downloadH3,
  downloadH3FromSources,
  downloadH3WithRetry,
  resolveH3DownloadProxy,
} from '@/process/services/runtime/h3Downloader';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(part?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-download-'));
  roots.push(root);
  const destination = path.join(root, 'model');
  if (part !== undefined) fs.writeFileSync(`${destination}.part`, part);
  return {
    url: 'https://example.com/model',
    destination,
    sizeBytes: 6,
    sha256: createHash('sha256').update('abcdef').digest('hex'),
  };
}
it('rejects an incorrect range without corrupting the partial file', async () => {
  const manifest = fixture('abc');
  const fetchImpl = vi.fn(
    async () => new Response('def', { status: 206, headers: { 'content-range': 'bytes 2-4/6' } })
  );
  await expect(downloadH3(manifest, { fetchImpl })).rejects.toThrow('RANGE');
  expect(fs.readFileSync(`${manifest.destination}.part`, 'utf8')).toBe('abc');
});
it('resumes only a validated range and verifies the whole file', async () => {
  const manifest = fixture('abc');
  const fetchImpl = vi.fn(
    async () => new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } })
  );
  expect(await downloadH3(manifest, { fetchImpl })).toMatchObject({ status: 'verified', resumedBytes: 3 });
  expect(fs.readFileSync(manifest.destination, 'utf8')).toBe('abcdef');
});
it('promotes a complete partial file without downloading it again', async () => {
  const manifest = fixture('abcdef');
  const fetchImpl = vi.fn(async () => {
    throw new Error('no network');
  });
  expect(await downloadH3(manifest, { fetchImpl })).toMatchObject({ status: 'verified', bytes: 6 });
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('reuses an already verified destination', async () => {
  const manifest = fixture();
  fs.writeFileSync(manifest.destination, 'abcdef');
  const fetchImpl = vi.fn(async () => {
    throw new Error('no network');
  });
  expect(await downloadH3(manifest, { fetchImpl })).toMatchObject({ status: 'verified' });
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('discards corrupt full partial data so retry can recover', async () => {
  const manifest = fixture('xxxxxx');
  await expect(downloadH3(manifest)).rejects.toThrow('SHA256');
  expect(fs.existsSync(`${manifest.destination}.part`)).toBe(false);
  await expect(downloadH3(manifest, { fetchImpl: async () => new Response('abcdef') })).resolves.toMatchObject({
    status: 'verified',
  });
});
it('restarts safely when the server ignores Range', async () => {
  const manifest = fixture('abc');
  expect(await downloadH3(manifest, { fetchImpl: async () => new Response('abcdef') })).toMatchObject({
    resumedBytes: 0,
  });
});
it('honors a pre-cancelled request without touching disk or network', async () => {
  const manifest = fixture('abc');
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = vi.fn(async () => new Response('abcdef'));
  await expect(downloadH3(manifest, { fetchImpl, signal: controller.signal })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(fs.readFileSync(`${manifest.destination}.part`, 'utf8')).toBe('abc');
});

it('uses explicit proxies before Windows settings and ignores disabled proxies', () => {
  expect(
    resolveH3DownloadProxy({ HTTPS_PROXY: 'http://explicit:8080' }, () => {
      throw Error('should not query');
    })
  ).toBe('http://explicit:8080');
  expect(
    resolveH3DownloadProxy({}, () => 'ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ localhost:7897')
  ).toBeUndefined();
  expect(
    resolveH3DownloadProxy(
      {},
      () => 'ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ http=localhost:7890;https=localhost:7897'
    )
  ).toBe('http://localhost:7897');
});

it('retries transient network failures and resumes the partial file', async () => {
  const manifest = fixture('abc');
  let calls = 0;
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      throw new Error('fetch failed');
    }
    expect(new Headers(init?.headers).get('Range')).toBe('bytes=3-');
    return new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } });
  });
  await expect(
    downloadH3WithRetry(manifest, { fetchImpl, retryDelayMs: 0, sleep: async () => undefined })
  ).resolves.toMatchObject({
    status: 'verified',
    resumedBytes: 3,
    bytes: 6,
  });
  expect(calls).toBe(2);
});

it.each([403, 404])('does not retry permanent HTTP %s failures', async (status) => {
  const fetchImpl = vi.fn(async () => new Response('', { status }));
  await expect(downloadH3WithRetry(fixture(), { fetchImpl, retryDelayMs: 0 })).rejects.toThrow('HTTP_' + status);
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it('pauses immediately during retry backoff without another request', async () => {
  const controller = new AbortController();
  const fetchImpl = vi.fn(async () => {
    throw new Error('fetch failed');
  });
  const pending = downloadH3WithRetry(fixture(), { fetchImpl, signal: controller.signal, retryDelayMs: 10000 });
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it('retries temporary HTTP failures within a bounded budget', async () => {
  const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
  await expect(
    downloadH3WithRetry(fixture(), { fetchImpl, maxAttempts: 3, sleep: async () => undefined })
  ).rejects.toThrow('503');
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it('continues beyond the failure budget when durable partial bytes advance', async () => {
  const manifest = fixture();
  let calls = 0;
  const fetchImpl = vi.fn(async () => {
    calls += 1;
    if (calls < 5) {
      // Model a failed stream after it has closed and flushed its partial file.
      fs.writeFileSync(`${manifest.destination}.part`, 'abcdef'.slice(0, calls));
      throw new Error('aborted');
    }
    return new Response('ef', { status: 206, headers: { 'content-range': 'bytes 4-5/6' } });
  });
  await expect(
    downloadH3WithRetry(manifest, {
      fetchImpl,
      maxAttempts: 2,
      progressResetBytes: 1,
      sleep: async () => undefined,
    })
  ).resolves.toMatchObject({ status: 'verified', resumedBytes: 4 });
  expect(calls).toBe(5);
});

it('does not count repeatedly rewritten bytes as new recovery progress', async () => {
  const manifest = fixture();
  const fetchImpl = vi.fn(async () => {
    fs.writeFileSync(`${manifest.destination}.part`, 'abc');
    throw new Error('aborted');
  });
  await expect(
    downloadH3WithRetry(manifest, {
      fetchImpl,
      maxAttempts: 2,
      progressResetBytes: 1,
      sleep: async () => undefined,
    })
  ).rejects.toThrow('aborted');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('bounds all recovery attempts by the overall deadline including backoff', async () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error('fetch failed');
  });
  await expect(
    downloadH3WithRetry(fixture(), {
      fetchImpl,
      timeoutMs: 50,
      retryDelayMs: 10000,
    })
  ).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it('recovers a real interrupted HTTP stream using Range and final SHA256', async () => {
  const data = Buffer.alloc(512 * 1024, 42);
  const ranges: string[] = [];
  let first = true;
  const server = http.createServer((req, res) => {
    ranges.push(req.headers.range ?? '');
    if (first) {
      first = false;
      res.writeHead(200, { 'content-length': data.length });
      res.write(data.subarray(0, 65536));
      setTimeout(() => res.destroy(), 50);
      return;
    }
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
    res.writeHead(206, { 'content-range': `bytes ${start}-${data.length - 1}/${data.length}` });
    res.end(data.subarray(start));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const manifest = fixture();
    manifest.url = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
    manifest.sizeBytes = data.length;
    manifest.sha256 = createHash('sha256').update(data).digest('hex');
    const result = await downloadH3WithRetry(manifest, { fetchImpl: fetch, sleep: async () => undefined });
    expect(result.status).toBe('verified');
    expect(result.resumedBytes).toBe(65536);
    expect(ranges).toEqual(['', 'bytes=65536-']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('switches sources after a network failure and resumes the same pinned file', async () => {
  const manifest = fixture('abc');
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('unreachable')) throw new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } });
    expect(new Headers(init?.headers).get('Range')).toBe('bytes=3-');
    return new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } });
  }) as unknown as typeof fetch;
  const result = await downloadH3FromSources(
    { ...manifest, urls: ['https://unreachable.test/file', 'http://192.168.1.2/file'] },
    { fetchImpl, maxAttempts: 1 }
  );
  expect(result.status).toBe('verified');
  expect(fs.readFileSync(manifest.destination, 'utf8')).toBe('abcdef');
});
it('switches away from missing mirror files but never accepts corrupted weights', async () => {
  const manifest = fixture();
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response('xxxxxx'));
  await expect(
    downloadH3FromSources(
      { ...manifest, urls: ['https://one.test/file', 'https://two.test/file'] },
      { fetchImpl, maxAttempts: 1 }
    )
  ).rejects.toThrow('SHA256');
  expect(fs.existsSync(manifest.destination)).toBe(false);
});
it('times out a stalled connection and includes diagnostic cause in source failures', async () => {
  const fetchImpl: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    );
  await expect(downloadH3FromSources(fixture(), { fetchImpl, idleTimeoutMs: 15, maxAttempts: 1 })).rejects.toThrow(
    'IDLE_TIMEOUT'
  );
});

it('downloads and verifies through a real LAN-style HTTP fallback without public network', async () => {
  const manifest = fixture('abc');
  const ranges: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/missing') { res.writeHead(404).end(); return; }
    ranges.push(req.headers.range ?? '');
    res.writeHead(206, { 'Content-Range': 'bytes 3-5/6', 'Content-Length': '3' });
    res.end('def');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const base = 'http://127.0.0.1:' + address.port;
    const result = await downloadH3FromSources({ ...manifest, urls: [base + '/missing', base + '/model'] }, { maxAttempts: 1 });
    expect(result).toMatchObject({ status: 'verified', resumedBytes: 3 });
    expect(ranges).toEqual(['bytes=3-']);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('verifies official NuGet SHA512 and rejects corrupt developer archives', async () => {
  const manifest = { ...fixture(), sha256: undefined, sha512: createHash('sha512').update('abcdef').digest('base64') };
  await expect(downloadH3(manifest, { fetchImpl: async () => new Response('xxxxxx') })).rejects.toThrow('SHA512_MISMATCH');
  expect(fs.existsSync(manifest.destination + '.part')).toBe(false);
  await expect(downloadH3(manifest, { fetchImpl: async () => new Response('abcdef') })).resolves.toMatchObject({ status: 'verified' });
});
