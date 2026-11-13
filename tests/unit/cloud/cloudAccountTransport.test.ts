import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { hasSpecificModelCapability } from '@/common/utils/modelCapabilities';
import type { IProvider } from '@/common/config/storage';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  cloudOperation,
  createCloudAccountClient,
  trustedCloudSender,
} from '@/process/bridge/applicationBridgeCore/cloudAccount';
import { browserCloudCheckout, validCloudCheckoutUrl } from '@/common/adapter/httpBridge/cloudAccount';
import type { CloudTopupCreateInput, CloudTopupOrder } from '@/common/types/platform/cloudAccount';
import { BackendHttpError, httpRequest } from '@/common/adapter/httpBridge';
import { buildSpawnEnv } from '../../../packages/web-host/src/backend-launcher';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native account transport', () => {
  it('uses explicit official capabilities while preserving BYOK name matching', () => {
    const official = {
      managed_by: 'cloud_account',
      models: ['gpt-4o', 'plain-id'],
      model_settings: { 'gpt-4o': { supports_tools: false }, 'plain-id': { supports_tools: true } },
    } as unknown as IProvider;
    expect(hasSpecificModelCapability(official, 'gpt-4o', 'vision')).toBe(false);
    expect(hasSpecificModelCapability(official, 'gpt-4o', 'function_calling')).toBe(false);
    expect(hasSpecificModelCapability(official, 'plain-id', 'function_calling')).toBe(true);
    expect(hasSpecificModelCapability(official, 'unverified', 'text')).toBe(false);
    expect(hasSpecificModelCapability({} as IProvider, 'gpt-4o', 'vision')).toBe(true);
  });
  it('reads a legitimate large catalog over loopback and bounds declared, chunked and error bodies', async () => {
    for (const variant of ['large', 'declared', 'chunked', 'error'] as const) {
      let calls = 0;
      const server = createServer((request, response) => {
        calls++;
        expect(request.method).toBe('GET');
        expect(request.url).toBe('/api/cloud-account/models');
        expect(request.headers['x-openh3-cloud-capability']).toBe('synthetic-capability');
        if (variant === 'declared') {
          response.writeHead(200, { 'content-length': String(8 * 1024 * 1024 + 1) });
          response.flushHeaders();
          return;
        }
        const payload = JSON.stringify(
          variant === 'error'
            ? { code: 'CLOUD_AUTH_REQUIRED', error: 'x'.repeat(70000) }
            : {
                success: true,
                data: {
                  status: 'available',
                  models: [
                    {
                      model_id: 'verified-model',
                      display_name: 'Verified',
                      provider: 'Loopback',
                      purpose: 'text',
                      protocol: 'ChatCompletions',
                      input_capabilities: ['text'],
                      supports_tools: true,
                      context_limit: 4096,
                      max_output_tokens: 64,
                      compatibility_version: 'fixture-v1',
                      evidence: 'x'.repeat(variant === 'large' ? 100000 : 8 * 1024 * 1024),
                      quotes: [
                        {
                          group: 'default',
                          kind: 'request',
                          unit: 'USD_per_request',
                          group_ratio: '1',
                          cache_write_mode: 'none',
                          version: 'v1',
                          quota_per_usd: '500000',
                          per_request: '0',
                        },
                      ],
                    },
                  ],
                  quote_semantics: 'observed_rules_not_frozen_final_charge',
                },
              }
        );
        response.writeHead(variant === 'error' ? 401 : 200, { 'content-type': 'application/json' });
        response.write(payload.slice(0, 50000));
        response.end(payload.slice(50000));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test listener');
      try {
        const client = createCloudAccountClient(() => address.port, 'synthetic-capability');
        const result = await client({ operation: 'models' });
        expect(result.success).toBe(variant === 'large');
        if (!result.success) expect(result.code).toBe('CLOUD_TRANSPORT');
        expect(calls).toBe(1);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
  });
  it('admits exact topup operations', () => {
    expect(cloudOperation({ operation: 'topupOptions' })).toEqual({
      method: 'POST',
      path: 'topup/options',
      body: '{}',
    });
    expect(cloudOperation({ operation: 'topupQuote', input: { amount: 10, payment_method: 'alipay' } })).toEqual({
      method: 'POST',
      path: 'topup/quote',
      body: '{"amount":10,"payment_method":"alipay"}',
    });
  });
  it('admits only bounded typed billing reads using fixed operations', () => {
    expect(cloudOperation({ operation: 'wallet' })).toEqual({ method: 'GET', path: 'wallet' });
    expect(cloudOperation({ operation: 'models' })).toEqual({ method: 'GET', path: 'models' });
    expect(
      cloudOperation({
        operation: 'usage',
        input: { page: 2, page_size: 100, start_time: 1, end_time: 2, model: 'm', device_id: 'd' },
      })
    ).toEqual({
      method: 'POST',
      path: 'usage',
      body: '{"page":2,"page_size":100,"start_time":1,"end_time":2,"model":"m","device_id":"d"}',
    });
    for (const input of [
      { page: '1' },
      { page: 0 },
      { page: 1000001 },
      { page: 1.5 },
      { page_size: 101 },
      { start_time: -1 },
      { start_time: 2, end_time: 1 },
      { model: '模'.repeat(86) },
      { device_id: 'd'.repeat(65) },
      { headers: {} },
      { page: null },
    ]) {
      expect(cloudOperation({ operation: 'usage', input })).toBeNull();
    }
  });
  it('does not proceed past local-auth bootstrap rejection even with a cookie', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"code":"LOCAL_AUTH_REQUIRED"}', {
        status: 401,
        headers: { 'set-cookie': `aionui-csrf-token=${'c'.repeat(64)}; Path=/` },
      })
    );
    const client = createCloudAccountClient(() => 1234, 'synthetic-capability', fetcher);
    expect(await client({ operation: 'logout' })).toMatchObject({ success: false, code: 'LOCAL_AUTH_REQUIRED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bootstraps through local health so logout has no remote prerequisite', async () => {
    const csrf = 'b'.repeat(64);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"status":"ok"}', {
          headers: { 'set-cookie': `aionui-csrf-token=${csrf}; Path=/` },
        })
      )
      .mockResolvedValueOnce(new Response('{"success":true,"data":{"remote_revocation":"unconfirmed"}}'));
    const client = createCloudAccountClient(() => 1234, 'synthetic-capability', fetcher);
    expect(await client({ operation: 'logout' })).toEqual({
      success: true,
      data: { remote_revocation: 'unconfirmed' },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:1234/api/cloud-account/logout');
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ 'x-csrf-token': csrf });
  });

  it('requires desktop IPC and never falls back to direct HTTP', async () => {
    vi.stubGlobal('window', { __backendPort: 1234 });
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    await expect(httpRequest('GET', '/api/cloud-account/session')).rejects.toMatchObject({
      code: 'LOCAL_AUTH_REQUIRED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sanitizes network failures and retains only numeric retry metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('SENTINEL-network'))
      .mockResolvedValueOnce(
        new Response('{"code":"CLOUD_RATE_LIMITED","error":"SENTINEL"}', {
          status: 429,
          headers: { 'retry-after': '23' },
        })
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(httpRequest('GET', '/api/cloud-account/session')).rejects.toMatchObject({
      code: 'CLOUD_TRANSPORT',
      backendMessage: 'Cloud account request failed',
    });
    await expect(httpRequest('GET', '/api/cloud-account/session')).rejects.toMatchObject({
      code: 'CLOUD_RATE_LIMITED',
      details: { retry_after: 23 },
    });
  });

  it('requires the owned main frame and exact trusted renderer URL', () => {
    const url = 'file:///app/renderer/index.html';
    const frame = { url };
    const owner = { mainFrame: frame, getURL: () => url, isDestroyed: () => false } as unknown as WebContents;
    const event = { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    expect(trustedCloudSender(event, owner, [url])).toBe(true);
    expect(trustedCloudSender(event, undefined, [url])).toBe(false);
    expect(trustedCloudSender({ ...event, sender: {} as WebContents }, owner, [url])).toBe(false);
    expect(
      trustedCloudSender({ ...event, senderFrame: { url } as IpcMainInvokeEvent['senderFrame'] }, owner, [url])
    ).toBe(false);
    expect(trustedCloudSender(event, owner, ['https://other.example'])).toBe(false);
    frame.url = `${url}#/settings/account`;
    expect(trustedCloudSender(event, owner, [url])).toBe(true);
    frame.url = `${url}?SENTINEL`;
    expect(trustedCloudSender(event, owner, [url])).toBe(false);
  });

  it('accepts only native operation fields', () => {
    expect(cloudOperation({ operation: 'login', input: { username: 'alice', password: 'secret' } })).toEqual({
      method: 'POST',
      path: 'login',
      body: '{"username":"alice","password":"secret"}',
    });
    for (const request of [
      null,
      { operation: '__proto__' },
      { operation: 'wallet', input: { owner: 'other' } },
      { operation: 'session', headers: {} },
      { operation: 'login', input: { owner: 'other' } },
      { operation: 'login', input: { password: {} } },
      { operation: 'login', input: { password: 'x'.repeat(20000) } },
    ])
      expect(cloudOperation(request)).toBeNull();
  });

  it('bootstraps real CSRF, keeps it in main, bounds fetch, and never replays auth failures', async () => {
    const csrf = 'a'.repeat(64);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"success":true,"data":{"state":"disconnected"}}', {
          headers: { 'set-cookie': `aionui-csrf-token=${csrf}; Path=/` },
        })
      )
      .mockResolvedValueOnce(
        new Response('{"code":"CLOUD_VERIFICATION_FAILED","error":"SENTINEL","details":{"token":"SENTINEL"}}', {
          status: 401,
        })
      );
    const client = createCloudAccountClient(() => 1234, 'synthetic-capability', fetcher);
    const result = await client({ operation: 'login', input: { username: 'alice', password: 'submitted-password' } });
    expect(result).toEqual({
      success: false,
      code: 'CLOUD_VERIFICATION_FAILED',
      error: 'Cloud account request failed',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:1234/health');
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      redirect: 'error',
      method: 'POST',
      headers: {
        Cookie: `aionui-csrf-token=${csrf}`,
        'x-csrf-token': csrf,
        'x-openh3-cloud-capability': 'synthetic-capability',
      },
    });
    expect(fetcher.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });

  it('fails safely on oversized or malformed responses and preserves retry timing', async () => {
    for (const body of ['SENTINEL', 'SENTINEL'.repeat(10000)]) {
      const client = createCloudAccountClient(
        () => 1234,
        'test',
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
      );
      expect(await client({ operation: 'session' })).toEqual({
        success: false,
        code: 'CLOUD_TRANSPORT',
        error: 'Cloud account request failed',
      });
    }
    const client = createCloudAccountClient(
      () => 1234,
      'test',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('{"code":"CLOUD_RATE_LIMITED"}', { status: 429, headers: { 'retry-after': '17' } })
        )
    );
    expect(await client({ operation: 'session' })).toMatchObject({ code: 'CLOUD_RATE_LIMITED', retry_after: 17 });
  });

  it('excludes cloud secrets and paths from logs and errors, with no generic replay', async () => {
    const logs = [
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{"error":"SENTINEL-raw","code":"SENTINEL-code"}', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    for (const path of [
      '/api/cloud-account/login',
      '/api/cloud-account/SENTINEL?SENTINEL=SENTINEL',
      '/api/cloud-accountSENTINEL',
    ]) {
      await expect(httpRequest('POST', path, { password: 'SENTINEL', code: 'SENTINEL' })).rejects.toMatchObject({
        code: 'CLOUD_TRANSPORT',
      });
      const error = new BackendHttpError({ method: 'POST', path, status: 401, body: { error: 'SENTINEL' } });
      expect(`${error.message}${JSON.stringify(error)}`).not.toContain('SENTINEL');
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain('SENTINEL');
  });

  it('strips inherited capability and injects only explicitly owned child configuration', () => {
    const previous = process.env.OPENH3_CLOUD_ACCOUNT_CAPABILITY;
    process.env.OPENH3_CLOUD_ACCOUNT_CAPABILITY = 'synthetic-inherited';
    try {
      expect(buildSpawnEnv()).not.toHaveProperty('OPENH3_CLOUD_ACCOUNT_CAPABILITY');
      expect(buildSpawnEnv(undefined, undefined, 'synthetic-owned').OPENH3_CLOUD_ACCOUNT_CAPABILITY).toBe(
        'synthetic-owned'
      );
      expect(process.env.OPENH3_CLOUD_ACCOUNT_CAPABILITY).toBe('synthetic-inherited');
    } finally {
      if (previous === undefined) delete process.env.OPENH3_CLOUD_ACCOUNT_CAPABILITY;
      else process.env.OPENH3_CLOUD_ACCOUNT_CAPABILITY = previous;
    }
  });
});

