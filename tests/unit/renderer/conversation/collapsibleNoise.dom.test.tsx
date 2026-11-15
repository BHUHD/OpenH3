/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CollapsibleNoise from '@/renderer/pages/conversation/runtime/GenerationCard/CollapsibleNoise';

afterEach(cleanup);

const toggle = (): HTMLElement => screen.getByRole('button', { name: /Tool steps/ });

describe('CollapsibleNoise', () => {
  it('keeps its content hidden behind the summary line by default', () => {
    render(
      <CollapsibleNoise label='Tool steps (3)'>
        <div>tool detail</div>
      </CollapsibleNoise>
    );
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('tool detail')).not.toBeInTheDocument();
  });

  it('expands and collapses on click', () => {
    render(
      <CollapsibleNoise label='Tool steps (3)'>
        <div>tool detail</div>
      </CollapsibleNoise>
    );
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('tool detail')).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('tool detail')).not.toBeInTheDocument();
  });

  it('stays open while forced open, for example during a running tool', () => {
    const { rerender } = render(
      <CollapsibleNoise label='Tool steps (3)' forceOpen>
        <div>tool detail</div>
      </CollapsibleNoise>
    );
    expect(screen.getByText('tool detail')).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(screen.getByText('tool detail')).toBeInTheDocument();
    rerender(
      <CollapsibleNoise label='Tool steps (3)'>
        <div>tool detail</div>
      </CollapsibleNoise>
    );
    expect(screen.getByText('tool detail')).toBeInTheDocument();
  });
});
