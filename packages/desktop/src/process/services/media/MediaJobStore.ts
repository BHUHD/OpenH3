import type { MediaJob, MediaJobSpec, MediaJobStatus } from '@/common/chat/document/mediaJob';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type Row = {
  id: string; idempotency_key: string; kind: MediaJobSpec['kind']; spec: string;
  status: MediaJobStatus; progress: number; error: string | null; created_at: number; updated_at: number;
};

export class MediaJobStore {
  constructor(private readonly db: ISqliteDriver) {}

  get(id: string): MediaJob | undefined {
    const row = this.db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(id) as Row | undefined;
    return row ? this.map(row) : undefined;
  }

  getByIdempotencyKey(key: string): MediaJob | undefined {
    const row = this.db.prepare('SELECT * FROM media_jobs WHERE idempotency_key = ?').get(key) as Row | undefined;
    return row ? this.map(row) : undefined;
  }

  create(job: MediaJob): MediaJob {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO media_jobs (id, idempotency_key, kind, spec, status, progress, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(job.id, job.idempotencyKey, job.spec.kind, JSON.stringify(job.spec), job.status, job.progress, job.error ?? null, now, now);
    return job;
  }

  update(id: string, patch: Pick<MediaJob, 'status' | 'progress'> & { error?: string }): MediaJob {
    const result = this.db.prepare(
      'UPDATE media_jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?'
    ).run(patch.status, patch.progress, patch.error ?? null, Date.now(), id);
    if (!result.changes) throw new Error(`MEDIA_JOB_NOT_FOUND:${id}`);
    return this.get(id)!;
  }

  listActive(): MediaJob[] {
    return (this.db.prepare("SELECT * FROM media_jobs WHERE status IN ('queued', 'running') ORDER BY created_at ASC").all() as Row[]).map((row) => this.map(row));
  }

  private map(row: Row): MediaJob {
    return { id: row.id, idempotencyKey: row.idempotency_key, spec: JSON.parse(row.spec) as MediaJobSpec, status: row.status, progress: row.progress, ...(row.error ? { error: row.error } : {}) };
  }
}
