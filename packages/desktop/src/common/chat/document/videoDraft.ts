import { z } from 'zod';
import type { ChatFileRef } from '@/common/types/chatFile';

const name = z.string().min(1);
const fileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), pe_id: name, relative_path: name }).strict(),
  z.object({ kind: z.literal('upload'), path: name }).strict(),
  z.object({ kind: z.literal('local'), path: name }).strict(),
]);
const rangeSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    durationSeconds: z.number().finite().positive(),
    lastModified: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((r) => r.startSeconds < r.endSeconds && r.endSeconds <= r.durationSeconds);

/** Browser time is advisory seconds, not probed PTS or an immutable asset revision. */
export function buildVideoDraft(fileInput: unknown, rangeInput: unknown): { prompt: string; files: ChatFileRef[] } {
  // Zod 3 infers optional object keys under this upstream tsconfig (strictNullChecks off).
  const file = fileSchema.parse(fileInput) as ChatFileRef;
  const range = rangeSchema.parse(rangeInput);
  return {
    prompt: JSON.stringify(
      {
        type: 'video-selection',
        schemaVersion: 1,
        file,
        timeUnit: 'seconds',
        ...range,
        precision: 'browser-media-time',
        sourceUnmodified: true,
      },
      null,
      2
    ),
    files: [file],
  };
}
