import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AccountMediaBroker } from '@/process/services/media/cloud/accountMediaBroker';
import { CloudVideoService } from '@/process/services/media/cloud/CloudVideoService';
import { handleCloudVideoRoute } from '@/process/services/media/cloud/routes';
import { accountImage, accountVideo } from '@/process/services/media/cloud/accountMediaTool';
import { accountMediaFetch, desktopChallenge } from '@/process/services/media/cloud/accountMediaChannel';
import { accountMediaId } from '@/common/chat/document/creation/accountMedia';
import { buildSpawnEnv } from '../../../../packages/web-host/src/backend-launcher';
type ToolReply = { content: Array<{ text: string }>; isError?: boolean };
type Callback = (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<ToolReply>;
const registered = vi.hoisted(() => new Map<string, Callback>());
const toolSchemas = vi.hoisted(() => new Map<string, z.ZodRawShape>());
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool(name: string, _description: string, schema: z.ZodRawShape, callback: Callback) {
      registered.set(name, callback);
      toolSchemas.set(name, schema);
    }
    async connect() {}
  },
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class {} }));
const invoke = (name: string, args: Record<string, unknown>) =>
  registered.get(name)!(args, { signal: AbortSignal.timeout(20000) });

const cleanup: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const clean of cleanup.splice(0).toReversed()) clean();
});

