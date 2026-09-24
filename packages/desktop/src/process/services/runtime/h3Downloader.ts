import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { HttpsProxyAgent } from 'https-proxy-agent';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { pipeline } from 'node:stream/promises';

export type H3DownloadManifest = {
  url: string;
  destination: string;
  sizeBytes?: number;
  sha256?: string;
  sha512?: string;
};
export type H3DownloadResult = {
  status: 'dry-run' | 'downloaded' | 'verified';
  destination: string;
  resumedBytes: number;
  bytes: number;
};
export type H3DownloadOptions = {
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  onProgress?: (bytes: number, total?: number) => void;
};

export type H3DownloadRetryOptions = H3DownloadOptions & {
  maxAttempts?: number;
  /** Durable progress required to reset the consecutive failure budget. */
  progressResetBytes?: number;
  onRetry?: (attempt: number, delayMs: number) => void;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function isRetryableH3DownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && ['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(String(error.code))) return false;
  const status = /^H3_DOWNLOAD_HTTP_(\d+)$/.exec(error.message)?.[1];
  if (status) return ['408', '429', '500', '502', '503', '504'].includes(status);
  if (error.name === 'AbortError' || error.message === 'The operation was aborted') return false;
  return !/^H3_DOWNLOAD_(SHA256|SHA512|SIZE|RANGE|URL_SCHEME|DESTINATION|MANIFEST|EMBEDDED)/.test(error.message);
}

/** Retry transient network failures while preserving the verified partial file. */
export async function downloadH3WithRetry(
  manifest: H3DownloadManifest,
  options: H3DownloadRetryOptions = {}
): Promise<H3DownloadResult> {
  const maxAttempts = Math.min(10, Math.max(1, Math.floor(options.maxAttempts ?? 4)));
  if (!Number.isFinite(maxAttempts)) throw new Error('H3_DOWNLOAD_RETRY_OPTIONS_INVALID');
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const progressResetBytes = options.progressResetBytes ?? 64 * 1024 * 1024;
  if (
    !Number.isFinite(retryDelayMs) ||
    retryDelayMs < 0 ||
    !Number.isSafeInteger(progressResetBytes) ||
    progressResetBytes < 1
  )
    throw new Error('H3_DOWNLOAD_RETRY_OPTIONS_INVALID');
  // Bound the entire recovery session, not just each individual connection.
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 24 * 60 * 60 * 1000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const sleep = options.sleep ?? ((ms: number) => delay(ms, undefined, { signal }));
  const partialBytes = () => {
    try {
      return fs.statSync(`${manifest.destination}.part`).size;
    } catch {
      return 0;
    }
  };
  let highWaterBytes = partialBytes();
  let failures = 0;
  for (;;) {
    try {
      return await downloadH3(manifest, { ...options, signal });
    } catch (error) {
      signal.throwIfAborted();
      if (!isRetryableH3DownloadError(error)) throw error;
      const bytes = partialBytes();
      if (bytes - highWaterBytes >= progressResetBytes) {
        failures = 0;
        highWaterBytes = bytes;
      }
      failures += 1;
      if (failures >= maxAttempts) throw error;
      const waitMs = retryDelayMs * 2 ** (failures - 1);
      options.onRetry?.(failures + 1, waitMs);
      await sleep(waitMs);
    }
  }
}

/** Try pinned byte-identical sources without discarding resumable data. */
export async function downloadH3FromSources(
  manifest: H3DownloadManifest & { urls?: string[] },
  options: H3DownloadRetryOptions & { onSource?: (host: string) => void } = {}
): Promise<H3DownloadResult> {
  const urls = [...new Set(manifest.urls ?? [manifest.url])];
  if (!urls.length) throw new Error('H3_DOWNLOAD_NO_SOURCE');
  if (urls.length > 1 && (!(manifest.sha256 || manifest.sha512) || manifest.sizeBytes === undefined))
    throw new Error('H3_DOWNLOAD_MANIFEST_HASH_REQUIRED');
  const failures: string[] = [];
  const proxy = options.fetchImpl ? undefined : resolveH3DownloadProxy();
  const routes = urls.flatMap((url) => [{ url, proxy: '' }, ...(proxy ? [{ url, proxy }] : [])]);
  for (const route of routes) {
    const { url } = route;
    options.signal?.throwIfAborted();
    options.onSource?.(new URL(url).host);
    try {
      return await downloadH3WithRetry(
        { ...manifest, url },
        {
          ...options,
          maxAttempts: options.maxAttempts ?? 2,
          fetchImpl: options.fetchImpl ?? ((input, init) => fetchH3Download(String(input), init ?? {}, route.proxy)),
        }
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      const e = error as Error & { code?: string; cause?: { code?: string } };
      if (
        ['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(e.code ?? '') ||
        /H3_DOWNLOAD_(SHA256|SHA512|SIZE|MANIFEST|DESTINATION|URL_SCHEME)/.test(e.message)
      )
        throw error;
      failures.push(new URL(url).host + ': ' + (e.cause?.code ?? e.code ?? e.message));
    }
  }
  throw new Error('H3_DOWNLOAD_ALL_SOURCES_FAILED: ' + failures.join('; '));
}

/** Resolve an explicit proxy or the Windows user's static system proxy. PAC is not evaluated. */
export function resolveH3DownloadProxy(
  env: NodeJS.ProcessEnv = process.env,
  readSystem?: () => string
): string | undefined {
  const configured = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (configured) return configured;
  if (process.platform !== 'win32' && !readSystem) return undefined;
  try {
    const settings = (
      readSystem ??
      (() =>
        execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 3000,
        }))
    )();
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(settings)) return undefined;
    const value = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(settings)?.[1]?.trim();
    if (!value) return undefined;
    const target = value.includes('=')
      ? (/(?:^|;)https=([^;]+)/i.exec(value)?.[1] ?? /(?:^|;)http=([^;]+)/i.exec(value)?.[1])
      : value;
    return target ? (/^https?:\/\//i.test(target) ? target : 'http://' + target) : undefined;
  } catch {
    return undefined;
  }
}

/** Stream through the configured proxy without buffering a model in memory. */
export async function fetchH3Download(
  url: string,
  init: RequestInit,
  proxy = resolveH3DownloadProxy(),
  redirects = 0
): Promise<Response> {
  if (!proxy) return fetch(url, init);
  if (redirects > 8) throw new Error('H3_DOWNLOAD_TOO_MANY_REDIRECTS');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('H3_DOWNLOAD_URL_SCHEME_UNSUPPORTED');
  return new Promise((resolve, reject) => {
    const request = (parsed.protocol === 'https:' ? https : http).get(
      parsed,
      {
        agent: new HttpsProxyAgent(proxy),
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        signal: init.signal ?? undefined,
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          resolve(fetchH3Download(new URL(response.headers.location, parsed).href, init, proxy, redirects + 1));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        resolve(
          new Response(
            [204, 205, 304].includes(status) ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>),
            { status, headers }
          )
        );
      }
    );
    request.once('error', reject);
  });
}

