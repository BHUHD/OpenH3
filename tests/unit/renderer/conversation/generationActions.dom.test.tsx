/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Message } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GenerationActions from '@/renderer/pages/conversation/runtime/GenerationCard/GenerationActions';

const m = vi.hoisted(() => ({ copyText: vi.fn(), prefill: vi.fn(), download: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: m.copyText }));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({ requestConversationSendBoxPrefill: m.prefill }));
vi.mock('@/renderer/pages/conversation/runtime/GenerationCard/downloadArtifact', () => ({
  downloadArtifact: m.download,
}));

const SRC = 'http://127.0.0.1:33002/api/comfy/jobs/j1/artifacts/0';
const button = (name: string): HTMLElement => screen.getByRole('button', { name: new RegExp(name) });
const hasButton = (name: string): boolean => screen.queryByRole('button', { name: new RegExp(name) }) !== null;

beforeEach(() => {
  m.copyText.mockResolvedValue(undefined);
  m.download.mockResolvedValue(undefined);
  vi.spyOn(Message, 'success').mockReturnValue(undefined as never);
  vi.spyOn(Message, 'error').mockReturnValue(undefined as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GenerationActions', () => {
  it('offers only download when the job recorded neither a prompt nor a path', () => {
    render(<GenerationActions src={SRC} fileName='a.png' />);
    expect(hasButton('common.download')).toBe(true);
    expect(hasButton('copyPrompt')).toBe(false);
    expect(hasButton('regenerate')).toBe(false);
    expect(hasButton('useAsReference')).toBe(false);
  });

  it('offers every action when prompt, path and conversation are known', () => {
    render(
      <GenerationActions conversationId='c1' src={SRC} fileName='a.png' prompt='a cat' referencePath='D:/out/a.png' />
    );
    expect(hasButton('common.download')).toBe(true);
    expect(hasButton('copyPrompt')).toBe(true);
    expect(hasButton('regenerate')).toBe(true);
    expect(hasButton('useAsReference')).toBe(true);
  });

  it('hides the actions that need a conversation when there is none', () => {
    render(<GenerationActions src={SRC} fileName='a.png' prompt='a cat' referencePath='D:/out/a.png' />);
    expect(hasButton('copyPrompt')).toBe(true);
    expect(hasButton('regenerate')).toBe(false);
    expect(hasButton('useAsReference')).toBe(false);
  });

  it('downloads the artifact under its file name', async () => {
    render(<GenerationActions src={SRC} fileName='a.png' />);
    fireEvent.click(button('common.download'));
    await waitFor(() => expect(m.download).toHaveBeenCalledWith(SRC, 'a.png'));
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('reports a failed download', async () => {
    m.download.mockRejectedValue(new Error('boom'));
    render(<GenerationActions src={SRC} fileName='a.png' />);
    fireEvent.click(button('common.download'));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('common.saveFailed'));
  });

  it('copies the recorded prompt', async () => {
    render(<GenerationActions src={SRC} fileName='a.png' prompt='a cat' />);
    fireEvent.click(button('copyPrompt'));
    expect(m.copyText).toHaveBeenCalledWith('a cat');
    await waitFor(() => expect(Message.success).toHaveBeenCalledWith('common.copySuccess'));
  });

  it('reports a failed copy', async () => {
    m.copyText.mockRejectedValue(new Error('denied'));
    render(<GenerationActions src={SRC} fileName='a.png' prompt='a cat' />);
    fireEvent.click(button('copyPrompt'));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('common.copyFailed'));
  });

  it('prefills the send box with the prompt to generate again', () => {
    render(<GenerationActions conversationId='c1' src={SRC} fileName='a.png' prompt='a cat' />);
    fireEvent.click(button('regenerate'));
    expect(m.prefill).toHaveBeenCalledWith('c1', 'a cat');
  });

  it('prefills the send box with the image as a local reference', () => {
    render(<GenerationActions conversationId='c1' src={SRC} fileName='a.png' referencePath='D:/out/a.png' />);
    fireEvent.click(button('useAsReference'));
    expect(m.prefill).toHaveBeenCalledWith('c1', 'conversation.generationActions.referencePrompt', [
      { kind: 'local', path: 'D:/out/a.png' },
    ]);
  });
});
