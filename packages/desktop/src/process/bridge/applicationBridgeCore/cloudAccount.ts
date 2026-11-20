import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { accountMediaCatalog } from '@/common/chat/document/creation/accountMedia';
import type { CloudAccountRequest, CloudAccountResponse } from '@/common/types/platform/cloudAccount';
import {
  cloudCheckout,
  cloudSuccessLimit,
  readCloudJson,
  safeCloudError,
} from '@/common/adapter/httpBridge/cloudAccount';

const operations = {
  topupOptions: ['POST', 'topup/options', []],
  topupQuote: ['POST', 'topup/quote', ['amount', 'payment_method']],
  topupCreate: ['POST', 'topup/create', ['amount', 'payment_method', 'quote_version', 'idempotency_key']],
  topupCreateAndOpen: ['POST', 'topup/create', ['amount', 'payment_method', 'quote_version', 'idempotency_key']],
  topupOrders: ['POST', 'topup/orders', ['order_id', 'before_id', 'page_size', 'status']],
  capabilities: ['GET', 'capabilities', []],
  session: ['GET', 'session', []],
  me: ['GET', 'me', []],
  devices: ['GET', 'devices', []],
  wallet: ['GET', 'wallet', []],
  models: ['GET', 'models', []],
  mediaModels: ['GET', 'media-models', []],
  usage: ['POST', 'usage', ['page', 'page_size', 'start_time', 'end_time', 'model', 'device_id']],
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
  if (request.operation.startsWith('topup')) {
    const v = Object.fromEntries(Object.entries(input));
    if (Object.keys(v).some((key) => !(keys as readonly string[]).includes(key))) return null;
    if (request.operation === 'topupOrders') {
      if (v.order_id !== undefined && (typeof v.order_id !== 'string' || Buffer.byteLength(v.order_id) > 64))
        return null;
      if (
        v.status !== undefined &&
        (typeof v.status !== 'string' || !['', 'pending', 'paid', 'failed', 'expired'].includes(v.status))
      )
        return null;
      for (const key of ['before_id', 'page_size']) {
        const value = v[key];
        if (
          value !== undefined &&
          (typeof value !== 'number' ||
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value > (key === 'page_size' ? 50 : Number.MAX_SAFE_INTEGER))
        )
          return null;
      }
    } else if (request.operation !== 'topupOptions') {
      if (
        typeof v.amount !== 'number' ||
        !Number.isSafeInteger(v.amount) ||
        v.amount < 1 ||
        typeof v.payment_method !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(v.payment_method)
      )
        return null;
      if (
        request.operation !== 'topupQuote' &&
        (typeof v.quote_version !== 'string' ||
          Buffer.byteLength(v.quote_version) !== 64 ||
          typeof v.idempotency_key !== 'string' ||
          !/^[A-Za-z0-9_-]{16,64}$/.test(v.idempotency_key))
      )
        return null;
    }
  } else if (request.operation === 'usage') {
    const values = Object.fromEntries(Object.entries(input));
    if (Object.keys(values).some((key) => !(keys as readonly string[]).includes(key))) return null;
    for (const [key, value] of Object.entries(values)) {
      if (key === 'model' || key === 'device_id') {
        if (typeof value !== 'string' || Buffer.byteLength(value) > (key === 'model' ? 256 : 64)) return null;
      } else if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < (key === 'page' || key === 'page_size' ? 1 : 0) ||
        value > (key === 'page' ? 1000000 : key === 'page_size' ? 100 : Number.MAX_SAFE_INTEGER)
      )
        return null;
    }
    if (
      typeof values.end_time === 'number' &&
      values.end_time !== 0 &&
      values.end_time < (typeof values.start_time === 'number' ? values.start_time : 0)
    )
      return null;
  } else if (
    Object.entries(input).some(
      ([key, value]) => !(keys as readonly string[]).includes(key) || typeof value !== 'string' || value.length > 16384
    )
  )
    return null;
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > 16384) return null;
  return { method, path, ...(method === 'POST' ? { body } : {}) };
}