function validateManifest(manifest: H3DownloadManifest): void {
  const url = new URL(manifest.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('H3_DOWNLOAD_URL_SCHEME_UNSUPPORTED');
  if (!path.isAbsolute(manifest.destination)) throw new Error('H3_DOWNLOAD_DESTINATION_MUST_BE_ABSOLUTE');
  if (manifest.sizeBytes !== undefined && (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 0))
    throw new Error('H3_DOWNLOAD_SIZE_INVALID');
  if (manifest.sha256 && !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('H3_DOWNLOAD_SHA256_INVALID');
  if (manifest.sha512 && !/^[A-Za-z0-9+/]{86}==$/.test(manifest.sha512)) throw new Error('H3_DOWNLOAD_SHA512_INVALID');
}

async function verify(file: string, manifest: H3DownloadManifest, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const bytes = fs.statSync(file).size;
  if (manifest.sizeBytes !== undefined && bytes !== manifest.sizeBytes) throw new Error('H3_DOWNLOAD_SIZE_MISMATCH');
  if (manifest.sha256) {
    const hash = createHash('sha256');
    // Bound memory independently of model size, including 20+ GB checkpoints.
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024, signal })) hash.update(chunk);
    if (hash.digest('hex').toLowerCase() !== manifest.sha256.toLowerCase())
      throw new Error('H3_DOWNLOAD_SHA256_MISMATCH');
  }
  if (manifest.sha512) {
    const hash = createHash('sha512');
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024, signal })) hash.update(chunk);
    if (hash.digest('base64') !== manifest.sha512) throw new Error('H3_DOWNLOAD_SHA512_MISMATCH');
  }
  return bytes;
}

