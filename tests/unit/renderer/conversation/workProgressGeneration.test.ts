/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { CloudVideoJob } from '@/common/chat/document/creation/cloudVideo';
import type { ComfyGenerationJob } from '@/common/chat/document/creation/comfy';
import { projectWorkProgress, type WorkTask } from '@/renderer/pages/conversation/PlanBar/workProgress';

const runtime = { isProcessing: false, pendingConfirmations: 0, hydrated: true };

const comfyJob = (partial: object = {}): ComfyGenerationJob =>
  ({
    id: 'job-1',
    profileId: 'z-image',
    kind: 'image',
    status: 'running',
    progress: 40,
    artifacts: [],
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }) as unknown as ComfyGenerationJob;

const cloudJob = (partial: object = {}): CloudVideoJob =>
  ({
    id: 'job-2',
    requestId: 'request-1',
    conversationId: 'c1',
    connectionId: 'connection-1',
    model: 'cloud-model',
    status: 'running',
    progress: 30,
    progressKnown: true,
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }) as unknown as CloudVideoJob;

const comfyTask = (job: ComfyGenerationJob): WorkTask | undefined =>
  projectWorkProgress([], runtime, [], [job]).tasks.find((task) => task.id === job.id);

const cloudTask = (job: CloudVideoJob): WorkTask | undefined =>
  projectWorkProgress(
    [],
    runtime,
    [],
    [],
    [],
    [],
    { jobs: [], unavailable: [] },
    { jobs: [job], unavailable: [] }
  ).tasks.find((task) => task.id === `cloud:${job.id}`);

describe('Comfy generation task fields', () => {
  it('carries real progress and the requested ratio while running', () => {
    const task = comfyTask(comfyJob({ snapshot: { parameters: { width: 1280, height: 720 } } }));
    expect(task?.progress).toBe(40);
    expect(task?.ratio).toBeCloseTo(16 / 9);
  });

  it('carries progress while queued', () => {
    expect(comfyTask(comfyJob({ status: 'queued', progress: 0 }))?.progress).toBe(0);
  });

  it('drops progress once the job has finished', () => {
    expect(comfyTask(comfyJob({ status: 'succeeded', progress: 100 }))).not.toHaveProperty('progress');
    expect(comfyTask(comfyJob({ status: 'failed' }))).not.toHaveProperty('progress');
  });

  it('does not claim progress for a job the app only observes', () => {
    expect(comfyTask(comfyJob({ observationOnly: true }))).not.toHaveProperty('progress');
  });

  it('leaves the ratio out when no size was recorded', () => {
    expect(comfyTask(comfyJob())).not.toHaveProperty('ratio');
  });
});

describe('cloud video generation task fields', () => {
  it('carries progress only when the provider reports a real percentage', () => {
    expect(cloudTask(cloudJob())?.progress).toBe(30);
    expect(cloudTask(cloudJob({ progressKnown: false }))).not.toHaveProperty('progress');
    expect(cloudTask(cloudJob({ progressKnown: undefined }))).not.toHaveProperty('progress');
    expect(cloudTask(cloudJob({ progress: 0 }))).not.toHaveProperty('progress');
  });

  it('never reports a running job as complete', () => {
    expect(cloudTask(cloudJob({ progress: 100 }))?.progress).toBe(99);
  });

  it('drops progress once the job has finished', () => {
    expect(cloudTask(cloudJob({ status: 'succeeded', progress: 100 }))).not.toHaveProperty('progress');
  });

  it('takes the ratio from the size, then from the aspect ratio', () => {
    expect(cloudTask(cloudJob({ width: 720, height: 1280 }))?.ratio).toBeCloseTo(9 / 16);
    expect(cloudTask(cloudJob({ aspectRatio: '4:3' }))?.ratio).toBeCloseTo(4 / 3);
    expect(cloudTask(cloudJob({ width: 1280, height: 720, aspectRatio: '1:1' }))?.ratio).toBeCloseTo(16 / 9);
    expect(cloudTask(cloudJob())).not.toHaveProperty('ratio');
  });
});

describe('H3 generation task', () => {
  it('has no progress field because node progress is not overall progress', () => {
    const task = projectWorkProgress([], runtime, [], [], [], [], { jobs: [], unavailable: [] }).tasks;
    expect(task.every((item) => !('progress' in item))).toBe(true);
  });
});
