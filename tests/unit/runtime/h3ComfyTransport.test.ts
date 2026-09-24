import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';
import { H3ComfyClient } from '@/process/services/runtime/H3ComfyClient';

async function fixture(mode: 'events' | 'disconnect' | 'missing' | 'error') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-transport-'));
  const workflowPath = path.join(directory, 'workflow.json');
  fs.writeFileSync(workflowPath, JSON.stringify({ '1': { class_type: 'TestNode', inputs: {} } }));
  let submissions = 0, histories = 0, clientId = '', connectedId = '';
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/object_info/')) { res.end(JSON.stringify(mode === 'missing' ? {} : { TestNode: { input: {}, output: [] } })); return; }
    if (req.url === '/prompt') {
      submissions++; let body = ''; for await (const part of req) body += part;
      clientId = JSON.parse(body).client_id;
      res.end(JSON.stringify({ prompt_id: 'mine' })); return;
    }
    if (req.url === '/history/mine') {
      histories++;
      if (histories === 1) {
        res.end('{}');
        setTimeout(() => {
          for (const ws of sockets.clients) {
            if (mode === 'disconnect') { ws.close(); continue; }
            ws.send(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'other' } }));
            ws.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'mine', value: 2, max: 4 } }));
            ws.send(JSON.stringify(mode === 'error' ? { type: 'execution_error', data: { prompt_id: 'mine', node_id: '1', exception_type: 'torch.OutOfMemoryError' } } : { type: 'execution_success', data: { prompt_id: 'mine' } }));
          }
        }, 10);
      } else res.end(JSON.stringify({ mine: { status: { completed: true }, outputs: { out: { videos: [{ filename: 'result.mp4', type: 'output' }] } } } }));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (_socket, req) => { connectedId = new URL(req.url!, 'http://local').searchParams.get('clientId')!; });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    client: new H3ComfyClient({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, workflowPath, pollIntervalMs: 5, eventCheckIntervalMs: 1000 }),
    stats: () => ({ submissions, histories, clientId, connectedId }),
    close: async () => { for (const ws of sockets.clients) ws.terminate(); await new Promise<void>((resolve) => sockets.close(() => resolve())); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

describe('H3 preflight and WebSocket transport integration', () => {
  it.each(['events', 'disconnect'] as const)('completes through %s with one submission and authoritative history', async (mode) => {
    const test = await fixture(mode); const progress: number[] = [];
    try {
      const result = await test.client.generate({ prompt: 'test' }, new AbortController().signal, (v) => progress.push(v));
      expect(result.artifacts[0].filename).toBe('result.mp4');
      const stats = test.stats(); expect(stats.submissions).toBe(1); expect(stats.histories).toBe(2);
      expect(stats.clientId).toBe(stats.connectedId); expect(stats.clientId).not.toBe('aionui-video-agent');
      if (mode === 'events') expect(progress).toContain(0.525);
    } finally { await test.close(); }
  });
  it('blocks missing nodes before submitting any GPU work', async () => {
    const test = await fixture('missing');
    try { await expect(test.client.generate({ prompt: 'test' }, new AbortController().signal)).rejects.toThrow('MISSING_NODE'); expect(test.stats().submissions).toBe(0); }
    finally { await test.close(); }
  });
  it('turns execution errors into diagnosis without waiting for history', async () => {
    const test = await fixture('error');
    try { await expect(test.client.generate({ prompt: 'test' }, new AbortController().signal)).rejects.toThrow('OOM'); expect(test.stats().histories).toBe(1); }
    finally { await test.close(); }
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
    } finally { await test.close(); }
  });
});
