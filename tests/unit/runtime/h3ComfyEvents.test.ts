import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { H3ComfyEvents } from '@/process/services/runtime/h3ComfyEvents';
const servers: WebSocketServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function pair() {
  const server = new WebSocketServer({ port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const incoming = new Promise<any>((resolve) => server.once('connection', resolve));
  const events = new H3ComfyEvents(`http://127.0.0.1:${port}`, 'unique-client', new AbortController().signal);
  await events.open();
  return { events, socket: await incoming };
}
describe('Comfy events', () => {
  it('buffers early messages and isolates prompt IDs and binary previews', async () => {
    const { events, socket } = await pair();
    try {
      socket.send(Buffer.from([1, 2, 3]));
      socket.send(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'other' } }));
      socket.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'mine', value: 2, max: 4 } }));
      expect(await events.next('mine', 1000)).toMatchObject({ type: 'progress', data: { value: 2 } });
      socket.send(JSON.stringify({ type: 'executing', data: { prompt_id: 'mine', node: '125' } }));
      expect(await events.next('mine', 1000)).toMatchObject({ type: 'executing', data: { node: '125' } });
      socket.send(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'mine' } }));
      expect(await events.next('mine', 1000)).toMatchObject({ type: 'execution_success' });
    } finally {
      events.close();
    }
  });
  it('wakes a pending waiter on disconnect', async () => {
    const { events, socket } = await pair();
    const waiting = events.next('mine', 10000);
    socket.close();
    expect(await waiting).toBeNull();
    expect(events.connected).toBe(false);
    events.close();
  });
});
