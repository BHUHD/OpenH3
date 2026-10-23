import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ComfyRuntimeCoordinator,
  comfyRuntimeResourceKey,
  comfyRuntimeSignature,
} from '@/process/services/media/comfy/runtimeCoordinator';
import type { ComfyProfile } from '@/common/chat/document/creation/comfy';

let directory = '';
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('shared Comfy runtime coordinator', () => {
  it('retains the cache across workflow variants with the same component set', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const coordinator = new ComfyRuntimeCoordinator({ directory });
    const profile: ComfyProfile = {
      id: 'same-components',
      family: 'h3',
      name: 'H3',
      kind: 'video',
      version: 'v1',
      quantization: 'bf16',
      capabilities: ['text-to-video'],
      state: 'verified',
      environment: { root: '/comfy', python: '/comfy/python', baseUrl: 'http://127.0.0.1:8188' },
      components: [{ role: 'diffusion', name: 'H3', path: '/comfy/h3.safetensors', version: 'v1', precision: 'bf16' }],
      nodes: [{ id: 'core', version: 'v1' }],
      workflowPath: '/comfy/t2v.json',
      workflowSha256: 'a'.repeat(64),
      bindings: {},
      defaults: {},
    };
    const cleanup = vi.fn(async () => undefined);
    await coordinator.run('gpu-0', comfyRuntimeSignature(profile), async () => undefined, cleanup);
    await coordinator.run(
      'gpu-0',
      comfyRuntimeSignature({ ...profile, workflowPath: '/comfy/i2v.json', workflowSha256: 'b'.repeat(64) }),
      async () => undefined,
      cleanup
    );
    expect(cleanup).not.toHaveBeenCalled();
    await coordinator.run(
      'gpu-0',
      comfyRuntimeSignature({ ...profile, components: [{ ...profile.components[0], precision: 'int8' }] }),
      async () => undefined,
      cleanup
    );
    expect(cleanup).toHaveBeenCalledWith('component-switch', undefined);
  });

  it('serializes work on the same GPU across coordinator instances', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const first = new ComfyRuntimeCoordinator({ directory, idleTimeoutMs: 60_000 });
    const second = new ComfyRuntimeCoordinator({ directory, idleTimeoutMs: 60_000 });
    let active = 0;
    let peak = 0;
    const task = async (): Promise<void> => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--;
    };
    await Promise.all([
      first.run('gpu-0', 'bf16', task, async () => undefined),
      second.run('gpu-0', 'int8', task, async () => undefined),
    ]);
    expect(peak).toBe(1);
  });

  it('clears cached weights before a component switch and identifies one GPU across endpoints', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const coordinator = new ComfyRuntimeCoordinator({ directory, idleTimeoutMs: 60_000 });
    const cleanups: string[] = [];
    const cleanup = async (reason: 'component-switch' | 'idle' | 'terminal-error' | 'memory-pressure' | 'oom') => {
      cleanups.push(reason);
    };
    await coordinator.run('gpu-0', 'bf16', async () => undefined, cleanup);
    await coordinator.run('gpu-0', 'int8', async () => undefined, cleanup);
    expect(cleanups).toEqual(['component-switch']);
    expect(
      comfyRuntimeResourceKey('http://127.0.0.1:8188', {
        devices: [{ index: 0, name: 'GPU X', type: 'cuda', vram_total: 100 }],
      })
    ).toBe(
      comfyRuntimeResourceKey('http://127.0.0.1:8288', {
        devices: [{ index: 0, name: 'GPU X', type: 'cuda', vram_total: 100 }],
      })
    );
  });

  it('keeps an unknown submission blocked across instances and lets only its existing task recover', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const first = new ComfyRuntimeCoordinator({ directory });
    const cleanup = vi.fn(async () => undefined);
    await expect(
      first.run(
        'gpu-0',
        'bf16',
        async () => {
          throw new Error('UNKNOWN_SUBMISSION');
        },
        cleanup,
        undefined,
        { taskId: 'existing', context: { endpoint: 'old' }, isUncertain: () => true }
      )
    ).rejects.toThrow('UNKNOWN_SUBMISSION');
    const second = new ComfyRuntimeCoordinator({ directory });
    const task = vi.fn(async () => 'done');
    await expect(second.run('gpu-0', 'bf16', task, cleanup, undefined, { taskId: 'new' })).rejects.toThrow(
      'COMFY_REMOTE_STATE_UNCONFIRMED'
    );
    expect(task).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    await expect(
      second.run('gpu-0', 'bf16', task, cleanup, undefined, { taskId: 'existing', recover: true })
    ).resolves.toBe('done');
  });

  it('cleans the previous environment on a cross-process component switch', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const first = new ComfyRuntimeCoordinator({ directory });
    await first.run(
      'gpu-0',
      'bf16',
      async () => undefined,
      async () => undefined,
      undefined,
      { context: { endpoint: 'old' } }
    );
    const cleanup = vi.fn(async () => undefined);
    await new ComfyRuntimeCoordinator({ directory }).run('gpu-0', 'int8', async () => undefined, cleanup, undefined, {
      context: { endpoint: 'new' },
    });
    expect(cleanup).toHaveBeenCalledWith('component-switch', { endpoint: 'old' });
  });

  it('uses a machine barrier when GPU identity is unknown even if later callers know the GPU', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const coordinator = new ComfyRuntimeCoordinator({ directory });
    expect(comfyRuntimeResourceKey('http://127.0.0.1:8188', {})).toBe('machine');
    expect(comfyRuntimeResourceKey('http://127.0.0.1:8288', {})).toBe('machine');
    await expect(
      coordinator.run(
        'machine',
        'bf16',
        async () => {
          throw new Error('lost');
        },
        async () => undefined,
        undefined,
        { taskId: 'old', isUncertain: () => true }
      )
    ).rejects.toThrow('lost');
    await expect(
      new ComfyRuntimeCoordinator({ directory }).run(
        'gpu-0',
        'int8',
        async () => undefined,
        async () => undefined,
        undefined,
        { taskId: 'new' }
      )
    ).rejects.toThrow('COMFY_REMOTE_STATE_UNCONFIRMED');
  });

  it('uses physical UUID overlap rather than endpoint, device index, or telemetry shape for GPU leases', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const coordinator = new ComfyRuntimeCoordinator({ directory });
    const other = new ComfyRuntimeCoordinator({ directory });
    const first = comfyRuntimeResourceKey('http://localhost:8188', {
      devices: [{ index: 0, name: 'GPU', uuid: 'GPU-a', vram_free: 10 }],
    });
    const same = comfyRuntimeResourceKey('http://localhost:8288', {
      devices: [{ index: 5, name: 'Renamed', uuid: 'GPU-A', vram_free: 20 }],
    });
    expect(first).toBe(same);
    expect(comfyRuntimeResourceKey('http://localhost:8188', { devices: [{}] })).toBe('machine');
    let active = 0;
    let peak = 0;
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      entered();
      await finished;
      active--;
    };
    const second = comfyRuntimeResourceKey('http://localhost:8288', { devices: [{ uuid: 'GPU-b' }] });
    const firstRun = coordinator.run(first, 'a', work, async () => undefined);
    await started;
    await other.run(
      second,
      'b',
      async () => {
        active++;
        peak = Math.max(peak, active);
        active--;
        finish();
      },
      async () => undefined
    );
    await firstRun;
    expect(peak).toBe(2);
    await expect(
      coordinator.run(
        first,
        'a',
        async () => {
          throw new Error('offline');
        },
        async () => undefined,
        undefined,
        { taskId: 'a', isUncertain: () => true }
      )
    ).rejects.toThrow('offline');
    const both = comfyRuntimeResourceKey('http://localhost:8388', { devices: [{ uuid: 'GPU-a' }, { uuid: 'GPU-b' }] });
    await expect(
      other.run(
        both,
        'c',
        async () => undefined,
        async () => undefined
      )
    ).rejects.toThrow('COMFY_REMOTE_STATE_UNCONFIRMED');
  });

  it('keeps same components cached and cleans after 120 seconds of idle', async () => {
    vi.useFakeTimers();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-coordinator-'));
    const coordinator = new ComfyRuntimeCoordinator({ directory });
    const cleanup = vi.fn(async () => undefined);
    await coordinator.run('gpu-0', 'bf16', async () => undefined, cleanup);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(cleanup).not.toHaveBeenCalled();
    await coordinator.run('gpu-0', 'bf16', async () => undefined, cleanup);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanup).toHaveBeenCalledWith('idle', undefined);
  });
});
