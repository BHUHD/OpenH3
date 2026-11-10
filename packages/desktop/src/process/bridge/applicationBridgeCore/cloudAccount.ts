import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { CloudAccountRequest, CloudAccountResponse } from '@/common/types/platform/cloudAccount';
import { safeCloudError } from '@/common/adapter/httpBridge/cloudAccount';

const operations = {
  capabilities: ['GET', 'capabilities', []],
  session: ['GET', 'session', []],
  me: ['GET', 'me', []],
  devices: ['GET', 'devices', []],
  logout: ['POST', 'logout', []],
  emailCode: ['POST', 'email-code', ['email', 'purpose']],
  register: ['POST', 'register', ['username', 'email', 'password', 'verification_code']],
  login: ['POST', 'login', ['username', 'password']],
  verify: ['POST', 'auth/verify', ['challenge_id', 'method', 'code', 'password']],
  passwordReset: ['POST', 'password/reset', ['email', 'code']],
  passwordResetComplete: ['POST', 'password/reset/complete', ['challenge_id', 'new_password']],
  revokeDevice: ['POST', 'devices/revoke', ['device_id']],
} as const;

/** Require the owned top-level frame and an exact approved document URL. */
export function trustedCloudSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  owner: WebContents | undefined,
  allowedUrls: readonly string[]
): boolean {
  const documentUrl = (value: string): string => {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.href;
    } catch {
      return '';
    }
  };
  const allowed = allowedUrls.map(documentUrl).filter(Boolean);
  return (
    !!owner &&
    !owner.isDestroyed() &&
    event.sender === owner &&
    event.senderFrame === owner.mainFrame &&
    allowed.includes(documentUrl(owner.getURL())) &&
    allowed.includes(documentUrl(event.senderFrame.url))
  );
}

/** Runtime allowlist also rejects extra top-level fields and nested input objects. */
export function cloudOperation(request: unknown): { method: string; path: string; body?: string } | null {
  if (
    !request ||
    typeof request !== 'object' ||
    !('operation' in request) ||
    typeof request.operation !== 'string' ||
    !Object.hasOwn(operations, request.operation)
  )
    return null;
  if (Object.keys(request).some((key) => key !== 'operation' && key !== 'input')) return null;
  const [method, path, keys] = operations[request.operation as keyof typeof operations];
  const input = 'input' in request ? request.input : {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (
    Object.entries(input).some(
      ([key, value]) => !(keys as readonly string[]).includes(key) || typeof value !== 'string' || value.length > 16384
    )
  )
    return null;
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > 16384) return null;
  return { method, path, ...(method === 'POST' ? { body } : {}) };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Cloud account request failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 65536) throw new Error('Cloud account request failed');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel();
  }
}

/** Main-only client. CSRF is bootstrapped from Core and never exposed to preload. */
export function createCloudAccountClient(
  port: () => number,
  capability: string,
  fetcher: typeof fetch = fetch
): (request: CloudAccountRequest) => Promise<CloudAccountResponse> {
  let csrf: string | undefined;
  let csrfPort: number | undefined;
  return async (request) => {
    const operation = cloudOperation(request);
    if (!operation) return safeCloudError({ code: 'CLOUD_INPUT_INVALID' });
    const currentPort = port();
    if (!Number.isInteger(currentPort) || currentPort < 1 || currentPort > 65535) return safeCloudError(null);
    if (csrfPort !== currentPort) {
      csrf = undefined;
      csrfPort = currentPort;
    }
    const base = `http://127.0.0.1:${currentPort}/api/cloud-account/`;
    try {
      const headers: Record<string, string> = { 'x-openh3-cloud-capability': capability };
      if (operation.method === 'POST') {
        if (!csrf) {
          const bootstrap = await fetcher(`http://127.0.0.1:${currentPort}/health`, {
            redirect: 'error',
            signal: AbortSignal.timeout(25000),
          });
          if (bootstrap.status === 401 || bootstrap.status === 403) return safeCloudError(await boundedJson(bootstrap));
          const cookie = bootstrap.headers.getSetCookie().find((v) => v.startsWith('aionui-csrf-token='));
          csrf = cookie?.split(';')[0].slice('aionui-csrf-token='.length);
          // Health is entirely local: logout never waits for remote refresh.
          if (!csrf || !/^[a-f0-9]{64}$/.test(csrf)) return safeCloudError(await boundedJson(bootstrap));
          await bootstrap.body?.cancel();
        }
        headers.Cookie = `aionui-csrf-token=${csrf}`;
        headers['x-csrf-token'] = csrf;
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetcher(`${base}${operation.path}`, {
        method: operation.method,
        headers,
        body: operation.body,
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
      });
      const body = await boundedJson(response);
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        return { ...safeCloudError(body), ...(retry && /^\d{1,5}$/.test(retry) ? { retry_after: Number(retry) } : {}) };
      }
      // Successful Core responses are exclusively renderer-safe public DTOs.
      if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true || !('data' in body))
        return safeCloudError(null);
      return { success: true, data: body.data as Extract<CloudAccountResponse, { success: true }>['data'] };
    } catch {
      return safeCloudError(null);
    }
  };
}
