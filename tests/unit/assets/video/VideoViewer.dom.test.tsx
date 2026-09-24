import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ metadata: vi.fn(), draft: vi.fn(), register: vi.fn(() => () => {}) }));
vi.mock('@/common', () => ({ ipcBridge: { fs: { getContentMetadata: { invoke: h.metadata } } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/file/fileUrls', () => ({ buildFileStreamUrl: () => '/api/fs/stream?kind=upload' }));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({ requestConversationSendBoxPrefill: h.draft }));
vi.mock('@/renderer/pages/conversation/Preview/context/tabReloaderRegistry', () => ({
  registerTabReloader: h.register,
}));
import VideoViewer from '@/renderer/pages/conversation/Preview/components/Video';
const file = { kind: 'upload' as const, path: '/uploads/clip.mp4' };
beforeEach(() => {
  h.metadata.mockResolvedValue({ lastModified: 123, size: 500 });
  h.draft.mockReset();
});
function loaded(container: HTMLElement) {
  const video = container.querySelector('video')!;
  Object.defineProperty(video, 'duration', { configurable: true, value: 6 });
  fireEvent.loadedMetadata(video);
  return video;
}
describe('video preview selection', () => {
  it('does not clear a loaded selection when the parent supplies an equivalent file reference', async () => {
    const { container, rerender } = render(<VideoViewer fileRef={file} conversationId='chat-1' />);
    loaded(container);
    await waitFor(() => expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeEnabled());
    rerender(<VideoViewer fileRef={{ ...file }} conversationId='chat-1' />);
    expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeEnabled();
  });
  it('requires loaded media before adding a selection and submits a file reference to the correct draft', async () => {
    const { container } = render(<VideoViewer fileRef={file} conversationId='chat-1' />);
    expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeDisabled();
    loaded(container);
    await waitFor(() => expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'preview.addToChat' }));
    await waitFor(() =>
      expect(h.draft).toHaveBeenCalledWith('chat-1', expect.stringContaining('"endSeconds": 6'), [file])
    );
  });
  it('disables selection on unsupported or corrupt video', () => {
    const { container } = render(<VideoViewer fileRef={file} conversationId='chat-1' />);
    const video = loaded(container);
    fireEvent.error(video);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeDisabled();
  });
  it('rejects a source that changes after the selection was opened', async () => {
    h.metadata
      .mockResolvedValueOnce({ lastModified: 123, size: 500 })
      .mockResolvedValue({ lastModified: 124, size: 500 });
    const { container } = render(<VideoViewer fileRef={file} conversationId='chat-1' />);
    loaded(container);
    await waitFor(() => expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'preview.addToChat' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('preview.video.sourceChanged'));
    expect(h.draft).not.toHaveBeenCalled();
  });
  it('does not allow sending without an explicit conversation target', () => {
    const { container } = render(<VideoViewer fileRef={file} />);
    loaded(container);
    expect(screen.getByRole('button', { name: 'preview.addToChat' })).toBeDisabled();
  });
});
