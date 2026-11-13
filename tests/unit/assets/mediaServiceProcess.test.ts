import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaServiceProcess, mediaServiceCorsHeaders } from '@/process/services/media/MediaServiceProcess';

describe('media service process', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['0', '-1', '65536', '19342.5', 'invalid'])('rejects an invalid configured port %s', (port) => {
    vi.stubEnv('OPENH3_MEDIA_PORT', port);
    expect(() => new MediaServiceProcess({ scriptPath: '', dataDir: '' })).toThrow('MEDIA_SERVICE_PORT_INVALID');
  });

  it('preserves the legacy port setting and lets an explicit port take precedence', () => {
    vi.stubEnv('OPENH3_MEDIA_PORT', undefined);
    vi.stubEnv('AIONUI_MEDIA_PORT', '19342');
    expect(new MediaServiceProcess({ scriptPath: '', dataDir: '' }).port).toBe(19342);
    expect(new MediaServiceProcess({ scriptPath: '', dataDir: '', port: 19344 }).port).toBe(19344);
  });

  it('uses the configured port for the child, readiness and recovery endpoints', async () => {
    vi.stubEnv('OPENH3_MEDIA_PORT', '19342');
    vi.stubEnv('AIONUI_MEDIA_PORT', '19399');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-service-port-'));
    const scriptPath = path.join(root, 'media-service.js');
    fs.writeFileSync(scriptPath, '');
    let childPort: string | undefined;
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const manager = new MediaServiceProcess({
      scriptPath,
      dataDir: root,
      backendPort: 13422,
      sleep: async () => undefined,
      fetchImpl,
      spawnProcess: (_command, _args, options) => {
        childPort = options.env.AIONUI_MEDIA_PORT;
        return { once: () => undefined, kill: () => undefined } as never;
      },
    });
    try {
      await manager.start();
      expect(childPort).toBe('19342');
      expect(manager.port).toBe(19342);
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:19342/health');
      expect(fetchImpl).toHaveBeenCalledWith(
        'http://127.0.0.1:19342/api/comfy/runtime-context',
        expect.objectContaining({ headers: expect.objectContaining({ 'x-openh3-ui-token': manager.uiToken }) })
      );
    } finally {
      manager.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects another instance even when its health endpoint is healthy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-service-identity-'));
    const scriptPath = path.join(root, 'media-service.js');
    fs.writeFileSync(scriptPath, '');
    const kill = vi.fn();
    const manager = new MediaServiceProcess({
      scriptPath,
      dataDir: root,
      backendPort: 13422,
      sleep: async () => undefined,
      fetchImpl: async (url) => new Response('{}', { status: String(url).endsWith('/health') ? 200 : 403 }),
      spawnProcess: () => ({ once: () => undefined, kill }) as never,
    });
    try {
      await expect(manager.start()).rejects.toThrow('MEDIA_SERVICE_START_TIMEOUT');
      expect(kill).toHaveBeenCalledOnce();
    } finally {
      manager.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows the actual development renderer without allowing arbitrary origins', () => {
    expect(mediaServiceCorsHeaders('http://localhost:5173', 'http://localhost:5173/')).toMatchObject({
      'access-control-allow-origin': 'http://localhost:5173',
      vary: 'Origin',
    });
    expect(mediaServiceCorsHeaders('http://127.0.0.1:33001', 'http://localhost:5173')).toHaveProperty(
      'access-control-allow-origin',
      'http://127.0.0.1:33001'
    );
    expect(mediaServiceCorsHeaders('https://untrusted.example', 'http://localhost:5173')).not.toHaveProperty(
      'access-control-allow-origin'
    );
    expect(mediaServiceCorsHeaders('http://localhost:5173')).not.toHaveProperty('access-control-allow-origin');
  });

  it('starts the media process only after Core has published its actual backend port', () => {
    const source = fs.readFileSync(path.resolve('packages/desktop/src/index.ts'), 'utf8');
    const backendStartup = source.indexOf('const backendStartup = await startBackendOrExit');
    const portPublication = source.indexOf('exposeBackendPort(backendPort);', backendStartup);
    const mediaStartup = source.indexOf('mediaServiceProcess = new MediaServiceProcess');
    expect(backendStartup).toBeGreaterThan(0);
    expect(portPublication).toBeGreaterThan(backendStartup);
    expect(mediaStartup).toBeGreaterThan(portPublication);
  });

  it('updates an already running media child after Core recovery supplies its real port', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-service-recovery-'));
    const scriptPath = path.join(root, 'media-service.js');
    fs.writeFileSync(scriptPath, '');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const manager = new MediaServiceProcess({
      scriptPath,
      dataDir: root,
      sleep: async () => undefined,
      fetchImpl,
      spawnProcess: () => ({ once: () => undefined, kill: () => undefined }) as never,
    });
    try {
      await manager.start();
      await manager.setBackendPort(13422);
      expect(fetchImpl).toHaveBeenCalledWith(
        'http://127.0.0.1:33002/api/comfy/runtime-context',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ backendPort: 13422 }),
          headers: expect.objectContaining({ 'x-openh3-ui-token': manager.uiToken }),
        })
      );
    } finally {
      manager.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { configured: undefined, expected: '1' },
    { configured: '0', expected: '0' },
    { configured: '1', expected: '1' },
  ])('starts a controlled child with system CA setting $configured → $expected', async ({ configured, expected }) => {
    vi.stubEnv('NODE_USE_SYSTEM_CA', configured);
    vi.stubEnv('NODE_EXTRA_CA_CERTS', 'custom-ca.pem');
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', undefined);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-service-process-'));
    const scriptPath = path.join(root, 'media-service.js');
    fs.writeFileSync(scriptPath, '');
    let started: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdio: unknown } | undefined;
    const manager = new MediaServiceProcess({
      scriptPath,
      dataDir: root,
      backendPort: 13421,
      bundleRoot: path.join(root, 'h3-bundle'),
      sleep: async () => undefined,
      spawnProcess: (command, args, options) => {
        started = { command, args, env: options.env, stdio: options.stdio };
        return { once: () => undefined, kill: () => undefined } as never;
      },
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    try {
      await manager.start();
      expect(started?.args).toEqual([scriptPath]);
      expect(started?.env.AIONUI_MEDIA_PORT).toBe('33002');
      expect(started?.env.AIONUI_DATA_DIR).toBe(root);
      expect(started?.env.OPENH3_RESOURCES_ROOT).toBe(path.resolve('resources'));
      expect(started?.env.OPENH3_MEDIA_BACKEND_PORT).toBe('13421');
      expect(started?.env.OPENH3_MEDIA_UI_ORIGIN).toBe('http://localhost:5173');
      expect(started?.env.AIONUI_H3_BUNDLE_ROOT).toBe(path.join(root, 'h3-bundle'));
      expect(started?.env.NODE_USE_SYSTEM_CA).toBe(expected);
      expect(started?.env.NODE_EXTRA_CA_CERTS).toBe('custom-ca.pem');
      expect(started?.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      expect(fs.existsSync(path.join(root, 'media-service.log'))).toBe(true);
    } finally {
      manager.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
