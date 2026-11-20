import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolveMediaBinary } from './mediaBinary';
import { resolveComfyResourcesRoot } from './comfy/planning/catalog';
import { accountMediaFetch } from './cloud/accountMediaChannel';

/** Permit the application renderer, including its exact development origin. */
export function mediaServiceCorsHeaders(origin?: string, rendererUrl?: string): Record<string, string> {
  const allowed = new Set(['http://127.0.0.1:33001']);
  if (rendererUrl) {
    try {
      const url = new URL(rendererUrl);
      if (['http:', 'https:'].includes(url.protocol)) allowed.add(url.origin);
    } catch {
      /* An invalid renderer URL does not grant another origin access. */
    }
  }
  return {
    vary: 'Origin',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-openh3-ui-token',
    ...(!origin || allowed.has(origin) ? { 'access-control-allow-origin': origin ?? 'http://127.0.0.1:33001' } : {}),
  };
}

export type MediaServiceProcessOptions = {
  scriptPath: string;
  dataDir: string;
  bundleRoot?: string;
  resourcesRoot?: string;
  port?: number;
  backendPort?: number;
  accountMediaCapability?: string;
  accountMediaPrivateKey?: string;
  command?: string;
  spawnProcess?: (
    command: string,
    args: string[],
    options: { cwd: string; windowsHide: boolean; env: NodeJS.ProcessEnv; stdio: ['ignore' | 'pipe', number, number] }
  ) => ChildProcess;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class MediaServiceProcess {
  private child?: ChildProcess;
  private ready = false;
  readonly port: number;
  /** Secret accepted only for consent actions initiated by the Electron UI. */
  readonly uiToken = crypto.randomBytes(32).toString('hex');
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly mediaPublicKey?: string;

  constructor(private readonly options: MediaServiceProcessOptions) {
    const configured = options.port ?? process.env.OPENH3_MEDIA_PORT ?? process.env.AIONUI_MEDIA_PORT ?? 33002;
    this.port = Number(configured);
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535)
      throw new Error('MEDIA_SERVICE_PORT_INVALID');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (Boolean(options.accountMediaPrivateKey) !== Boolean(options.accountMediaCapability))
      throw new Error('CLOUD_MEDIA_DESKTOP_IDENTITY_REQUIRED');
    if (options.accountMediaPrivateKey) {
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(options.accountMediaPrivateKey, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      this.mediaPublicKey = crypto
        .createPublicKey(privateKey)
        .export({ format: 'der', type: 'spki' })
        .toString('base64');
    }
  }

  /** Unknown/crashed services cannot authorize an update. */
  get updateEndpoint(): string | null {
    return this.child && this.ready ? `http://127.0.0.1:${this.port}` : null;
  }

  async start(): Promise<void> {
    if (this.child) return;
    if (!fs.existsSync(this.options.scriptPath)) throw new Error('MEDIA_SERVICE_SCRIPT_NOT_FOUND');
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    const logPath = path.join(this.options.dataDir, 'media-service.log');
    const logHandle = fs.openSync(logPath, 'a');
    const command = this.options.command ?? process.execPath;
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // Read at Node startup and inherited by download workers. Adds OS trust
      // to bundled/extra CAs without disabling certificate verification.
      NODE_USE_SYSTEM_CA: process.env.NODE_USE_SYSTEM_CA ?? '1',
      OPENH3_MEDIA_PORT: String(this.port),
      AIONUI_MEDIA_PORT: String(this.port),
      OPENH3_DATA_DIR: this.options.dataDir,
      AIONUI_DATA_DIR: this.options.dataDir,
      OPENH3_RESOURCES_ROOT: resolveComfyResourcesRoot(this.options.resourcesRoot),
      OPENH3_FFMPEG_PATH: resolveMediaBinary('ffmpeg'),
      OPENH3_FFPROBE_PATH: resolveMediaBinary('ffprobe'),
      AIONUI_FFMPEG_PATH: resolveMediaBinary('ffmpeg'),
      AIONUI_FFPROBE_PATH: resolveMediaBinary('ffprobe'),
      OPENH3_MEDIA_UI_TOKEN: this.uiToken,
      OPENH3_MEDIA_OWNED_PIPE: this.options.accountMediaCapability ? '1' : '0',
      OPENH3_MEDIA_UI_ORIGIN: process.env.ELECTRON_RENDERER_URL ?? '',
      AIONUI_MEDIA_UI_TOKEN: this.uiToken,
      ...(this.options.backendPort ? { OPENH3_MEDIA_BACKEND_PORT: String(this.options.backendPort) } : {}),
      ...(this.options.bundleRoot
        ? { OPENH3_H3_BUNDLE_ROOT: this.options.bundleRoot, AIONUI_H3_BUNDLE_ROOT: this.options.bundleRoot }
        : {}),
    };
    const start = this.options.spawnProcess ?? ((file, args, spawnOptions) => spawn(file, args, spawnOptions));
    try {
      this.child = start(command, [this.options.scriptPath], {
        cwd: this.options.dataDir,
        windowsHide: true,
        env,
        stdio: [this.options.accountMediaCapability ? 'pipe' : 'ignore', logHandle, logHandle],
      });
      const launched = this.child;
      this.child.once('exit', () => {
        if (this.child === launched) {
          this.child = undefined;
          this.ready = false;
        }
      });
      this.child.stdin?.on('error', () => {
        /* Closed child transport; recovery starts a new pipe. */
      });
      if (this.options.accountMediaPrivateKey)
        this.child.stdin?.write(JSON.stringify({ privateKey: this.options.accountMediaPrivateKey }) + '\n');
    } finally {
      fs.closeSync(logHandle);
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await this.sleep(250);
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${this.port}/health`);
        if (response.ok && this.child) {
          // The token handshake prevents another instance's healthy listener
          // from being mistaken for the child we just launched.
          if (this.options.backendPort) {
            // Readiness probes must authenticate sequentially before retrying.
            // eslint-disable-next-line no-await-in-loop
            await this.setBackendPort(this.options.backendPort);
          } else if (this.mediaPublicKey) {
            const verified = await accountMediaFetch('/health', {}, undefined, AbortSignal.timeout(5000), {
              port: this.port,
              publicKey: this.mediaPublicKey,
            });
            await verified.body?.cancel();
            if (!verified.ok) continue;
          }
          if (this.child) {
            this.ready = true;
            return;
          }
        }
      } catch {
        /* wait for the child service to bind */
      }
    }
    this.stop();
    throw new Error('MEDIA_SERVICE_START_TIMEOUT');
  }

  /** Refresh Core connectivity after recovery without interrupting media work. */
  async setBackendPort(backendPort: number): Promise<void> {
    if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535)
      throw new Error('MEDIA_SERVICE_BACKEND_PORT_INVALID');
    this.options.backendPort = backendPort;
    if (!this.child) return;
    if (this.options.accountMediaCapability && this.child.stdin?.writable)
      this.child.stdin.write(
        JSON.stringify({
          port: backendPort,
          capability: this.options.accountMediaCapability,
        }) + '\n'
      );
    const headers = { 'content-type': 'application/json', 'x-openh3-ui-token': this.uiToken };
    const body = JSON.stringify({ backendPort });
    const signal = AbortSignal.timeout(5000);
    const response = this.mediaPublicKey
      ? await accountMediaFetch('/api/comfy/runtime-context', headers, body, signal, {
          port: this.port,
          publicKey: this.mediaPublicKey,
        })
      : await this.fetchImpl(`http://127.0.0.1:${this.port}/api/comfy/runtime-context`, {
          method: 'POST',
          headers,
          body,
          signal,
        });
    await response.body?.cancel();
    if (!response.ok) throw new Error('MEDIA_SERVICE_BACKEND_SYNC_FAILED');
  }

  stop(): void {
    this.ready = false;
    this.child?.kill();
    this.child = undefined;
  }
}
