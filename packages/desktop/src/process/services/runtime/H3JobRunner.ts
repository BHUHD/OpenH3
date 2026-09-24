import { createH3Job, type H3Activity, type H3GenerationSpec, type H3Job } from '@/common/chat/document/h3Job';
import { H3ComfyClient } from './H3ComfyClient';
import type { H3JobStore } from './H3JobStore';
import { H3ReferencePreflight } from './H3ReferencePreflight';
import { H3ComfyError } from './h3ComfyError';

type H3ReferencePreflightLike = { validate(references: H3Job['spec']['references']): Promise<void> };

export class H3JobRunner {
  private readonly controllers = new Map<string, AbortController>();
  constructor(
    private readonly store: H3JobStore,
    private readonly client: Pick<H3ComfyClient, 'generate' | 'cancel' | 'resume'> = new H3ComfyClient(),
    private readonly preflight: H3ReferencePreflightLike = new H3ReferencePreflight()
  ) {}

  async enqueue(spec: H3GenerationSpec): Promise<H3Job> {
    const job = createH3Job(spec);
    await this.preflight.validate(job.spec.references);
    return this.store.create(job);
  }

  async run(id: string, onProgress?: (job: H3Job) => void): Promise<H3Job> {
    const current = this.store.get(id);
    if (!current) throw new Error('H3_JOB_NOT_FOUND');
    if (this.controllers.has(id)) throw new Error('H3_JOB_ALREADY_RUNNING');
    if (current.status === 'succeeded') return current;
    if (!['queued', 'running'].includes(current.status)) throw new Error(`H3_JOB_NOT_RUNNABLE:${current.status}`);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let job = this.store.update(id, {
      status: 'running',
      progress: 0,
      activity: { phase: 'waiting', updatedAt: new Date().toISOString() },
      startedAt: current.startedAt ?? new Date().toISOString(),
    });
    onProgress?.(job);
    try {
      const progressChanged = (progress: number, activity?: H3Activity): void => {
        if (this.store.get(id)?.status === 'cancelled') return;
        job = this.store.update(id, {
          status: 'running',
          progress: Math.max(0, Math.min(1, progress)),
          ...(activity ? { activity } : {}),
        });
        onProgress?.(job);
      };
      const submitted = (promptId: string): void => {
        job = this.store.update(id, { promptId });
        onProgress?.(job);
      };
      const result = current.promptId
        ? await this.client.resume(current.promptId, controller.signal, progressChanged)
        : await this.client.generate(current.spec, controller.signal, progressChanged, submitted);
      if (this.store.get(id)?.status === 'cancelled') return this.store.get(id)!;
      job = this.store.update(id, {
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        progress: 1,
        promptId: result.promptId,
        artifacts: result.artifacts.map((artifact, index) => ({
          ...artifact,
          resourcePath: `/api/h3/jobs/${encodeURIComponent(id)}/artifacts/${index}`,
        })),
      });
      onProgress?.(job);
      return job;
    } catch (error) {
      if (this.store.get(id)?.status === 'cancelled') return this.store.get(id)!;
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'H3_JOB_CANCELLED' ? 'cancelled' : 'failed';
      job = this.store.update(id, {
        status,
        error: message,
        diagnosis: error instanceof H3ComfyError ? error.diagnosis : undefined,
      });
      onProgress?.(job);
      throw error;
    } finally {
      this.controllers.delete(id);
    }
  }

  async cancel(id: string): Promise<H3Job> {
    const job = this.store.get(id);
    if (!job) throw new Error('H3_JOB_NOT_FOUND');
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    if (job.promptId) await this.client.cancel(job.promptId);
    this.controllers.get(id)?.abort();
    if (job.status === 'running' && !job.promptId) return this.store.update(id, { cancelRequested: true });
    return this.store.update(id, { status: 'cancelled', error: 'H3_JOB_CANCELLED' });
  }

  recover(): H3Job[] {
    return this.store.listActive().map((job) => {
      if (job.status !== 'running') return job;
      if (!job.promptId) return this.store.update(job.id, { status: 'failed', error: 'H3_SUBMISSION_STATE_UNKNOWN' });
      return this.store.update(job.id, { status: 'queued' });
    });
  }
}
