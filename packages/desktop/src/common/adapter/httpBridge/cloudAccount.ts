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
