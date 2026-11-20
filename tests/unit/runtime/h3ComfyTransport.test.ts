import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { createH3Job } from '@/common/chat/document/h3Job';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';
import type { H3Activity } from '@/common/chat/document/h3Job';
import { H3ComfyClient } from '@/process/services/runtime/H3ComfyClient';

// Node's fetch rejects these ports before opening a socket. A port returned by
// listen(0) can occasionally land in this list on a busy Windows runner.
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

async function listenOnFetchSafePort(server: ReturnType<typeof createServer>) {
  while (true) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    if (!FETCH_BLOCKED_PORTS.has(port)) return port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function fixture(mode: 'events' | 'disconnect' | 'missing' | 'error' | 'held') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-transport-'));
  const workflowPath = path.join(directory, 'workflow.json');
  fs.writeFileSync(workflowPath, JSON.stringify({ '1': { class_type: 'TestNode', inputs: {} } }));
  let submissions = 0,
    histories = 0,
    clientId = '',
    connectedId = '';
  let completed = mode !== 'held';
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/object_info/')) {
      res.end(JSON.stringify(mode === 'missing' ? {} : { TestNode: { input: {}, output: [] } }));
      return;
    }
    if (req.url === '/prompt') {
      submissions++;
      let body = '';
      for await (const part of req) body += part;
      clientId = JSON.parse(body).client_id;
      res.end(JSON.stringify({ prompt_id: 'mine' }));
      return;
    }
    if (req.url === '/system_stats') {
      res.end('{}');
      return;
    }
    if (req.url === '/history/mine') {
      histories++;
      if (!completed) {
        res.end('{}');
      } else if (mode !== 'held' && histories === 1) {
        res.end('{}');
        setTimeout(() => {
          for (const ws of sockets.clients) {
            if (mode === 'disconnect') {
              ws.close();
              continue;
            }
            ws.send(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'other' } }));
            ws.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'mine', value: 2, max: 4 } }));
            ws.send(
              JSON.stringify(
                mode === 'error'
                  ? {
                      type: 'execution_error',
                      data: { prompt_id: 'mine', node_id: '1', exception_type: 'torch.OutOfMemoryError' },
                    }
                  : { type: 'execution_success', data: { prompt_id: 'mine' } }
              )
            );
          }
        }, 10);
      } else
        res.end(
          JSON.stringify({
            mine: {
              status: { completed: true },
              outputs: { out: { videos: [{ filename: 'result.mp4', type: 'output' }] } },
            },
          })
        );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (_socket, req) => {
    connectedId = new URL(req.url!, 'http://local').searchParams.get('clientId')!;
  });
  const port = await listenOnFetchSafePort(server);
  return {
    workflowPath,
    hold: () => {
      completed = false;
    },
    complete: () => {
      completed = true;
    },
    client: new H3ComfyClient({
      baseUrl: `http://127.0.0.1:${port}`,
      workflowPath,
      pollIntervalMs: 5,
      eventCheckIntervalMs: 1000,
    }),
    stats: () => ({ submissions, histories, clientId, connectedId }),
    close: async () => {
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function startMediaService(directory: string, backendUrl: string, workflowPath?: string) {
  const reservation = createServer();
  const port = await listenOnFetchSafePort(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const serviceFile = path.join(directory, 'service.cjs');
  await build({
    entryPoints: ['scripts/media-service.ts'],
    outfile: serviceFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent',
    tsconfig: 'tsconfig.json',
  });
  const child = spawn(process.execPath, [serviceFile], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      NODE_PATH: path.resolve('node_modules'),
      AIONUI_DATA_DIR: directory,
      AIONUI_MEDIA_PORT: String(port),
      AIONUI_H3_URL: backendUrl,
      AIONUI_H3_WORKFLOW: workflowPath,
    },
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics += String(data);
  });
  const request = (route: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${route}`, { ...init, signal: AbortSignal.timeout(10_000) });
  return {
    request,
    ready: async () => {
      await expect
        .poll(
          async () => {
            const response = await request('/api/h3/versions').catch(() => undefined);
            await response?.text();
            return response?.status;
          },
          { timeout: 5_000, message: 'Media service did not start' }
        )
        .toBe(200)
        .catch((error: Error) => {
          throw new Error(`${error.message}\n${diagnostics}`, { cause: error });
        });
    },
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await exited;
    },
  };
}

describe('H3 preflight and WebSocket transport integration', () => {
  it('enforces the persisted barrier through the real media-service HTTP routes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-service-loop-'));
    let present = true;
    const backend = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url?.endsWith('/cancel')
            ? { cancelled: true }
            : req.url === '/queue'
              ? { queue_running: present ? [[0, 'remote']] : [], queue_pending: [] }
              : {}
        )
      );
    });
    const backendPort = await listenOnFetchSafePort(backend);
    fs.writeFileSync(
      path.join(directory, 'h3-jobs.json'),
      JSON.stringify([
        { ...createH3Job({ prompt: 'test' }, 'blocked'), status: 'failed', promptId: 'remote', remoteUncertain: true },
      ])
    );
    const service = await startMediaService(directory, `http://127.0.0.1:${backendPort}`);
    const { request } = service;
    try {
      await service.ready();
      const missing = await request('/api/h3/jobs/missing');
      expect(missing.status).toBe(404);
      await missing.text();
      for (const route of ['/api/h3/jobs', '/api/h3/free-memory']) {
        const response = await request(route, { method: 'POST', body: JSON.stringify({ prompt: 'replacement' }) });
        expect(response.status).toBe(409);
        await response.text();
      }
      const failedCancel = await request('/api/h3/jobs/blocked?action=cancel', { method: 'POST' });
      expect(failedCancel.status).toBe(400);
      expect(await failedCancel.json()).toMatchObject({ error: 'H3_COMFY_CANCEL_UNCONFIRMED' });
      expect(await (await request('/api/h3/jobs/blocked')).json()).toMatchObject({ remoteUncertain: true });
      present = false;
      const stopped = await request('/api/h3/jobs/blocked?action=cancel', { method: 'POST' });
      expect(await stopped.json()).toMatchObject({ status: 'failed', remoteUncertain: false });
      const stream = await request('/api/h3/jobs/blocked/events');
      expect(await stream.text()).toContain('"remoteUncertain":false');
    } finally {
      await service.close();
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('preserves the submitted parent when the selected version changes during generation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-lineage-'));
    const backend = await fixture('held');
    fs.writeFileSync(
      path.join(directory, 'h3-versions.json'),
      JSON.stringify([
        { id: 'a', jobId: 'job-a', parentId: null, selected: true, label: 'A', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'b', jobId: 'job-b', parentId: 'a', selected: false, label: 'B', createdAt: '2026-01-01T00:00:01Z' },
      ])
    );
    fs.writeFileSync(
      path.join(directory, 'h3-jobs.json'),
      JSON.stringify([{ ...createH3Job({ prompt: 'Generate A' }, 'job-a'), status: 'succeeded' }])
    );
    const service = await startMediaService(directory, backend.client.getBaseUrl(), backend.workflowPath);
    const { request } = service;
    const post = (route: string, body: object) => request(route, { method: 'POST', body: JSON.stringify(body) });
    try {
      await service.ready();
      const submission = await post('/api/h3/jobs', { prompt: 'Generate C' });
      expect(submission.status).toBe(201);
      const { id } = await submission.json();
      const selectB = await post('/api/h3/versions/select', { id: 'b', expectedSelectedId: 'a' });
      expect(selectB.status).toBe(200);
      await selectB.text();
      backend.complete();

      await expect
        .poll(async () => (await (await request('/api/h3/versions')).json()).length, { timeout: 10_000 })
        .toBe(3);
      const versions = await (await request('/api/h3/versions')).json();
      expect(versions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'b', selected: true }),
          expect.objectContaining({ jobId: id, parentId: 'a', selected: false, review: 'candidate' }),
        ])
      );
      expect(await (await request(`/api/h3/jobs/${id}`)).json()).toMatchObject({
        status: 'succeeded',
        parentVersionId: 'a',
      });
      const candidate = versions.find((version: { jobId: string }) => version.jobId === id);
      const selectC = await post('/api/h3/versions/select', { id: candidate.id, expectedSelectedId: 'b' });
      expect(selectC.status).toBe(200);
      expect(await selectC.json()).toContainEqual(
        expect.objectContaining({ id: candidate.id, parentId: 'a', previousSelectedId: 'b', selected: true })
      );
      expect(await (await post('/api/h3/versions/undo', {})).json()).toContainEqual(
        expect.objectContaining({ id: 'b', selected: true })
      );

      backend.hold();
      const derivation = await post('/api/h3/versions/a/derive', { prompt: 'Derive from A' });
      expect(derivation.status).toBe(201);
      const derivedJob = await derivation.json();
      expect(derivedJob).toMatchObject({ parentVersionId: 'a' });
      expect((await post('/api/h3/versions/select', { id: 'a', expectedSelectedId: 'b' })).status).toBe(200);
      backend.complete();
      await expect
        .poll(async () => (await (await request('/api/h3/versions')).json()).length, { timeout: 10_000 })
        .toBe(4);
      expect(await (await request('/api/h3/versions')).json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'a', selected: true }),
          expect.objectContaining({ jobId: derivedJob.id, parentId: 'a', selected: false }),
        ])
      );
    } finally {
      await service.close();
      await backend.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it.each(['events', 'disconnect'] as const)(
    'completes through %s with one submission and authoritative history',
    async (mode) => {
      const test = await fixture(mode);
      const progress: number[] = [];
      const activities: H3Activity[] = [];
      try {
        const result = await test.client.generate({ prompt: 'test' }, new AbortController().signal, (v, activity) => {
          progress.push(v);
          if (activity) activities.push(activity);
        });
        expect(result.artifacts[0].filename).toBe('result.mp4');
        const stats = test.stats();
        expect(stats.submissions).toBe(1);
        expect(stats.histories).toBe(2);
        expect(stats.clientId).toBe(stats.connectedId);
        expect(stats.clientId).not.toBe('aionui-video-agent');
        expect(progress.slice(0, -1).every((v) => v === 0)).toBe(true);
        expect(progress.at(-1)).toBe(1);
        if (mode === 'events')
          expect(activities).toContainEqual(expect.objectContaining({ phase: 'node-progress', value: 2, max: 4 }));
      } finally {
        await test.close();
      }
    }
  );
  it('blocks missing nodes before submitting any GPU work', async () => {
    const test = await fixture('missing');
    try {
      await expect(test.client.generate({ prompt: 'test' }, new AbortController().signal)).rejects.toThrow(
        'MISSING_NODE'
      );
      expect(test.stats().submissions).toBe(0);
    } finally {
      await test.close();
    }
  });
  it('turns execution errors into diagnosis without waiting for history', async () => {
    const test = await fixture('error');
    try {
      await expect(test.client.generate({ prompt: 'test' }, new AbortController().signal)).rejects.toThrow('OOM');
      expect(test.stats().histories).toBe(1);
    } finally {
      await test.close();
    }
  });
  it('fails explicitly when a ComfyUI restart loses the remote history', async () => {
    const test = await fixture('disconnect');
    try {
      const client = new H3ComfyClient({
        baseUrl: test.client.getBaseUrl(),
        workflowPath: `${process.cwd()}/nonexistent.json`,
        maxWaitMs: 1,
      });
      await expect(client.resume('lost-prompt', new AbortController().signal)).rejects.toMatchObject({
        message: 'H3_COMFY_HISTORY_TIMEOUT',
      });
    } finally {
      await test.close();
    }
  });
});
