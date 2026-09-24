import { z } from 'zod';

export const mediaJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type MediaJobStatus = z.infer<typeof mediaJobStatusSchema>;

export const mediaJobKindSchema = z.enum(['transcode', 'extract-audio', 'extract-frame', 'probe']);
export type MediaJobKind = z.infer<typeof mediaJobKindSchema>;

export const mediaJobSpecSchema = z
  .object({
    kind: mediaJobKindSchema,
    sourcePath: z.string().min(1),
    outputPath: z.string().min(1).optional(),
    startSeconds: z.number().finite().nonnegative().optional(),
    endSeconds: z.number().finite().positive().optional(),
    videoCodec: z.string().min(1).optional(),
    audioCodec: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.kind !== 'probe' && !spec.outputPath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['outputPath'], message: 'OUTPUT_REQUIRED' });
    }
    if (spec.startSeconds !== undefined && spec.endSeconds !== undefined && spec.startSeconds >= spec.endSeconds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endSeconds'], message: 'INVALID_RANGE' });
    }
  });
export type MediaJobSpec = z.infer<typeof mediaJobSpecSchema>;

export type MediaJob = {
  id: string;
  idempotencyKey: string;
  spec: MediaJobSpec;
  status: MediaJobStatus;
  progress: number;
  error?: string;
};

export function mediaJobIdempotencyKey(specInput: unknown): string {
  const spec = mediaJobSpecSchema.parse(specInput);
  const input = JSON.stringify(spec);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createMediaJob(specInput: unknown, id = crypto.randomUUID()): MediaJob {
  const spec = mediaJobSpecSchema.parse(specInput);
  return { id, idempotencyKey: mediaJobIdempotencyKey(spec), spec, status: 'queued', progress: 0 };
}

const transitions: Record<MediaJobStatus, readonly MediaJobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued'],
  cancelled: ['queued'],
};

export function transitionMediaJob(job: MediaJob, status: MediaJobStatus, error?: string): MediaJob {
  if (!transitions[job.status].includes(status)) throw new Error(`INVALID_MEDIA_JOB_TRANSITION:${job.status}->${status}`);
  return {
    ...job,
    status,
    progress: status === 'succeeded' ? 1 : status === 'queued' ? 0 : job.progress,
    ...(error ? { error } : {}),
  };
}

export function buildFfmpegArgs(specInput: unknown): string[] {
  const spec = mediaJobSpecSchema.parse(specInput);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (spec.startSeconds !== undefined) args.push('-ss', String(spec.startSeconds));
  args.push('-i', spec.sourcePath);
  if (spec.endSeconds !== undefined && spec.startSeconds !== undefined) {
    args.push('-t', String(spec.endSeconds - spec.startSeconds));
  }
  if (spec.kind === 'extract-audio') args.push('-vn', '-acodec', spec.audioCodec ?? 'aac');
  if (spec.kind === 'extract-frame') args.push('-frames:v', '1');
  if (spec.kind === 'transcode') {
    args.push('-vcodec', spec.videoCodec ?? 'libx264', '-acodec', spec.audioCodec ?? 'aac');
  }
  if (spec.kind !== 'probe') args.push(spec.outputPath!);
  else args.push('-f', 'null', '-');
  return args;
}
