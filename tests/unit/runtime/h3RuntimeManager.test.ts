import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { H3RuntimeManager } from '@/process/services/runtime/H3RuntimeManager';

describe('H3 runtime manager', () => {
  it('reports child launch errors and releases the startup lock for retry', async () => {
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-start-error-'));
    fs.mkdirSync(path.join(portableRoot, 'python_embeded'), { recursive: true });
    fs.mkdirSync(path.join(portableRoot, 'ComfyUI'));
    fs.writeFileSync(path.join(portableRoot, 'python_embeded', 'python.exe'), 'fixture');
    fs.writeFileSync(path.join(portableRoot, 'ComfyUI', 'main.py'), 'fixture');
    let spawns = 0;
    let kills = 0;
    const manager = new H3RuntimeManager(
      {
        systemStats: async () => {
          throw new Error('offline');
        },
      },
      {
        portableRoot,
        spawnProcess: () => {
          spawns++;
          const child = Object.assign(new EventEmitter(), {
            kill: () => {
              kills++;
              return true;
            },
          });
          queueMicrotask(() => child.emit('error', new Error('SPAWN_FAILED')));
          return child as never;
        },
      }
    );
    try {
      await expect(manager.ensureStarted()).rejects.toThrow('SPAWN_FAILED');
      await expect(manager.ensureStarted()).rejects.toThrow('SPAWN_FAILED');
      expect(spawns).toBe(2);
      expect(kills).toBe(2);
    } finally {
      fs.rmSync(portableRoot, { recursive: true, force: true });
    }
  });
  it('uses an already-running ComfyUI endpoint without spawning another process', async () => {
    let calls = 0;
    const manager = new H3RuntimeManager(
      {
        systemStats: async () => {
          calls += 1;
          return { ok: true };
        },
      },
      {
        portableRoot: 'missing-runtime',
        spawnProcess: () => {
          throw new Error('must not spawn');
        },
      }
    );
    await expect(manager.ensureStarted()).resolves.toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it('passes an external offline bundle root to the installer status', () => {
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-bundle-root-'));
    const manager = new H3RuntimeManager({ systemStats: async () => ({ ok: true }) }, { bundleRoot });
    expect(manager.installStatus().bundleRoot).toBe(path.resolve(bundleRoot));
  });

  it('serializes concurrent startup attempts to one portable process', async () => {
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-runtime-manager-'));
    fs.mkdirSync(path.join(portableRoot, 'python_embeded'), { recursive: true });
    fs.mkdirSync(path.join(portableRoot, 'ComfyUI'), { recursive: true });
    fs.writeFileSync(path.join(portableRoot, 'python_embeded', 'python.exe'), 'python');
    fs.writeFileSync(path.join(portableRoot, 'ComfyUI', 'main.py'), 'main');
    let started = false;
    let spawns = 0;
    let spawnOptions: { cwd: string; windowsHide: boolean; stdio: ['ignore', number, number] } | undefined;
    const manager = new H3RuntimeManager(
      {
        systemStats: async () => {
          if (!started) throw new Error('offline');
          return { ok: true };
        },
      },
      {
        portableRoot,
        modelsDirectory: portableRoot,
        spawnProcess: (_command, _args, options) => {
          spawns += 1;
          spawnOptions = options;
          started = true;
          return {} as never;
        },
      }
    );
    const [first, second] = await Promise.all([manager.ensureStarted(), manager.ensureStarted()]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(spawns).toBe(1);
    expect(spawnOptions?.stdio[0]).toBe('ignore');
    expect(typeof spawnOptions?.stdio[1]).toBe('number');
    expect(spawnOptions?.stdio[1]).toBe(spawnOptions?.stdio[2]);
    expect(fs.existsSync(path.join(portableRoot, 'comfyui-service.log'))).toBe(true);
  });
});

it('discovers portable acceleration without machine-specific environment variables', () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-auto-discover-'));
  try {
    const portableRoot = path.join(bundleRoot, 'runtime');
    const python = path.join(portableRoot, 'python_embeded');
    fs.mkdirSync(path.join(python, 'Lib', 'site-packages', 'triton'), { recursive: true });
    fs.mkdirSync(path.join(python, 'include'), { recursive: true });
    fs.writeFileSync(path.join(python, 'include', 'Python.h'), 'fixture');
    const manager = new H3RuntimeManager({ systemStats: async () => ({}) }, { bundleRoot, portableRoot });
    expect(manager.accelerationStatus()).toMatchObject({ mode: 'auto', backend: 'sla', available: true });
    fs.rmSync(path.join(python, 'include', 'Python.h'));
    expect(manager.accelerationStatus()).toMatchObject({ backend: 'dense', reason: 'PYTHON_DEV_FILES_NOT_FOUND' });
  } finally {
    fs.rmSync(bundleRoot, { recursive: true, force: true });
  }
});
