/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-prefill-conversation',
    type: 'acp',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { collectChatFileRefs } from '@/renderer/utils/file/messageFiles';
import type { FileSelectionItem } from '@/renderer/utils/file/fileSelection';

const SendBoxHarness = () => {
  const [value, setValue] = useState('Existing draft');
  return <SendBox value={value} onChange={setValue} onSend={vi.fn().mockResolvedValue(undefined)} />;
};

describe('SendBox scheduled-task prefill', () => {
  it('preserves files from consecutive selections and sends them only after explicit confirmation', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MediaSendHarness onSend={onSend} />);
    const one = { kind: 'upload' as const, path: '/uploads/one.mp4' };
    const two = { kind: 'project' as const, pe_id: 'pe', relative_path: 'two.mp4' };
    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'range one', [one]);
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'range two', [two]);
    });
    fireEvent.click(screen.getByTestId('sendbox-send-btn'));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ input: 'range one\nrange two', files: [one, two] }));
  });
  it('attaches the referenced video together with the selection draft without sending automatically', async () => {
    const onFiles = vi.fn();
    const onSend = vi.fn();
    render(<SendBoxHarnessWithFiles onFiles={onFiles} onSend={onSend} />);
    const ref = { kind: 'project' as const, pe_id: 'pe', relative_path: 'clip.mp4' };
    act(() => requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Selected 1-3 seconds', [ref]));
    await waitFor(() =>
      expect(onFiles).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ chatRef: ref })]))
    );
    expect(onSend).not.toHaveBeenCalled();
  });
  it('preserves the draft, focuses the mounted desktop input, and moves the caret to the end', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>Outside focus target</button>
        <SendBoxHarness />
      </div>
    );

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'Outside focus target' }).focus();
    expect(textarea).not.toHaveFocus();

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Create with /cron in AionUi');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nCreate with /cron in AionUi'));
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });

  it('does not force focus on mobile', async () => {
    layoutState.isMobile = true;
    render(
      <div>
        <button type='button'>Mobile outside target</button>
        <SendBoxHarness />
      </div>
    );

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'Mobile outside target' }).focus();

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Create with /cron in AionUi');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nCreate with /cron in AionUi'));
    expect(textarea).not.toHaveFocus();
  });

  it('chains consecutive requests before the controlled value rerenders', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'First /cron prompt');
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Second /cron prompt');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nFirst /cron prompt\nSecond /cron prompt'));
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });

  it('keeps the prefill when the textarea cannot be focused', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    outsideTarget.focus();

    const originalQuerySelector = Element.prototype.querySelector;
    const querySelectorSpy = vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (selector) {
      if (selector === 'textarea' && (this as Element).classList.contains('sendbox-panel')) return null;
      return originalQuerySelector.call(this, selector);
    });

    act(() => {
      requestConversationSendBoxPrefill('sendbox-prefill-conversation', 'Create with /cron in AionUi');
    });

    await waitFor(() => expect(textarea).toHaveValue('Existing draft\nCreate with /cron in AionUi'));
    expect(outsideTarget).toHaveFocus();

    querySelectorSpy.mockRestore();
    outsideTarget.remove();
  });
});

function SendBoxHarnessWithFiles({
  onFiles,
  onSend,
}: {
  onFiles: ReturnType<typeof vi.fn>;
  onSend: ReturnType<typeof vi.fn>;
}) {
  const [value, setValue] = useState('Existing draft');
  return (
    <SendBox
      value={value}
      onChange={setValue}
      onSend={onSend}
      selectedWorkspaceItems={[]}
      onSelectedWorkspaceItemsChange={onFiles}
    />
  );
}

function MediaSendHarness({ onSend }: { onSend: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<FileSelectionItem[]>([]);
  return (
    <SendBox
      value={value}
      onChange={setValue}
      selectedWorkspaceItems={files}
      onSelectedWorkspaceItemsChange={setFiles}
      onSend={async (input) => {
        await onSend({ input, files: collectChatFileRefs([], files) });
      }}
    />
  );
}
