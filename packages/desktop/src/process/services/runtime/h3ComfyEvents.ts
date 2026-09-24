import WebSocket from 'ws';
export type ComfyEvent = {
  type: string;
  data: { prompt_id: string; value?: number; max?: number; [key: string]: unknown };
};

/** A connection belongs to one submission. History remains the authoritative output source. */
export class H3ComfyEvents {
  private socket?: WebSocket;
  private queue: ComfyEvent[] = [];
  private wake?: () => void;
  private readonly abort = (): void => this.close();
  connected = false;
  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly signal: AbortSignal,
    private readonly nodeTypes: Record<string, string> = {}
  ) {}

  async open(): Promise<void> {
    if (this.signal.aborted) return;
    const url = new URL(`${this.baseUrl}/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('clientId', this.clientId);
    const socket = (this.socket = new WebSocket(url, { handshakeTimeout: 3000, maxPayload: 4 * 1024 * 1024 }));
    this.signal.addEventListener('abort', this.abort, { once: true });
    socket.on('message', (raw, binary) => {
      if (binary) return;
      try {
        const event = JSON.parse(raw.toString()) as ComfyEvent;
        if (typeof event.type !== 'string' || typeof event.data?.prompt_id !== 'string') return;
        if (
          !['executing', 'progress', 'execution_success', 'execution_error', 'execution_interrupted'].includes(
            event.type
          )
        )
          return;
        if (typeof event.data.node === 'string') event.data.node_type = this.nodeTypes[event.data.node];
        if (this.queue.length >= 256) this.queue.shift();
        this.queue.push(event);
        this.wake?.();
      } catch {
        /* Binary previews and malformed messages cannot change task state. */
      }
    });
    socket.on('close', () => {
      this.connected = false;
      this.wake?.();
    });
    socket.on('error', () => {
      this.connected = false;
      this.wake?.();
    });
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        socket.off('open', opened);
        socket.off('error', finish);
        socket.off('close', finish);
        resolve();
      };
      const opened = (): void => {
        this.connected = true;
        finish();
      };
      socket.once('open', opened);
      socket.once('error', finish);
      socket.once('close', finish);
    });
  }

  async next(promptId: string, timeoutMs: number): Promise<ComfyEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      while (this.queue.length) {
        const event = this.queue.shift()!;
        if (event.data.prompt_id === promptId) return event;
      }
      if (!this.connected || this.signal.aborted || Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          this.wake = undefined;
          resolve();
        };
        const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
        this.wake = done;
      });
    }
  }

  close(): void {
    this.signal.removeEventListener('abort', this.abort);
    this.connected = false;
    this.wake?.();
    this.queue = [];
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}
