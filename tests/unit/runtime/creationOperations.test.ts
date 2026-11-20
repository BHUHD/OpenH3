import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreationOperations } from '@/process/services/media/creation/CreationOperations';
import type { H3SetupState } from '@/common/chat/document/creation/h3Setup';
import type { H3JobStatus } from '@/common/chat/document/h3Job';
import { firstClipCloudInput } from '@/common/chat/document/creation/cloudVideo';

const directories: string[] = [];
const requestId = 'c34c4b76-6a73-4e82-9e72-c995175414db';
const consent = { download: true, acceptModelTerms: true, acceptExperimentalHardware: true };
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-'));
  directories.push(directory);
  const filename = path.join(directory, 'operations.json');
  let installed = false;
  let setup: H3SetupState = { phase: 'idle' };
  const jobs = new Map<string, { status: H3JobStatus; remoteUncertain?: boolean; cancelRequested?: boolean }>();
  const ports = {
    setup: () => setup,
    installed: () => installed,
    install: vi.fn(async () => {
      setup = { phase: 'downloading' };
    }),
    getJob: (id: string) => jobs.get(id),
    enqueue: vi.fn(async (_spec, id: string) => {
      jobs.set(id, { status: 'queued' });
      return id;
    }),
    cancelJob: vi.fn(async (id: string) => {
      jobs.set(id, { status: 'cancelled' });
    }),
  };
  const operations = new CreationOperations(filename, ports);
  operations.bind(requestId, 'conversation-1');
  return {
    operations,
    ports,
    filename,
    jobs,
    ready: () => {
      installed = true;
      setup = { phase: 'installed' };
    },
    phase: (phase: H3SetupState['phase']) => {
      setup = { phase };
    },
  };
}
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe('creation installation continuation', () => {
  it('persists a cold managed generation and submits the original spec after a restart and resume', async () => {
    const f = fixture();
    const managedRequest = crypto.randomUUID();
    const spec = { prompt: 'Original', seed: 9, durationSeconds: 6, references: [{ type: 'image', path: '/ref.png' }] };
    f.operations.bind(managedRequest, 'conversation-1', true);
    const operation = await f.operations.prepareGeneration(managedRequest, spec);
    expect(operation.state).toBe('awaiting-consent');
    expect(f.ports.install).not.toHaveBeenCalled();
    await f.operations.authorizeAndStart(operation.id, 'conversation-1', consent);
    expect(f.ports.install).toHaveBeenCalledOnce();
    f.phase('paused');
    const recovered = new CreationOperations(f.filename, f.ports);
    expect(recovered.get(operation.id).state).toBe('paused');
    await recovered.authorizeAndStart(operation.id, 'conversation-1', consent);
    f.ready();
    await recovered.pump();
    await recovered.pump();
    expect(f.ports.enqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(spec), operation.id);
    expect(recovered.get(operation.id)).toMatchObject({ state: 'submitted', jobId: operation.id });
  });

  it('starts a returning managed generation through one stable job without invoking the installer', async () => {
    const f = fixture();
    f.ready();
    const managedRequest = crypto.randomUUID();
    f.operations.bind(managedRequest, 'conversation-1', true);
    const input = { prompt: 'Returning' };
    const operation = await f.operations.prepareGeneration(managedRequest, input);
    await f.operations.prepareGeneration(managedRequest, input);
    expect(operation).toMatchObject({ state: 'submitted', jobId: operation.id });
    expect(f.ports.enqueue).toHaveBeenCalledOnce();
    expect(f.ports.install).not.toHaveBeenCalled();
    await expect(f.operations.prepareGeneration(requestId, input)).rejects.toThrow('H3_MANAGED_ROUTE_NOT_SELECTED');
  });

  it('requires an explicit compatible cloud choice and keeps the same submission across a restart', async () => {
    const f = fixture();
    const managedRequest = crypto.randomUUID();
    const cloudJobId = crypto.randomUUID();
    const baseUrl = 'https://configured.example/v1';
    const prepareCloud = vi.fn((operation) => {
      if (!firstClipCloudInput(operation.spec)) throw new Error('CREATION_CLOUD_INPUT_UNSUPPORTED');
    });
    const submitCloud = vi.fn(async () => cloudJobId);
    const ports = { ...f.ports, prepareCloud, submitCloud };
    const operations = new CreationOperations(f.filename, ports);
    operations.bind(managedRequest, 'conversation-1', true);
    const withReference = await operations.prepareGeneration(managedRequest, {
      prompt: 'Use the original image',
      references: [{ type: 'image', path: '/reference.png' }],
    });
    await expect(operations.chooseCloud(withReference.id, 'conversation-1', 'configured', baseUrl)).rejects.toThrow(
      'CREATION_CLOUD_INPUT_UNSUPPORTED'
    );
    expect(operations.get(withReference.id).state).toBe('awaiting-consent');
    const spec = { prompt: 'Preserve text and timing', durationSeconds: 7, seed: 42 };
    const operation = await operations.prepareGeneration(managedRequest, spec);
    await operations.pump();
    expect(submitCloud).not.toHaveBeenCalled();
    await expect(operations.chooseCloud(operation.id, 'other-chat', 'configured', baseUrl)).rejects.toThrow(
      'CREATION_CONVERSATION_UNAVAILABLE'
    );
    await operations.chooseCloud(operation.id, 'conversation-1', 'configured', baseUrl);
    const recovered = new CreationOperations(f.filename, ports);
    await recovered.chooseCloud(operation.id, 'conversation-1', 'configured', baseUrl);
    await recovered.pump();
    expect(submitCloud).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: operation.id, spec }),
      'configured'
    );
    expect(recovered.get(operation.id)).toMatchObject({ state: 'submitted', cloudJobId, cloudBaseUrl: baseUrl });
    expect(recovered.managedSubmissions()).toEqual([recovered.get(operation.id)]);
    expect(f.ports.install).not.toHaveBeenCalled();
    expect(f.ports.enqueue).not.toHaveBeenCalled();
  });

  it('defers app replacement when persisted continuations are unreadable', () => {
    const f = fixture();
    fs.writeFileSync(f.filename, '{broken');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(new CreationOperations(f.filename, f.ports).updateIdle()).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
  it('blocks app replacement while a consented install continuation can still enqueue work', async () => {
    const f = fixture();
    expect(f.operations.updateIdle()).toBe(true);
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    expect(f.operations.updateIdle()).toBe(true);
    f.operations.authorize(operation.id, 'conversation-1', consent);
    expect(f.operations.updateIdle()).toBe(false);
    await f.operations.start(operation.id, requestId);
    expect(f.operations.updateIdle()).toBe(false);
    f.ready();
    await f.operations.pump();
    expect(f.operations.updateIdle()).toBe(true);
  });
  it('still cancels a submitted job after a transient job-ID persistence failure', async () => {
    const f = fixture();
    f.ready();
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await f.operations.start(operation.id, requestId);
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const originalRename = fs.renameSync;
    let writes = 0;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (++writes === 3) throw Object.assign(new Error('job ID temporarily locked'), { code: 'EPERM' });
      originalRename(source, target);
    });
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      await f.operations.cancelConversation('conversation-1');
      expect(f.ports.cancelJob).toHaveBeenCalledExactlyOnceWith(operation.id);
      expect(f.operations.get(operation.id).state).toBe('cancelled');
      expect(JSON.parse(fs.readFileSync(f.filename, 'utf8')).operations[0].state).toBe('cancelled');
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
      rename.mockRestore();
    }
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a transient Windows %s without deleting committed state', (code) => {
    const f = fixture();
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      expect(JSON.parse(fs.readFileSync(f.filename, 'utf8')).operations).toEqual([]);
      throw Object.assign(new Error('temporarily locked'), { code });
    });
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const operation = f.operations.request(requestId, { prompt: 'Persist after retry' });
      expect(rename.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(fs.readFileSync(f.filename, 'utf8')).operations).toEqual([operation]);
      expect(fs.readdirSync(path.dirname(f.filename))).toEqual(['operations.json']);
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
      rename.mockRestore();
    }
  });

  it.each([
    ['win32', 'EPERM', 6],
    ['win32', 'ENOSPC', 1],
    ['linux', 'EPERM', 1],
  ] as const)('bounds %s %s retries and preserves the previous file', (platform, code, attempts) => {
    const f = fixture();
    const committed = fs.readFileSync(f.filename, 'utf8');
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const failure = Object.assign(new Error('cannot replace state'), { code });
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw failure;
    });
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
      expect(() => f.operations.request(requestId, { prompt: 'Not committed' })).toThrow(failure);
      expect(rename).toHaveBeenCalledTimes(attempts);
      expect(fs.readFileSync(f.filename, 'utf8')).toBe(committed);
      expect(fs.readdirSync(path.dirname(f.filename))).toEqual(['operations.json']);
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
      rename.mockRestore();
    }
  });

  it('does not apply an old failed setup state during asynchronous installer preflight', async () => {
    const f = fixture();
    f.phase('failed');
    let finish!: () => void;
    f.ports.install.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    const pending = f.operations.start(operation.id, requestId);
    await f.operations.pump();
    expect(f.operations.get(operation.id).state).toBe('installing');
    f.ready();
    finish();
    await pending;
    await f.operations.pump();
    expect(f.ports.enqueue).toHaveBeenCalledExactlyOnceWith({ prompt: 'Original' }, operation.id);
  });

  it('keeps failed cancellation retryable across deletion and restart', async () => {
    const f = fixture();
    f.ready();
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await f.operations.start(operation.id, requestId);
    f.ports.cancelJob.mockRejectedValueOnce(new Error('runtime offline'));
    await f.operations.cancel(operation.id);
    expect(f.operations.get(operation.id)).toMatchObject({ state: 'cancelling', error: 'runtime offline' });
    const restored = new CreationOperations(f.filename, f.ports);
    await restored.cancelConversation('conversation-1');
    expect(f.ports.cancelJob).toHaveBeenCalledTimes(2);
    expect(restored.get(operation.id).state).toBe('cancelled');
  });

  it('recovers a persisted job created just before the operation state was saved', async () => {
    const f = fixture();
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await f.operations.start(operation.id, requestId);
    f.jobs.set(operation.id, { status: 'running' });
    const restored = new CreationOperations(f.filename, f.ports);
    expect(restored.get(operation.id)).toMatchObject({ state: 'submitted', jobId: operation.id });
    await restored.cancelConversation('conversation-1');
    expect(f.ports.cancelJob).toHaveBeenCalledWith(operation.id);
    expect(f.ports.enqueue).not.toHaveBeenCalled();
  });

  it('requires UI consent and matching session, then resumes the exact original spec once', async () => {
    const f = fixture();
    const spec = {
      prompt: 'Original shot',
      seed: 42,
      durationSeconds: 6,
      references: [{ type: 'image', path: 'D:/reference.png' }],
    };
    const operation = f.operations.request(requestId, spec);
    expect(f.operations.request(requestId, spec).id).toBe(operation.id);
    await expect(f.operations.start(operation.id, requestId)).rejects.toThrow('USER_CONFIRMATION_REQUIRED');
    expect(() =>
      f.operations.authorize(operation.id, 'conversation-1', { ...consent, acceptModelTerms: false })
    ).toThrow('TERMS_REQUIRED');
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await expect(f.operations.start(operation.id, crypto.randomUUID())).rejects.toThrow('REQUEST_MISMATCH');
    await f.operations.start(operation.id, requestId);
    await f.operations.start(operation.id, requestId);
    expect(f.ports.install).toHaveBeenCalledExactlyOnceWith(consent);
    await f.operations.pump();
    expect(f.ports.enqueue).not.toHaveBeenCalled();
    f.ready();
    await f.operations.pump();
    await f.operations.pump();
    expect(f.ports.enqueue).toHaveBeenCalledExactlyOnceWith(spec, operation.id);
    expect(f.operations.get(operation.id)).toMatchObject({ state: 'submitted', jobId: operation.id });
  });

  it('does not silently resume paused/failed installation or restart interrupted operations', async () => {
    const f = fixture();
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await f.operations.start(operation.id, requestId);
    const restored = new CreationOperations(f.filename, f.ports);
    expect(restored.get(operation.id).state).toBe('paused');
    await restored.pump();
    expect(f.ports.enqueue).not.toHaveBeenCalled();
    f.phase('failed');
    await f.operations.pump();
    expect(f.operations.get(operation.id).state).toBe('failed');
    f.ready();
    await f.operations.pump();
    expect(f.ports.enqueue).not.toHaveBeenCalled();
  });

  it('deletion cancels pending continuation and rejects late requests from the deleted conversation', async () => {
    const f = fixture();
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await f.operations.start(operation.id, requestId);
    await f.operations.cancelConversation('conversation-1');
    f.ready();
    await f.operations.pump();
    expect(f.ports.enqueue).not.toHaveBeenCalled();
    expect(() => f.operations.request(requestId, { prompt: 'Late request' })).toThrow('CONVERSATION_UNAVAILABLE');
    const restored = new CreationOperations(f.filename, f.ports);
    expect(() => restored.request(requestId, { prompt: 'Late request' })).toThrow('CONVERSATION_UNAVAILABLE');
  });

  it('cancels an enqueued job when deletion races with preflight and preserves cancellation after an error', async () => {
    const f = fixture();
    const operation = f.operations.request(requestId, { prompt: 'Original' });
    f.operations.authorize(operation.id, 'conversation-1', consent);
    await f.operations.start(operation.id, requestId);
    f.ready();
    let finish!: (id: string) => void;
    f.ports.enqueue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = f.operations.pump();
    await f.operations.cancelConversation('conversation-1');
    finish(operation.id);
    await pending;
    expect(f.ports.cancelJob).toHaveBeenCalledWith(operation.id);
    expect(f.operations.get(operation.id).state).toBe('cancelled');
  });

  it('changing a spec creates a new request requiring fresh consent and leaves the old request unchanged', () => {
    const f = fixture();
    const first = f.operations.request(requestId, { prompt: 'Original', seed: 1 });
    f.operations.authorize(first.id, 'conversation-1', consent);
    const second = f.operations.request(requestId, { prompt: 'Changed', seed: 2 });
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe('awaiting-consent');
    expect(f.operations.get(first.id).spec).toEqual({ prompt: 'Original', seed: 1 });
  });
});