it('checks the Core listener and socket before releasing proof, capability or paid inputs', async () => {
  const capability = 'c'.repeat(64);
  let mode: 'valid' | 'wrong-key' | 'wrong-peer' | 'closed-socket' = 'valid';
  const protectedPaths: string[] = [];
  const challenges: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/api/cloud-account/media/challenge') {
      challenges.push(req.headers);
      const signature = createHmac('sha256', mode === 'wrong-key' ? 'old-launch-key' : capability)
        .update(
          [
            'openh3:media:core:v1',
            url.searchParams.get('nonce'),
            req.socket.localPort,
            mode === 'wrong-peer' ? 0 : req.socket.remotePort,
          ].join('\0')
        )
        .digest('base64');
      if (mode === 'closed-socket') res.setHeader('connection', 'close');
      res.end(JSON.stringify({ signature }));
      return;
    }
    protectedPaths.push(url.pathname);
    if (url.pathname === '/api/runtime/conversations/verify') {
      expect(req.headers['x-openh3-runtime-token']).toBe('synthetic-runtime');
      res.writeHead(204).end();
    } else if (url.pathname === '/health') {
      res.setHeader('set-cookie', ['unrelated=a', 'aionui-csrf-token=' + 'f'.repeat(64) + '; Path=/']);
      res.end('healthy');
    } else {
      expect(req.headers['x-openh3-cloud-capability']).toBe(capability);
      expect(req.headers['x-csrf-token']).toBe('f'.repeat(64));
      res.writeHead(200, { 'content-type': 'image/png' }).end('fixture');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  const broker = new AccountMediaBroker(() => ({ port: (server.address() as { port: number }).port, capability }));
  const runtime = { userId: 'system_default_user', conversationId: 'chat', token: 'synthetic-runtime' };
  const image = () => broker.image({ accountId: 'account', modelId: 'image', binding: 'session' }, { prompt: 'paid' });
  await broker.verify(runtime);
  expect(await (await image()).text()).toBe('fixture');
  const legitimate = [...protectedPaths];
  for (const rejected of ['wrong-key', 'wrong-peer', 'closed-socket'] as const) {
    mode = rejected;
    await expect(broker.verify(runtime)).rejects.toThrow('CLOUD_MEDIA_ENDPOINT_UNVERIFIED');
    await expect(image()).rejects.toThrow('CLOUD_MEDIA_ENDPOINT_UNVERIFIED');
  }
  expect(protectedPaths).toEqual(legitimate);
  for (const h of challenges) {
    expect(h['x-openh3-runtime-token']).toBeUndefined();
    expect(h['x-openh3-cloud-capability']).toBeUndefined();
    expect(h.cookie).toBeUndefined();
  }
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-media-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const ref = { accountId: 'subject', modelId: 'img-fixture' };
  const vid = { accountId: 'subject', modelId: 'vid-fixture' };
  const conversationId = 'chat-one';
  let account = ref.accountId;
  let currentGrant = 'grant-subject';
  let statusReads = 0;
  let creation: unknown;
  const firstFrame = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const mp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const csrf = 'f'.repeat(64);
  const receipt = { job_id: 'private-remote-receipt', status: 'queued' };
  const upstream: unknown[] = [];
  const success = (data: unknown) => Response.json({ success: true, data });
  const broker = new AccountMediaBroker(
    () => ({ port: 11, capability: 'media-only' }),
    async (url, init) => {
      const route = new URL(url as string).pathname;
      const h = new Headers(init?.headers);
      if (route === '/api/runtime/conversations/verify')
        return new Response(null, {
          status:
            h.get('x-openh3-runtime-token') === 'valid' && h.get('x-openh3-conversation-id') === conversationId
              ? 204
              : 401,
        });
      if (route === '/api/conversations/' + conversationId)
        return success({ id: conversationId, extra: { creation_request: creation } });
      if (route === '/health')
        return new Response(null, { headers: { 'set-cookie': 'aionui-csrf-token=' + csrf + '; Path=/' } });
      expect(h.get('x-openh3-cloud-capability')).toBe('media-only');
      if (route.endsWith('media/session'))
        return success({ account_id: '42', account_key: account, binding: currentGrant });
      const body = JSON.parse(String(init?.body));
      expect(h.get('cookie')).toBe('aionui-csrf-token=' + csrf);
      expect(h.get('x-csrf-token')).toBe(csrf);
      expect(body.binding).toBe('grant-subject');
      if (route.endsWith('/image')) {
        upstream.push(body);
        return new Response(firstFrame, { headers: { 'content-type': 'image/png' } });
      }
      if (route.endsWith('/video')) {
        upstream.push(body);
        return success(receipt);
      }
      expect(body.job_id).toBe(receipt.job_id);
      if (route.endsWith('/status')) {
        statusReads++;
        if (body.binding !== currentGrant) return Response.json({ code: 'CLOUD_CONFLICT' }, { status: 409 });
        return success({ ...receipt, status: 'completed' });
      }
      if (route.endsWith('/content')) return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
      throw new Error('unexpected fixture route ' + route);
    }
  );
  const key = generateKeyPairSync('ed25519');
  const options = {
    root: path.join(root, 'jobs'),
    accountBroker: broker,
    signChallenge: (challenge: Buffer) => sign(null, challenge, key.privateKey).toString('base64'),
  };
  let service = new CloudVideoService(options);
  const server = http.createServer(async (req, res) => {
    const json = (r: http.ServerResponse, status: number, data: unknown) => {
      r.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    };
    try {
      await handleCloudVideoRoute(req, res, new URL(req.url!, 'http://localhost'), {
        service,
        uiToken: 'ui',
        json,
        body: async (): Promise<unknown> => ({}),
      });
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => {
    service.close();
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as { port: number }).port;
  const launch = buildSpawnEnv(undefined, undefined, 'desktop-owned', {
    port,
    publicKey: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    defaultsFile: path.join(options.root, 'account-defaults.json'),
  });
  vi.stubEnv('OPENH3_DESKTOP_MEDIA_CONTEXT', launch.OPENH3_DESKTOP_MEDIA_CONTEXT);
  vi.stubEnv('OPENH3_MEDIA_PORT', '15'); // Wrong legacy endpoint must never receive runtime credentials.
  vi.stubEnv('OPENH3_CONVERSATION_ID', conversationId);
  vi.stubEnv('OPENH3_USER_ID', 'system_default_user');
  vi.stubEnv('OPENH3_RUNTIME_TOKEN', 'valid');
  vi.stubEnv('OPENH3_CREATION_REQUEST_ID', '');
  vi.stubEnv('OPENH3_MEDIA_WORKSPACE', workspace);
  const api = (p: string, value?: unknown, token?: string) =>
    fetch(`http://127.0.0.1:${port}/api/cloud-video/${p}`, {
      method: value ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-openh3-ui-token': token } : {}) },
      body: value ? JSON.stringify(value) : undefined,
    });
  return {
    workspace,
    conversationId,
    ref,
    vid,
    upstream,
    mp4,
    firstFrame,
    api,
    service: () => service,
    reload: () => {
      service.close();
      service = new CloudVideoService(options);
    },
    switchAccount: () => {
      account = 'another';
      currentGrant = 'grant-another';
    },
    relogin: () => {
      currentGrant = 'fresh-grant-for-same-subject';
    },
    statusReads: () => statusReads,
    setCreation: (value: unknown) => {
      creation = value;
    },
    persisted: () => fs.readFileSync(path.join(options.root, 'cloud-video.json'), 'utf8'),
  };
}

describe('account media selection, execution and artifact delivery', () => {
  it.each(['wrong-key', 'wrong-socket', 'socket-closed'] as const)(
    'withholds the privileged request after an invalid handshake (%s)',
    async (fault) => {
      const identity = generateKeyPairSync('ed25519');
      const responder = fault === 'wrong-key' ? generateKeyPairSync('ed25519') : identity;
      const requests: Array<{ path: string; token?: string }> = [];
      const endpoint = http.createServer((req, res) => {
        const url = new URL(req.url!, 'http://localhost');
        requests.push({ path: url.pathname, token: req.headers['x-openh3-runtime-token'] as string | undefined });
        const nonce = url.searchParams.get('nonce') ?? '';
        res.writeHead(200, {
          'content-type': 'application/json',
          ...(fault === 'socket-closed' ? { connection: 'close' } : {}),
        });
        const challenge = desktopChallenge(
          nonce,
          req.socket.localPort,
          fault === 'wrong-socket' ? 1 : req.socket.remotePort
        );
        res.end(JSON.stringify({ signature: sign(null, challenge, responder.privateKey).toString('base64') }));
      });
      await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
      try {
        const context = {
          port: (endpoint.address() as { port: number }).port,
          publicKey: identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        };
        await expect(
          accountMediaFetch(
            '/api/cloud-video/account-video',
            { 'x-openh3-runtime-token': 'valid' },
            '{}',
            AbortSignal.timeout(3000),
            context
          )
        ).rejects.toThrow('CLOUD_MEDIA_ENDPOINT_UNVERIFIED');
        expect(requests).toEqual([{ path: '/api/cloud-video/account-challenge', token: undefined }]);
      } finally {
        endpoint.closeAllConnections();
        await new Promise<void>((resolve) => endpoint.close(() => resolve()));
      }
    }
  );
  it('delivers an ordinary-chat image and uses its bytes as the first frame of a durable deduplicated video', async () => {
    const f = await fixture();
    await import('@/process/resources/builtinMcp/imageGenServer');
    await import('@/process/resources/builtinMcp/videoMediaServer');
    expect(await accountImage('poster')).toBeUndefined();
    expect((await f.api('account-default')).status).toBe(403);
    for (const [kind, target] of [
      ['image', f.ref],
      ['video', f.vid],
    ] as const) {
      expect((await f.api('account-default', { kind, ...target })).status).toBe(403);
      expect((await f.api('account-default', { kind, ...target }, 'ui')).status).toBe(200);
    }
    const result = await invoke('openh3_image_generation', { prompt: 'poster', width: 512, height: 512 });
    expect(result.isError).not.toBe(true);
    const filename = result.content[0].text.slice('Generated image saved to: '.length);
    expect(path.dirname(filename)).toBe(f.workspace);
    expect(fs.readFileSync(filename)).toEqual(f.firstFrame);
    const id = randomUUID();
    const input = { prompt: 'animate it', duration: 4, imagePaths: [filename] };
    const generation = await invoke('openh3_cloud_video_generate', { input, submissionId: id });
    expect(generation.isError).not.toBe(true);
    const job = JSON.parse(generation.content[0].text).job;
    expect(job).toMatchObject({ model: f.vid.modelId, status: 'queued' });
    expect(job).not.toHaveProperty('remoteId');
    f.reload();
    expect((await accountVideo(input, id)).id).toBe(job.id);
    expect(f.upstream).toEqual([
      { binding: 'grant-subject', model: f.ref.modelId, prompt: 'poster', size: '512x512' },
      {
        binding: 'grant-subject',
        model: f.vid.modelId,
        prompt: 'animate it',
        seconds: 4,
        reference: { mime_type: 'image/png', data: f.firstFrame.toString('base64') },
      },
    ]);
    expect(f.persisted()).not.toMatch(/media-only|animate it|valid|reference|playbackToken/);
    await f.service().poll();
    const jpath = 'jobs/' + job.id;
    const scope = '?conversationId=' + f.conversationId;
    expect((await f.api(jpath + scope)).status).toBe(403);
    const reading = await invoke('openh3_cloud_video_status', { jobId: job.id, waitMs: 0 });
    expect(JSON.parse(reading.content[0].text).job).toMatchObject({ status: 'succeeded' });
    expect(reading.content[0].text).not.toContain('playbackToken');
    const status = await (await f.api(jpath + scope, undefined, 'ui')).json();
    expect(status).toMatchObject({ status: 'succeeded', playbackToken: expect.any(String) });
    expect((await f.api(jpath + '/content' + scope)).status).toBe(403);
    const content = jpath + '/content' + scope + '&playbackToken=' + status.playbackToken;
    expect(Buffer.from(await (await f.api(content)).arrayBuffer())).toEqual(f.mp4);
    f.switchAccount();
    expect((await f.api(content)).status).toBe(400);
    expect((await f.api(jpath + scope, undefined, 'ui')).status).toBe(400);
    await expect(accountImage('changed')).rejects.toThrow('CLOUD_MEDIA_ACCOUNT_CHANGED');
    expect(f.upstream).toHaveLength(2);
  });
  it('limits a newly registered media server to account work, including legacy tool aliases', async () => {
    const f = await fixture();
    vi.stubEnv('OPENH3_MEDIA_ACCOUNT_ONLY', '1');
    vi.resetModules();
    registered.clear();
    await import('@/process/resources/builtinMcp/imageGenServer');
    await import('@/process/resources/builtinMcp/videoMediaServer');
    expect([...registered.keys()].sort()).toEqual([
      'aionui_cloud_video_generate',
      'aionui_cloud_video_status',
      'aionui_image_generation',
      'openh3_cloud_video_generate',
      'openh3_cloud_video_status',
      'openh3_image_generation',
    ]);
    const none = await invoke('aionui_image_generation', { prompt: 'before selection' });
    expect(none).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('CLOUD_MEDIA_NOT_SELECTED') }],
    });
    await f.api('account-default', { kind: 'image', ...f.ref }, 'ui');
    expect((await invoke('aionui_image_generation', { prompt: 'first' })).isError).not.toBe(true);
    expect(
      (await invoke('aionui_cloud_video_generate', { input: { prompt: 'video' }, submissionId: randomUUID() })).isError
    ).toBe(true);
    expect(f.upstream).toHaveLength(1);
  });
  it('pins explicit creation; rejects missing binding, subject, token, edit inputs and omitted scope', async () => {
    const f = await fixture(),
      requestId = randomUUID();
    f.setCreation({ requestId, kind: 'image', source: 'cloud', id: accountMediaId(f.ref.accountId, f.ref.modelId) });
    await import('@/process/resources/builtinMcp/imageGenServer');
    vi.stubEnv('OPENH3_CREATION_KIND', 'image');
    vi.stubEnv('OPENH3_CREATION_SOURCE', 'cloud');
    vi.stubEnv('OPENH3_CREATION_MODEL', accountMediaId(f.ref.accountId, f.ref.modelId));
    expect(await invoke('openh3_image_generation', { prompt: 'poster' })).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('CLOUD_MEDIA_BINDING_REQUIRED') }],
    });
    vi.stubEnv('OPENH3_CREATION_REQUEST_ID', requestId);
    await expect(accountImage('poster')).rejects.toThrow('CLOUD_MEDIA_NOT_SELECTED');
    expect(
      (await f.api('account-bind', { kind: 'image', requestId, conversationId: f.conversationId, ...f.ref }, 'ui'))
        .status
    ).toBe(200);
    await expect(accountImage('change', ['ref.png'])).rejects.toThrow('CLOUD_MEDIA_IMAGE_INPUT_UNSUPPORTED');
    vi.stubEnv('OPENH3_RUNTIME_TOKEN', 'revoked');
    await expect(accountImage('poster')).rejects.toThrow('CLOUD_MEDIA_RUNTIME_REQUIRED');
    vi.stubEnv('OPENH3_RUNTIME_TOKEN', 'valid');
    vi.stubEnv('OPENH3_USER_ID', 'other');
    await expect(accountImage('poster')).rejects.toThrow('CLOUD_MEDIA_RUNTIME_REQUIRED');
    vi.stubEnv('OPENH3_USER_ID', 'system_default_user');
    expect((await invoke('openh3_image_generation', { prompt: 'poster' })).isError).not.toBe(true);
    vi.stubEnv('OPENH3_CREATION_REQUEST_ID', '');
    await f.api('account-default', { kind: 'image', ...f.ref }, 'ui');
    await expect(accountImage('ignore bound selection')).rejects.toThrow('CLOUD_VIDEO_SCOPE_MISMATCH');
    await f.api('account-default', { kind: 'image', modelId: null }, 'ui');
    expect(await accountImage('poster')).toBeUndefined();
    expect(f.upstream).toHaveLength(1);
  });
  it('submits and monitors a bound account video from the ordinary video tool callback', async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const model = accountMediaId(f.vid.accountId, f.vid.modelId);
    f.setCreation({ requestId, kind: 'video', source: 'cloud', id: model });
    vi.stubEnv('OPENH3_CREATION_KIND', 'video');
    vi.stubEnv('OPENH3_CREATION_SOURCE', 'cloud');
    vi.stubEnv('OPENH3_CREATION_MODEL', model);
    vi.stubEnv('OPENH3_CREATION_REQUEST_ID', requestId);
    await import('@/process/resources/builtinMcp/videoMediaServer');
    await f.api('account-bind', { kind: 'video', requestId, conversationId: f.conversationId, ...f.vid }, 'ui');
    const schema = z.object(toolSchemas.get('openh3_cloud_video_generate')!);
    const submissionId = randomUUID();
    expect(schema.safeParse({ input: { prompt: 'timelapse', seed: 0 }, submissionId }).success).toBe(false);
    expect(schema.safeParse({ input: { prompt: 'timelapse', aspectRatio: '16:9' }, submissionId }).success).toBe(false);
    expect(schema.safeParse({ input: { prompt: 'timelapse', duration: 4.4 }, submissionId }).success).toBe(false);
    expect(
      schema.safeParse({ input: { prompt: 'timelapse', imagePaths: ['first.png', 'last.png'] }, submissionId }).success
    ).toBe(false);
    const reply = await invoke('aionui_cloud_video_generate', {
      input: { prompt: 'timelapse', duration: 8, width: 1024, height: 768 },
      submissionId,
    });
    expect(reply.isError).not.toBe(true);
    const { cloudVideoJobId } = JSON.parse(reply.content[0].text);
    expect(f.upstream).toEqual([
      { model: f.vid.modelId, prompt: 'timelapse', binding: 'grant-subject', size: '1024x768', seconds: 8 },
    ]);
    await f.service().poll();
    const status = await invoke('aionui_cloud_video_status', { jobId: cloudVideoJobId, waitMs: 0 });
    expect(JSON.parse(status.content[0].text).job).toMatchObject({
      requestId,
      conversationId: f.conversationId,
      status: 'succeeded',
    });
  });
  it('stops polling an old video grant after logging back into the same account before the next tick', async () => {
    const f = await fixture();
    await f.api('account-default', { kind: 'video', ...f.vid }, 'ui');
    const job = await accountVideo({ prompt: 'first session' }, randomUUID());
    f.relogin();
    await f.service().poll();
    expect(f.service().job(job.id, f.conversationId)).toMatchObject({
      status: 'failed',
      stage: 'failed',
      error: 'CLOUD_CONFLICT',
    });
    expect(f.statusReads()).toBe(1);
    f.reload();
    await f.service().poll();
    expect(f.statusReads()).toBe(1);
    expect(f.upstream).toHaveLength(1);
  });
});
