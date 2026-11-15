/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { ComfyGenerationJob } from '@/common/chat/document/creation/comfy';
import {
  comfyJobRatio,
  ratioFromAspect,
  ratioFromSize,
} from '@/renderer/pages/conversation/runtime/GenerationCard/generationRatio';

const job = (partial: object): ComfyGenerationJob => partial as unknown as ComfyGenerationJob;

describe('ratioFromSize', () => {
  it('divides width by height', () => {
    expect(ratioFromSize(1280, 720)).toBeCloseTo(16 / 9);
  });

  it('rejects missing, zero, non-finite and non-numeric sides', () => {
    expect(ratioFromSize(0, 720)).toBeUndefined();
    expect(ratioFromSize(1280, 0)).toBeUndefined();
    expect(ratioFromSize(undefined, 720)).toBeUndefined();
    expect(ratioFromSize(1280, Number.NaN)).toBeUndefined();
    expect(ratioFromSize('1280', 720)).toBeUndefined();
  });
});

describe('ratioFromAspect', () => {
  it('parses a colon-separated aspect ratio', () => {
    expect(ratioFromAspect('9:16')).toBeCloseTo(9 / 16);
  });

  it('rejects malformed values', () => {
    expect(ratioFromAspect(undefined)).toBeUndefined();
    expect(ratioFromAspect('wide')).toBeUndefined();
    expect(ratioFromAspect('16:9:1')).toBeUndefined();
    expect(ratioFromAspect('16:0')).toBeUndefined();
  });
});

describe('comfyJobRatio', () => {
  it('prefers the execution snapshot parameters', () => {
    const result = comfyJobRatio(
      job({
        snapshot: { parameters: { width: 768, height: 512 } },
        adjustments: [{ reason: 'budget', input: { width: 1, height: 1 } }],
      })
    );
    expect(result).toBeCloseTo(1.5);
  });

  it('falls through when the snapshot carries only one side', () => {
    const result = comfyJobRatio(
      job({
        snapshot: { parameters: { width: 768 } },
        adjustments: [{ reason: 'budget', input: { width: 512, height: 768 } }],
      })
    );
    expect(result).toBeCloseTo(512 / 768);
  });

  it('uses the last parameter adjustment before the original input', () => {
    const result = comfyJobRatio(
      job({
        adjustments: [
          { reason: 'first', input: { width: 1, height: 1 } },
          { reason: 'second', input: { width: 640, height: 360 } },
        ],
        originalInput: { width: 100, height: 100 },
      })
    );
    expect(result).toBeCloseTo(16 / 9);
  });

  it('falls back to the original input of a failed job', () => {
    expect(comfyJobRatio(job({ originalInput: { width: 1024, height: 576 } }))).toBeCloseTo(16 / 9);
  });

  it('is undefined when no size was recorded', () => {
    expect(comfyJobRatio(job({}))).toBeUndefined();
    expect(comfyJobRatio(undefined)).toBeUndefined();
  });
});