const topupIntent: CloudTopupCreateInput = {
  amount: 10,
  payment_method: 'alipay',
  quote_version: 'b'.repeat(64),
  idempotency_key: 'stable-original-key',
};
function topupOrder(): CloudTopupOrder {
  return {
    amount: 10,
    amount_unit: 'USD',
    payment_method: 'alipay',
    provider: 'epay_v1',
    payable_money: '71.23',
    currency: 'CNY',
    credited_quota: '5000000',
    quota_unit: 'new_api_quota',
    conversion_version: 'a'.repeat(64),
    quote_version: 'b'.repeat(64),
    fee_scope: 'gateway_payable_total',
    order_id: 'NATIVEoriginal',
    owner_id: '42',
    status: 'pending',
    created_at: 100,
    completed_at: 0,
    handoff_expires_at: Math.floor(Date.now() / 1000) + 3600,
    handoff_status: 'available',
    expiry_scope: 'local_handoff_only',
    checkout_url:
      'https://pay.example/submit.php?sign=SIGNED_SENTINEL&money=71.23&notify_url=https%3A%2F%2Fgateway.example%2Fnotify',
  };
}
function csrfResponse(): Response {
  return new Response('{}', { headers: { 'set-cookie': `aionui-csrf-token=${'c'.repeat(64)}; Path=/` } });
}
function coreTopupResponse(order = topupOrder()): Response {
  return new Response(JSON.stringify({ success: true, data: order }), {
    headers: { 'content-type': 'application/json' },
  });
}
describe('native topup handoff', () => {
  it('rejects malformed integer/shape/owner/quote inputs before local I/O', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createCloudAccountClient(() => 1234, 'cap', fetcher);
    for (const input of [
      { ...topupIntent, amount: 0 },
      { ...topupIntent, amount: -1 },
      { ...topupIntent, amount: 1.5 },
      { ...topupIntent, amount: Number.MAX_SAFE_INTEGER + 1 },
      { ...topupIntent, amount: '10' },
      { ...topupIntent, payment_method: [] },
      { ...topupIntent, quote_version: '短'.repeat(64) },
      { ...topupIntent, idempotency_key: 'short' },
      { ...topupIntent, owner_id: '99' },
      { ...topupIntent, payable_money: '0.01' },
      { ...topupIntent, url: 'SIGNED_SENTINEL' },
    ]) {
      expect(cloudOperation({ operation: 'topupCreate', input })).toBeNull();
    }
    expect(await client({ operation: 'topupCreate', input: { ...topupIntent, amount: 0 } })).toMatchObject({
      success: false,
      code: 'CLOUD_INPUT_INVALID',
    });
    expect(fetcher).not.toHaveBeenCalled();
    for (const input of [
      { before_id: -1 },
      { before_id: Number.MAX_SAFE_INTEGER + 1 },
      { page_size: 51 },
      { page_size: null },
      { status: [] },
      { status: 'success' },
      { order_id: '模'.repeat(22) },
    ])
      expect(cloudOperation({ operation: 'topupOrders', input })).toBeNull();
    expect(cloudOperation({ operation: 'topupOrders', input: { before_id: 0, page_size: 0, status: '' } })?.path).toBe(
      'topup/orders'
    );
  });
  it('opens only the exact returned signed HTTPS URL through injected main opener, with fixed failure and frozen order context', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrfResponse())
      .mockImplementation(async () => coreTopupResponse());
    const opener = vi
      .fn<(url: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('SIGNED_SENTINEL https://pay.example/?sign=SIGNED_SENTINEL'))
      .mockResolvedValueOnce();
    const client = createCloudAccountClient(() => 1234, 'cap', fetcher, opener);
    const failed = await client({ operation: 'topupCreateAndOpen', input: topupIntent });
    expect(failed).toMatchObject({
      success: false,
      code: 'CLOUD_CHECKOUT_OPEN_FAILED',
      order: { order_id: 'NATIVEoriginal', payable_money: '71.23' },
    });
    expect(JSON.stringify(failed)).not.toContain('SIGNED_SENTINEL');
    const replay = await client({ operation: 'topupCreateAndOpen', input: topupIntent });
    expect(replay).toMatchObject({ success: true, data: { order_id: 'NATIVEoriginal' } });
    expect(JSON.stringify(replay)).not.toContain('checkout_url');
    expect(opener).toHaveBeenNthCalledWith(1, topupOrder().checkout_url);
    expect(opener).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:1234/api/cloud-account/topup/create');
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[2][1]?.body);
    expect(JSON.stringify([...debug.mock.calls, ...error.mock.calls])).not.toContain('SIGNED_SENTINEL');
  });
  it('never opens mismatched, expired, paid or sensitive checkout handoffs', async () => {
    const opener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
    for (const change of [
      { amount: 11 },
      { quote_version: 'c'.repeat(64) },
      { status: 'paid' as const },
      { handoff_status: 'expired' as const },
      { checkout_url: 'https://user:pass@pay.example/' },
      { checkout_url: 'https://pay.example/?merchant_key=SIGNED_SENTINEL' },
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(coreTopupResponse({ ...topupOrder(), ...change }));
      const result = await createCloudAccountClient(
        () => 1234,
        'cap',
        fetcher,
        opener
      )({ operation: 'topupCreateAndOpen', input: topupIntent });
      expect(result).toMatchObject({ success: false, code: 'CLOUD_CHECKOUT_UNAVAILABLE' });
      expect(JSON.stringify(result)).not.toContain('SIGNED_SENTINEL');
    }
    expect(opener).not.toHaveBeenCalled();
  });
  it('fences A while a Core response or opener settles after logout, on success and rejection', async () => {
    for (const phase of ['fetch', 'fetch401', 'fetchReject', 'open', 'reject'] as const) {
      let settle: (() => void) | undefined;
      let entered: (() => void) | undefined;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(csrfResponse())
        .mockImplementation(async (url) => {
          if (String(url).endsWith('/logout'))
            return new Response('{"success":true,"data":{"remote_revocation":"unconfirmed"}}');
          if (phase === 'fetch' || phase === 'fetch401' || phase === 'fetchReject') {
            entered?.();
            await new Promise<void>((resolve) => {
              settle = resolve;
            });
          }
          if (phase === 'fetch401') return new Response('{"code":"CLOUD_AUTH_REQUIRED"}', { status: 401 });
          if (phase === 'fetchReject') throw new Error('SIGNED_SENTINEL');
          return coreTopupResponse();
        });
      const opener = vi.fn<(url: string) => Promise<void>>().mockImplementation(async () => {
        entered?.();
        await new Promise<void>((resolve) => {
          settle = resolve;
        });
        if (phase === 'reject') throw new Error('SIGNED_SENTINEL');
      });
      const client = createCloudAccountClient(() => 1234, 'cap', fetcher, opener);
      const pending = client({ operation: 'topupCreateAndOpen', input: topupIntent });
      await waiting;
      await client({ operation: 'logout' });
      settle?.();
      expect(await pending).toEqual({ success: false, code: 'CLOUD_CONFLICT', error: 'Cloud account request failed' });
      expect(opener).toHaveBeenCalledTimes(phase.startsWith('fetch') ? 0 : 1);
    }
  });
  it('keeps quote, wallet-capacity and temporary errors distinct without replay', async () => {
    for (const [status, code] of [
      [409, 'CLOUD_TOPUP_CONFLICT'],
      [409, 'CLOUD_WALLET_CAPACITY'],
      [503, 'CLOUD_TOPUP_UNAVAILABLE'],
      [401, 'CLOUD_AUTH_REQUIRED'],
    ] as const) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(new Response(JSON.stringify({ code, error: 'SIGNED_SENTINEL' }), { status }));
      const result = await createCloudAccountClient(
        () => 1234,
        'cap',
        fetcher
      )({ operation: 'topupCreate', input: topupIntent });
      expect(result).toMatchObject({ success: false, code });
      expect(JSON.stringify(result)).not.toContain('SIGNED_SENTINEL');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it('uses a browser-local second click with exact signed bytes, fixed failure and no payment proof', () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal('window', { open });
    const order = topupOrder();
    const click = browserCloudCheckout(order, topupIntent);
    expect(open).not.toHaveBeenCalled();
    expect(click()).toBe(true);
    expect(open).toHaveBeenCalledWith(order.checkout_url, '_blank', 'noopener,noreferrer');
    open.mockImplementation(() => {
      throw new Error('SIGNED_SENTINEL');
    });
    expect(click()).toBe(false);
    for (const url of [
      'https:pay.example/',
      'https://@pay.example/',
      'http://pay.example/',
      'https://user@pay.example/',
      'https://pay.example/#x',
      'https://pay.example/\\x',
      'https://pay.example/?key=x',
      'https://pay.example/?x=%0A',
      'https://pay.example/\n',
      'https://pay.example/' + 'x'.repeat(8192),
      'bad',
    ])
      expect(validCloudCheckoutUrl(url)).toBe(false);
    expect(order.status).toBe('pending');
  });
});

