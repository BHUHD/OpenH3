import { describe, expect, it } from 'vitest';
import { createMediaJob } from '@/common/chat/document/mediaJob';
import { MediaJobRunner } from '@/process/services/media/MediaJobRunner';
import type { MediaJob } from '@/common/chat/document/mediaJob';

class MemoryStore {
  rows = new Map<string, MediaJob>();
  get(id: string) { return this.rows.get(id); }
  getByIdempotencyKey(key: string) { return [...this.rows.values()].find((job) => job.idempotencyKey === key); }
  create(job: MediaJob) { this.rows.set(job.id, job); return job; }
  update(id: string, patch: { status: MediaJob['status']; progress: number; error?: string }) {
    const job = this.rows.get(id)!;
    const next = { ...job, ...patch };
    this.rows.set(id, next);
    return next;
  }
  listActive() { return [...this.rows.values()].filter((job) => job.status === 'queued' || job.status === 'running'); }
}

describe('media job runner', () => {
  it('deduplicates enqueue and recovers running work', () => {
    const store = new MemoryStore();
    const runner = new MediaJobRunner(store as any);
    const spec = { kind: 'probe' as const, sourcePath: 'in.mp4' };
    const first = runner.enqueue(spec);
    expect(runner.enqueue(spec).id).toBe(first.id);
    store.update(first.id, { status: 'running', progress: 0.4 });
    expect(runner.recover()[0]).toMatchObject({ status: 'queued', progress: 0.4 });
  });

  it('cancels queued work without starting a process', () => {
    const store = new MemoryStore();
    const runner = new MediaJobRunner(store as any);
    const job = runner.enqueue({ kind: 'probe', sourcePath: 'in.mp4' });
    expect(runner.cancel(job.id)).toMatchObject({ status: 'cancelled', error: 'MEDIA_JOB_CANCELLED' });
  });
});
