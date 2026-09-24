import { createMediaJob, mediaJobIdempotencyKey, type MediaJob, type MediaJobSpec } from '@/common/chat/document/mediaJob';
import { executeFfmpeg, type FfmpegExecutorOptions, type FfmpegProgress } from './FfmpegExecutor';
import type { MediaJobStore } from './MediaJobStore';
import { removeMediaArtifact, validateMediaArtifact } from './mediaArtifact';

export type MediaJobStoreLike = Pick<MediaJobStore, 'get' | 'getByIdempotencyKey' | 'create' | 'update' | 'listActive'>;

export class MediaJobRunner {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly store: MediaJobStoreLike,
    private readonly executorOptions?: FfmpegExecutorOptions
  ) {}

  enqueue(spec: MediaJobSpec): MediaJob {
    const existing = this.store.getByIdempotencyKey(mediaJobIdempotencyKey(spec));
    if (existing) return existing;
    return this.store.create(createMediaJob(spec));
  }

  async run(id: string, onProgress?: (job: MediaJob) => void): Promise<MediaJob> {
    const current = this.store.get(id);
    if (!current) throw new Error(`MEDIA_JOB_NOT_FOUND:${id}`);
    if (current.status === 'succeeded') return current;
    if (!['queued', 'running'].includes(current.status)) throw new Error(`MEDIA_JOB_NOT_RUNNABLE:${current.status}`);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let job = this.store.update(id, { status: 'running', progress: current.progress });
    onProgress?.(job);
    try {
      await executeFfmpeg(current.spec, controller.signal, (progress) => {
        const nextProgress = progress.percent ?? job.progress;
        job = this.store.update(id, { status: 'running', progress: Math.max(job.progress, Math.min(1, nextProgress)) });
        onProgress?.(job);
      }, this.executorOptions);
      validateMediaArtifact(current.spec);
      job = this.store.update(id, { status: 'succeeded', progress: 1 });
      onProgress?.(job);
      return job;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'MEDIA_JOB_CANCELLED' ? 'cancelled' : 'failed';
      removeMediaArtifact(current.spec);
      job = this.store.update(id, { status, progress: job.progress, error: message });
      onProgress?.(job);
      throw error;
    } finally {
      this.controllers.delete(id);
    }
  }

  cancel(id: string): MediaJob {
    this.controllers.get(id)?.abort();
    const job = this.store.get(id);
    if (!job) throw new Error(`MEDIA_JOB_NOT_FOUND:${id}`);
    if (job.status === 'queued') return this.store.update(id, { status: 'cancelled', progress: job.progress, error: 'MEDIA_JOB_CANCELLED' });
    return job;
  }

  recover(): MediaJob[] {
    return this.store.listActive().map((job) => job.status === 'running' ? this.store.update(job.id, { status: 'queued', progress: job.progress }) : job);
  }
}