describe('bounded WebUI topup HTTP', () => {
  it('bounds actual declared/chunked/error replies and retains a legitimate 96-quote options list', async () => {
    const originalFetch = globalThis.fetch;
    const logs = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const variant of ['valid', 'declared', 'chunked', 'error', '401', 'deadline', 'redirect'] as const) {
      let calls = 0;
      const server = createServer((request, response) => {
        calls++;
        expect(request.url).toBe('/api/cloud-account/topup/options');
        expect(request.method).toBe('POST');
        if (variant === 'deadline') return;
        if (variant === 'redirect') {
          response.writeHead(302, { location: '/redirected' });
          response.end();
          return;
        }
        if (variant === 'declared') {
          response.writeHead(200, { 'content-length': String(128 * 1024 + 1) });
          response.flushHeaders();
          return;
        }
        const {
          order_id: _id,
          owner_id: _owner,
          status: _status,
          created_at: _created,
          completed_at: _completed,
          handoff_expires_at: _expiry,
          handoff_status: _handoff,
          expiry_scope: _scope,
          checkout_url: _url,
          ...quote
        } = topupOrder();
        const data = {
          status: 'available',
          options: ['alipay', 'wxpay', 'qqpay'].flatMap((payment_method) =>
            Array.from({ length: 32 }, (_, i) => ({ ...quote, payment_method, amount: i + 1 }))
          ),
          unsupported_providers: ['stripe', 'creem', 'waffo', 'waffo_pancake'],
        };
        const body =
          variant === 'error'
            ? JSON.stringify({ code: 'CLOUD_TOPUP_UNAVAILABLE', error: 'SIGNED_SENTINEL'.repeat(6000) })
            : variant === '401'
              ? JSON.stringify({ code: 'CLOUD_AUTH_REQUIRED', error: 'SIGNED_SENTINEL' })
              : variant === 'chunked'
                ? JSON.stringify({ success: true, data: 'SIGNED_SENTINEL'.repeat(10000) })
                : JSON.stringify({ success: true, data });
        response.writeHead(variant === 'error' ? 503 : variant === '401' ? 401 : 200, {
          'content-type': 'application/json',
        });
        response.write(body.slice(0, 20000));
        response.end(body.slice(20000));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('fixture listener missing');
      vi.stubGlobal('window', { location: { protocol: 'https:', host: 'web.example' } });
      vi.stubGlobal('document', { cookie: 'aionui-csrf-token=browser-csrf' });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation((url, options) => originalFetch('http://127.0.0.1:' + address.port + String(url), options));
      vi.stubGlobal('fetch', fetcher);
      const deadline =
        variant === 'deadline'
          ? vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
              const controller = new AbortController();
              setTimeout(() => controller.abort(), 20);
              return controller.signal;
            })
          : undefined;
      try {
        if (variant === 'valid') {
          const result = await httpRequest<{ options: unknown[] }>('POST', '/api/cloud-account/topup/options', {});
          expect(result.options).toHaveLength(96);
        } else
          await expect(httpRequest('POST', '/api/cloud-account/topup/options', {})).rejects.toMatchObject({
            code:
              variant === '401'
                ? 'CLOUD_AUTH_REQUIRED'
                : variant === 'deadline' || variant === 'redirect'
                  ? 'CLOUD_TRANSPORT'
                  : 'CLOUD_PROTOCOL',
            backendMessage: 'Cloud account request failed',
          });
        expect(calls).toBe(1);
        expect(fetcher.mock.calls[0][1]).toMatchObject({
          redirect: 'error',
          credentials: 'include',
          headers: { 'x-csrf-token': 'browser-csrf' },
        });
        expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
      } finally {
        deadline?.mockRestore();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
    expect(JSON.stringify(logs.mock.calls)).not.toContain('SIGNED_SENTINEL');
  });
});
