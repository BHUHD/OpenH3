import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyService } from '@/process/services/media/comfy/ComfyService';
import { handleComfyRoute } from '@/process/services/media/comfy/routes';
import type { ComfyProfile } from '@/common/chat/document/creation/comfy';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const task of cleanup.reverse()) await task();
  cleanup.length = 0;
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-http-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifact = path.join(root, 'output.png');
  fs.writeFileSync(artifact, Buffer.from([1, 2, 3, 4]));
  const profile: ComfyProfile = {
    id: 'z-1',
    family: 'z-image',
    name: 'Z',
    kind: 'image',
    version: 'abc123',
    quantization: 'bf16',
    capabilities: ['text-to-image'],
    state: 'downloaded',
    environment: { root, python: path.join(root, 'python'), baseUrl: 'http://127.0.0.1:8188' },
    components: [{ role: 'diffusion', name: 'z', path: path.join(root, 'z'), version: 'abc123', precision: 'bf16' }],
    nodes: [{ id: 'ComfyUI', version: 'v1' }],
    workflowPath: path.join(root, 'api.json'),
    bindings: { prompt: [{ nodeId: '1', input: 'text' }] },
    defaults: {},
  };
  const result = { promptId: 'p', artifacts: [{ path: artifact, mimeType: 'image/png' }] };
  const engine = {
    validate: vi.fn(async () => ({ fingerprint: 'f', loadable: true as const })),
    snapshotFingerprint: vi.fn(async () => 'f'),
    generate: vi.fn(async () => result),
    resume: vi.fn(async () => result),
    ensureStarted: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    stopOwned: vi.fn(),
  };
  const service = new ComfyService({
    filename: path.join(root, 'manifest.json'),
    engine,
    install: vi.fn(),
    verifyArtifact: async (): Promise<void> => undefined,
  });
  const server = http.createServer(async (request, response) => {
    const json = (_response: http.ServerResponse, status: number, value: unknown): void => {
      _response.writeHead(status, { 'content-type': 'application/json' });
      _response.end(JSON.stringify(value));
    };
    const body = async (incoming: http.IncomingMessage): Promise<unknown> => {
      let text = '';
      for await (const chunk of incoming) text += chunk;
      return JSON.parse(text || '{}');
    };
    try {
      if (
        !(await handleComfyRoute(request, response, new URL(request.url ?? '/', 'http://localhost'), {
          service,
          uiToken: 'test-ui-token',
          json,
          body,
        }))
      )
        json(response, 404, {});
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (route: string, payload: unknown): Promise<Response> =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  return { service, engine, base, post, profile };
}
describe('ComfyUI media-service routes', () => {
  it('rejects authorize without the Electron UI capability token', async () => {
    const json = vi.fn();
    const service = {
      operation: vi.fn(() => ({ requestId: crypto.randomUUID(), conversationId: 'chat' })),
      authorize: vi.fn(),
    };
    const handled = await handleComfyRoute(
      { method: 'POST', headers: {} } as http.IncomingMessage,
      {} as http.ServerResponse,
      new URL('http://127.0.0.1/api/comfy/operations/11111111-1111-4111-8111-111111111111/authorize'),
      {
        service: service as never,
        uiToken: 'test-ui-token',
        json,
        body: vi.fn().mockResolvedValue({ requestId: crypto.randomUUID(), conversationId: 'chat' }),
      }
    );

    expect(handled).toBe(true);
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, { error: 'COMFY_UI_AUTH_REQUIRED' });
    expect(service.authorize).not.toHaveBeenCalled();
  });

  it('binds a cloud context without a local family and returns authoritative selection', async () => {
    const { post, base } = await fixture();
    const requestId = crypto.randomUUID();
    expect(
      (await post('/api/comfy/bind', { requestId, conversationId: 'chat', source: 'cloud', kind: 'image' })).status
    ).toBe(200);
    expect(await (await fetch(`${base}/api/comfy/profiles?requestId=${requestId}`)).json()).toMatchObject({
      profiles: [],
      selection: { source: 'cloud', kind: 'image' },
    });
    expect(await (await fetch(base + '/api/comfy/profiles')).json()).toEqual([]);
  });
  it('registers without trusting state and executes explicit verification asynchronously', async () => {
    const { post, base, profile, service } = await fixture();
    const requestId = crypto.randomUUID();
    await post('/api/comfy/bind', {
      requestId,
      conversationId: 'chat',
      source: 'local',
      kind: 'image',
      family: 'z-image',
      intent: 'install',
    });
    expect(
      await (
        await post('/api/comfy/profiles', { requestId, action: 'register', profile: { ...profile, state: 'verified' } })
      ).json()
    ).toMatchObject({ state: 'downloaded' });
    const verification = await post('/api/comfy/profiles', {
      requestId,
      action: 'revalidate',
      profileId: profile.id,
      smokeInput: { prompt: 'small red sphere' },
    });
    expect(verification.status).toBe(202);
    const pending = (await verification.json()) as { comfyJobId: string };
    await service.idle();
    expect((await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId)).status).toBe(400);
    expect((await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId + '/artifacts/0')).status).toBe(400);
    expect((await post('/api/comfy/jobs/' + pending.comfyJobId + '/cancel', {})).status).toBe(400);
    expect((await post('/api/comfy/jobs/' + pending.comfyJobId + '/cancel', { conversationId: 'other' })).status).toBe(
      400
    );
    expect(
      await (await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId + '?conversationId=chat')).json()
    ).toMatchObject({ status: 'succeeded' });
    expect(
      await (await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId + '?requestId=' + requestId)).json()
    ).toMatchObject({
      status: 'succeeded',
    });
    expect(
      (
        await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId + '/artifacts/0?requestId=' + requestId, {
          headers: { range: 'bytes=1-2' },
        })
      ).status
    ).toBe(206);
    const output = await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId + '/artifacts/0?requestId=' + requestId, {
      headers: { range: 'bytes=1-2' },
    });
    expect([...new Uint8Array(await output.arrayBuffer())]).toEqual([2, 3]);
    const mismatch = await fetch(base + '/api/comfy/jobs/' + pending.comfyJobId + '?requestId=' + crypto.randomUUID());
    expect(mismatch.status).toBe(400);
  });
  it('rejects generation for a different session profile and rejects an unbound request', async () => {
    const { post, profile } = await fixture();
    const response = await post('/api/comfy/jobs', {
      requestId: crypto.randomUUID(),
      profileId: profile.id,
      input: { prompt: 'test' },
    });
    expect(await response.json()).toEqual({ error: 'COMFY_CONVERSATION_UNAVAILABLE' });
  });
});