export async function downloadH3(
  manifest: H3DownloadManifest,
  options: H3DownloadOptions = {}
): Promise<H3DownloadResult> {
  validateManifest(manifest);
  if (options.dryRun)
    return { status: 'dry-run', destination: manifest.destination, resumedBytes: 0, bytes: manifest.sizeBytes ?? 0 };
  options.signal?.throwIfAborted();
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 24 * 60 * 60 * 1000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const result = (bytes: number, resumedBytes: number): H3DownloadResult => ({
    status: manifest.sha256 || manifest.sha512 ? 'verified' : 'downloaded',
    destination: manifest.destination,
    bytes,
    resumedBytes,
  });
  if ((manifest.sha256 || manifest.sha512) && fs.existsSync(manifest.destination)) {
    try {
      return result(await verify(manifest.destination, manifest, signal), 0);
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || !error.message.startsWith('H3_DOWNLOAD_')) throw error;
    }
  }
  fs.mkdirSync(path.dirname(manifest.destination), { recursive: true });
  const partial = `${manifest.destination}.part`;
  let resumedBytes = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  const promote = async (start: number) => {
    let bytes: number;
    try {
      bytes = await verify(partial, manifest, signal);
    } catch (error) {
      // A corrupt complete file cannot be fixed by appending. Keep short partials for resume.
      if (error instanceof Error && /H3_DOWNLOAD_SHA(256|512)_MISMATCH/.test(error.message)) fs.unlinkSync(partial);
      throw error;
    }
    signal.throwIfAborted();
    fs.renameSync(partial, manifest.destination);
    options.onProgress?.(bytes, manifest.sizeBytes);
    return result(bytes, start);
  };
  if (manifest.sizeBytes !== undefined && fs.existsSync(partial)) {
    if (resumedBytes === manifest.sizeBytes) return promote(resumedBytes);
    if (resumedBytes > manifest.sizeBytes) {
      fs.unlinkSync(partial);
      resumedBytes = 0;
    }
  }
  const headers: Record<string, string> = {
    'Accept-Encoding': 'identity',
    ...(resumedBytes > 0 ? { Range: `bytes=${resumedBytes}-` } : {}),
  };
  const idle = new AbortController();
  const idleMs = options.idleTimeoutMs ?? 30000;
  let timer = setTimeout(() => idle.abort(new Error('H3_DOWNLOAD_IDLE_TIMEOUT')), idleMs);
  const transferSignal = AbortSignal.any([signal, idle.signal]);
  try {
    const response = await (options.fetchImpl ?? fetchH3Download)(manifest.url, { headers, signal: transferSignal });
    const rejectResponse = async (message: string): Promise<never> => {
      await response.body?.cancel();
      throw new Error(message);
    };
    if (response.status !== 200 && response.status !== 206)
      return rejectResponse(`H3_DOWNLOAD_HTTP_${response.status}`);
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      if (
        !match ||
        Number(match[1]) !== resumedBytes ||
        Number(match[2]) < resumedBytes ||
        Number(match[2]) >= Number(match[3]) ||
        (manifest.sizeBytes !== undefined && Number(match[3]) !== manifest.sizeBytes)
      )
        return rejectResponse('H3_DOWNLOAD_RANGE_INVALID');
    }
    if (!response.body) throw new Error('H3_DOWNLOAD_EMPTY_BODY');
    const start = response.status === 206 ? resumedBytes : 0;
    let bytes = start;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new Error('H3_DOWNLOAD_IDLE_TIMEOUT')), idleMs);
        bytes += chunk.length;
        if (manifest.sizeBytes !== undefined && bytes > manifest.sizeBytes) {
          callback(new Error('H3_DOWNLOAD_SIZE_EXCEEDED'));
          return;
        }
        try {
          options.onProgress?.(bytes, manifest.sizeBytes);
          callback(null, chunk);
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    // Pipeline applies backpressure and closes every stream on error/cancellation.
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      fs.createWriteStream(partial, { flags: start > 0 ? 'a' : 'w' }),
      { signal: transferSignal }
    );
    clearTimeout(timer);
    return promote(start);
  } catch (error) {
    if (idle.signal.aborted && !signal.aborted) throw new Error('H3_DOWNLOAD_IDLE_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
