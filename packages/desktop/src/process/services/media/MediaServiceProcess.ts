import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

export type MediaServiceProcessOptions = {
  scriptPath: string;
  dataDir: string;
  bundleRoot?: string;
  port?: number;
  command?: string;
  spawnProcess?: (command: string, args: string[], options: { cwd: string; windowsHide: boolean; env: NodeJS.ProcessEnv; stdio: ['ignore', number, number] }) => ChildProcess;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class MediaServiceProcess {
  private child?: ChildProcess;
  private readonly port: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: MediaServiceProcessOptions) {
    this.port = options.port ?? 33002;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async start(): Promise<void> {
    if (this.child) return;
    if (!fs.existsSync(this.options.scriptPath)) throw new Error('MEDIA_SERVICE_SCRIPT_NOT_FOUND');
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    const logPath = path.join(this.options.dataDir, 'media-service.log');
    const logHandle = fs.openSync(logPath, 'a');
    const command = this.options.command ?? process.execPath;
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', AIONUI_MEDIA_PORT: String(this.port), AIONUI_DATA_DIR: this.options.dataDir, ...(this.options.bundleRoot ? { AIONUI_H3_BUNDLE_ROOT: this.options.bundleRoot } : {}) };
    const start = this.options.spawnProcess ?? ((file, args, spawnOptions) => spawn(file, args, spawnOptions));
    try {
      this.child = start(command, [this.options.scriptPath], { cwd: this.options.dataDir, windowsHide: true, env, stdio: ['ignore', logHandle, logHandle] });
      this.child.once('exit', () => { this.child = undefined; });
    } finally {
      fs.closeSync(logHandle);
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await this.sleep(250);
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${this.port}/health`);
        if (response.ok) return;
      } catch { /* wait for the child service to bind */ }
    }
    this.stop();
    throw new Error('MEDIA_SERVICE_START_TIMEOUT');
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
  }
}