/** Main-only client. CSRF is bootstrapped from Core and never exposed to preload. */
export function createCloudAccountClient(
  port: () => number,
  capability: string,
  fetcher: typeof fetch = fetch,
  openCheckout?: (url: string) => Promise<void>
): (request: CloudAccountRequest) => Promise<CloudAccountResponse> {
  let epoch = 0;
  let csrf: string | undefined;
  let csrfPort: number | undefined;
  return async (request) => {
    const operation = cloudOperation(request);
    if (!operation) return safeCloudError({ code: 'CLOUD_INPUT_INVALID' });
    // Close the main-response/open gap when a local identity action is in flight.
    if (['login', 'logout', 'passwordResetComplete', 'revokeDevice', 'verify'].includes(request.operation)) epoch++;
    const originalEpoch = epoch;
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
          if (bootstrap.status === 401 || bootstrap.status === 403)
            return safeCloudError(await readCloudJson(bootstrap));
          const cookie = bootstrap.headers.getSetCookie().find((v) => v.startsWith('aionui-csrf-token='));
          csrf = cookie?.split(';')[0].slice('aionui-csrf-token='.length);
          // Health is entirely local: logout never waits for remote refresh.
          if (!csrf || !/^[a-f0-9]{64}$/.test(csrf)) return safeCloudError(await readCloudJson(bootstrap));
          await bootstrap.body?.cancel();
        }
        headers.Cookie = `aionui-csrf-token=${csrf}`;
        headers['x-csrf-token'] = csrf;
        headers['Content-Type'] = 'application/json';
      }
      if (request.operation.startsWith('topup') && originalEpoch !== epoch)
        return safeCloudError({ code: 'CLOUD_CONFLICT' });
      const response = await fetcher(`${base}${operation.path}`, {
        method: operation.method,
        headers,
        body: operation.body,
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
      });
      // Finite per-operation success limits; errors and credentials stay 64 KiB.
      const body = await readCloudJson(response, cloudSuccessLimit(operation.path));
      if (request.operation.startsWith('topup') && originalEpoch !== epoch)
        return safeCloudError({ code: 'CLOUD_CONFLICT' });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        return { ...safeCloudError(body), ...(retry && /^\d{1,5}$/.test(retry) ? { retry_after: Number(retry) } : {}) };
      }
      // Successful Core responses are exclusively renderer-safe public DTOs.
      if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true || !('data' in body))
        return safeCloudError(null);
      if (request.operation.startsWith('topup') && originalEpoch !== epoch)
        return safeCloudError({ code: 'CLOUD_CONFLICT' });
      if (request.operation === 'mediaModels') {
        if (originalEpoch !== epoch) return safeCloudError({ code: 'CLOUD_CONFLICT' });
        const catalog = accountMediaCatalog.safeParse(body.data);
        return catalog.success ? { success: true, data: catalog.data } : safeCloudError({ code: 'CLOUD_PROTOCOL' });
      }
      if (request.operation === 'topupCreateAndOpen') {
        const url = cloudCheckout(body.data, request.input);
        // Retain the committed order context, never the signed URL, on opener failure.
        const { checkout_url: _checkout, ...order } =
          body.data as import('@/common/types/platform/cloudAccount').CloudTopupOrder;
        if (!url || !openCheckout) return { ...safeCloudError({ code: 'CLOUD_CHECKOUT_UNAVAILABLE' }), order };
        try {
          await openCheckout(url);
        } catch {
          if (originalEpoch !== epoch) return safeCloudError({ code: 'CLOUD_CONFLICT' });
          return { ...safeCloudError({ code: 'CLOUD_CHECKOUT_OPEN_FAILED' }), order };
        }
        if (originalEpoch !== epoch) return safeCloudError({ code: 'CLOUD_CONFLICT' });
        return { success: true, data: order };
      }
      return { success: true, data: body.data as Extract<CloudAccountResponse, { success: true }>['data'] };
    } catch {
      if (request.operation.startsWith('topup') && originalEpoch !== epoch)
        return safeCloudError({ code: 'CLOUD_CONFLICT' });
      return safeCloudError(null);
    }
  };
}
