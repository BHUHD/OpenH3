import fs from 'node:fs';
import type { MediaJobSpec } from '@/common/chat/document/mediaJob';

export function validateMediaArtifact(spec: MediaJobSpec): void {
  if (spec.kind === 'probe') return;
  if (!spec.outputPath || !fs.existsSync(spec.outputPath)) throw new Error('MEDIA_OUTPUT_MISSING');
  if (fs.statSync(spec.outputPath).size <= 0) throw new Error('MEDIA_OUTPUT_EMPTY');
}

export function removeMediaArtifact(spec: MediaJobSpec): void {
  if (spec.outputPath && spec.kind !== 'probe') fs.rmSync(spec.outputPath, { force: true });
}
