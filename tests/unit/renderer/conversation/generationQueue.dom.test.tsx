/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkTask } from '@/renderer/pages/conversation/PlanBar/workProgress';
import GenerationQueue from '@/renderer/pages/conversation/runtime/GenerationCard/GenerationQueue';

afterEach(cleanup);

const CIRCUMFERENCE = 2 * Math.PI * 9;

const task = (partial: Partial<WorkTask> & { id: string }): WorkTask => ({
  title: '',
  kind: 'generation',
  status: 'running',
  ...partial,
});

const queue = (): HTMLElement => screen.getByTestId('generation-queue');
const chipCount = (): number => queue().querySelectorAll('svg').length;
const fillArc = (): Element | null => queue().querySelector('circle[stroke-dasharray]');
const fillOffset = (): number => Number(fillArc()?.getAttribute('stroke-dashoffset'));
const thumbWidth = (): string => (queue().querySelector('span[style]') as HTMLElement).style.width;

describe('GenerationQueue', () => {
  it('renders nothing when no generation is active', () => {
    const { container } = render(
      <GenerationQueue
        tasks={[
          task({ id: 'a', status: 'completed' }),
          task({ id: 'b', status: 'failed' }),
          task({ id: 'c', kind: 'task' }),
        ]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('is decorative so the owning bar keeps the status semantics', () => {
    render(<GenerationQueue tasks={[task({ id: 'a' })]} />);
    expect(queue()).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows one chip per running, pending or waiting generation', () => {
    render(
      <GenerationQueue
        tasks={[
          task({ id: 'a' }),
          task({ id: 'b', status: 'pending' }),
          task({ id: 'c', status: 'waiting' }),
          task({ id: 'd', status: 'completed' }),
        ]}
      />
    );
    expect(chipCount()).toBe(3);
  });

  it('caps the chips and counts the rest', () => {
    render(<GenerationQueue tasks={Array.from({ length: 6 }, (_, index) => task({ id: `t${index}` }))} />);
    expect(chipCount()).toBe(4);
    expect(queue()).toHaveTextContent('+2');
  });

  it('fills the ring with real progress', () => {
    render(<GenerationQueue tasks={[task({ id: 'a', progress: 50 })]} />);
    expect(fillOffset()).toBeCloseTo(CIRCUMFERENCE * 0.5);
  });

  it('clamps out-of-range progress', () => {
    const { rerender } = render(<GenerationQueue tasks={[task({ id: 'a', progress: 250 })]} />);
    expect(fillOffset()).toBeCloseTo(0);
    rerender(<GenerationQueue tasks={[task({ id: 'a', progress: -10 })]} />);
    expect(fillOffset()).toBeCloseTo(CIRCUMFERENCE);
  });

  it('uses a short indeterminate arc when no progress is known', () => {
    render(<GenerationQueue tasks={[task({ id: 'a' })]} />);
    expect(fillOffset()).toBeCloseTo(CIRCUMFERENCE * 0.75);
  });

  it('draws no progress arc for a task that has not started', () => {
    render(<GenerationQueue tasks={[task({ id: 'a', status: 'pending' })]} />);
    expect(fillArc()).toBeNull();
  });

  it('sizes the thumbnail from the requested ratio and clamps it', () => {
    const { rerender } = render(<GenerationQueue tasks={[task({ id: 'a' })]} />);
    expect(thumbWidth()).toBe('18px');
    rerender(<GenerationQueue tasks={[task({ id: 'a', ratio: 1 })]} />);
    expect(thumbWidth()).toBe('10px');
    rerender(<GenerationQueue tasks={[task({ id: 'a', ratio: 9 / 16 })]} />);
    expect(thumbWidth()).toBe('6px');
    rerender(<GenerationQueue tasks={[task({ id: 'a', ratio: 4 })]} />);
    expect(thumbWidth()).toBe('18px');
  });
});
