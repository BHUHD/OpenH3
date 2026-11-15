/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Image } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationImage from '@/renderer/components/media/ConversationImage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const SRC = '/api/comfy/jobs/job-1/artifacts/0';
const ALT = 'Generated artifact 1';

/** Images inside the Arco preview overlay that carry this artifact's alt text. */
const overlayImages = (): HTMLImageElement[] =>
  Array.from(document.body.querySelectorAll<HTMLImageElement>('.arco-image-preview img')).filter(
    (image) => image.getAttribute('alt') === ALT
  );

const openPreview = (): void => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(ALT) }));
};

describe('ConversationImage full-size preview', () => {
  it('opens the viewer with its own source when there is no enclosing preview group', async () => {
    render(<ConversationImage src={SRC} alt={ALT} />);
    openPreview();
    await waitFor(() => expect(overlayImages()).toHaveLength(1));
    expect(overlayImages()[0]).toHaveAttribute('src', SRC);
  });

  it('still resolves its source inside the MessageList Image.PreviewGroup', async () => {
    // MessageList wraps every message in a group whose URL map never contains this raw <img>;
    // a bare Image.Preview would read that map and open with an empty src.
    render(
      <Image.PreviewGroup>
        <ConversationImage src={SRC} alt={ALT} />
      </Image.PreviewGroup>
    );
    openPreview();
    await waitFor(() => expect(overlayImages()).toHaveLength(1));
    expect(overlayImages()[0]).toHaveAttribute('src', SRC);
  });
});
