/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import GenerationCanvas from '@/renderer/pages/conversation/runtime/GenerationCard/GenerationCanvas';

afterEach(cleanup);

const canvas = (): HTMLElement => screen.getByTestId('generation-canvas');
const ratioOf = (): number => Number(canvas().style.getPropertyValue('--generation-ratio'));

describe('GenerationCanvas', () => {
  it('is decorative, so status and cancel stay with the owning card', () => {
    render(<GenerationCanvas />);
    expect(canvas()).toHaveAttribute('aria-hidden', 'true');
  });

  it('defaults to 16:9 when the request carries no size', () => {
    render(<GenerationCanvas />);
    expect(ratioOf()).toBeCloseTo(16 / 9);
  });

  it('uses the requested ratio', () => {
    render(<GenerationCanvas ratio={9 / 16} />);
    expect(ratioOf()).toBeCloseTo(9 / 16);
  });

  it('clamps extreme ratios and ignores invalid ones', () => {
    const { rerender } = render(<GenerationCanvas ratio={10} />);
    expect(ratioOf()).toBeCloseTo(2.5);
    rerender(<GenerationCanvas ratio={0.01} />);
    expect(ratioOf()).toBeCloseTo(0.4);
    rerender(<GenerationCanvas ratio={Number.NaN} />);
    expect(ratioOf()).toBeCloseTo(16 / 9);
    rerender(<GenerationCanvas ratio={-2} />);
    expect(ratioOf()).toBeCloseTo(16 / 9);
  });

  it('draws a progress fill only when real progress is reported', () => {
    const { rerender } = render(<GenerationCanvas />);
    expect(canvas().innerHTML).not.toContain('scaleX');
    rerender(<GenerationCanvas percent={50} />);
    expect(canvas().innerHTML).toContain('scaleX(0.5)');
    rerender(<GenerationCanvas percent={250} />);
    expect(canvas().innerHTML).toContain('scaleX(1)');
  });
});
