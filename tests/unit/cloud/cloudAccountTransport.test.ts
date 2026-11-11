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
