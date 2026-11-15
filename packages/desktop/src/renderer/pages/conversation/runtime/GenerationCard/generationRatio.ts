/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComfyGenerationJob } from '@/common/chat/document/creation/comfy';

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Width / height, or undefined when either side is missing or not a positive number. */
export function ratioFromSize(width: unknown, height: unknown): number | undefined {
  return isPositive(width) && isPositive(height) ? width / height : undefined;
}

/** Parses a '16:9' style aspect ratio; anything else yields undefined. */
export function ratioFromAspect(aspect: string | undefined): number | undefined {
  const parts = aspect?.split(':').map(Number);
  return parts?.length === 2 ? ratioFromSize(parts[0], parts[1]) : undefined;
}

/** Requested output ratio of a Comfy job: execution snapshot first, then the last parameter adjustment, then the original input. */
export function comfyJobRatio(job: ComfyGenerationJob | undefined): number | undefined {
  if (!job) return undefined;
  const parameters = job.snapshot?.parameters;
  const adjusted = job.adjustments?.at(-1)?.input;
  return (
    ratioFromSize(parameters?.width, parameters?.height) ??
    ratioFromSize(adjusted?.width, adjusted?.height) ??
    ratioFromSize(job.originalInput?.width, job.originalInput?.height)
  );
}
