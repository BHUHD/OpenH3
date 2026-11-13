import type { CloudTopupCreateInput, CloudTopupOrder } from '@/common/types/platform/cloudAccount';

/** Cloud paths are never logged verbatim or retried by generic auth refresh. */
export function isCloudAccountPath(path: string): boolean {
  return path.startsWith('/api/cloud-account');
}

const SAFE_CODES = new Set([
  'APP_UPDATE_PENDING',
  'LOCAL_AUTH_REQUIRED',
  'CSRF_INVALID',
  'CLOUD_ORIGIN_INVALID',
  'CLOUD_INPUT_INVALID',
  'CLOUD_AUTH_REQUIRED',
  'CLOUD_VERIFICATION_FAILED',
  'CLOUD_POLICY',
  'CLOUD_RATE_LIMITED',
  'CLOUD_TRANSPORT',
  'CLOUD_PROTOCOL',
  'CLOUD_CONFLICT',
  'CLOUD_STORAGE',
  'CLOUD_TOPUP_CONFLICT',
  'CLOUD_WALLET_CAPACITY',
  'CLOUD_TOPUP_UNAVAILABLE',
  'CLOUD_CHECKOUT_UNAVAILABLE',
  'CLOUD_CHECKOUT_OPEN_FAILED',
  'CLOUD_NOT_FOUND',
  'CLOUD_METHOD_INVALID',
]);

/** Discard raw errors and arbitrary details even if an intermediary returns HTML. */
export function safeCloudError(body: unknown): {
  success: false;
  code: string;
  error: string;
  details?: { retry_after: number };
} {
  const code =
    body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' && SAFE_CODES.has(body.code)
      ? body.code
      : 'CLOUD_TRANSPORT';
  const details = body && typeof body === 'object' && 'details' in body ? body.details : undefined;
  const retry = details && typeof details === 'object' && 'retry_after' in details ? details.retry_after : undefined;
  return {
    success: false,
    code,
    error: 'Cloud account request failed',
    ...(typeof retry === 'number' && Number.isInteger(retry) && retry >= 0 && retry <= 86400
      ? { details: { retry_after: retry } }
      : {}),
  };
}

/** Validate without normalizing: signed query bytes must survive unchanged. */
export function validCloudCheckoutUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('https://') ||
    value.slice(8).split(/[/?#]/, 1)[0].includes('@') ||
    value.length > 8192 ||
    /[\s\p{Cc}\\#]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return false;
    for (const [key, parameter] of url.searchParams) {
      if (
        /^(key|api_key|merchant_key|access_token|refresh_token|inference_key|authorization|password)$/i.test(key) ||
        /[\p{Cc}\\]/u.test(parameter)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
/** Bind handoff to a validated create result and the deliberate original terms. */
export function cloudCheckout(order: unknown, intent: CloudTopupCreateInput): string | undefined {
  if (!order || typeof order !== 'object') return undefined;
  const o = order as Partial<CloudTopupOrder>;
  if (
    o.amount !== intent.amount ||
    o.payment_method !== intent.payment_method ||
    o.quote_version !== intent.quote_version ||
    o.provider !== 'epay_v1' ||
    o.status !== 'pending' ||
    o.handoff_status !== 'available' ||
    o.expiry_scope !== 'local_handoff_only' ||
    typeof o.order_id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(o.order_id) ||
    typeof o.owner_id !== 'string' ||
    !o.owner_id ||
    typeof o.handoff_expires_at !== 'number' ||
    !Number.isSafeInteger(o.handoff_expires_at) ||
    o.handoff_expires_at * 1000 <= Date.now() ||
    !validCloudCheckoutUrl(o.checkout_url)
  )
    return undefined;
  return o.checkout_url;
}
/** Browser-local deliberate second click; no Core/server OS opener or persistence.
 * Keep the returned closure only in transient UI state and discard on identity changes.
 * Opening/returning never proves payment. Local expiry never cancels remote checkout.
 */
export function browserCloudCheckout(order: CloudTopupOrder, intent: CloudTopupCreateInput): () => boolean {
  const url = cloudCheckout(order, intent);
  const expires = order.handoff_expires_at;
  return () => {
    if (!url || expires * 1000 <= Date.now()) return false;
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  };
}

/** Finite practical operation caps. Credential and failure bodies stay at 64 KiB. */
export function cloudSuccessLimit(path: string): number {
  switch (path) {
    case 'models':
      return 8 * 1024 * 1024;
    case 'wallet':
      return 512 * 1024;
    case 'usage':
      return 2 * 1024 * 1024;
    case 'topup/options':
    case 'topup/orders':
      return 128 * 1024;
    default:
      return 65536;
  }
}
/** Browser/main compatible bounded reader; no parser or stream error details escape. */
export async function readCloudJson(response: Response, successLimit = 65536): Promise<unknown> {
  const limit = response.ok ? successLimit : 65536;
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new Error('Cloud account request failed');
  }
  if (!response.body) throw new Error('Cloud account request failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new Error('Cloud account request failed');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Cloud account request failed');
  } finally {
    await reader.cancel().catch(() => {});
  }
}
