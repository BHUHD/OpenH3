import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockIsMobile = false;
let mockPreviewOpen = true;

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: mockIsMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ isOpen: mockPreviewOpen, openRevision: 0, isMaximized: false }),
  usePreviewContextOptional: () => ({ isOpen: mockPreviewOpen, openRevision: 0, isMaximized: false }),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel', () => ({
  default: () => <div data-testid='preview-panel'>preview</div>,
}));

vi.mock('@/renderer/pages/conversation/components/ChatTitleEditor', () => ({
  default: () => <div>title</div>,
}));

vi.mock('@/renderer/components/agent/AgentBadge', () => ({
  AgentLogoIcon: () => <div>logo</div>,
}));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: () => ({
    splitRatio: 60,
    setSplitRatio: vi.fn(),
    createDragHandle: () => null,
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({ containerRef: { current: null }, containerWidth: 800 }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useTitleRename', () => ({
  useTitleRename: () => ({
    editingTitle: false,
    setEditingTitle: vi.fn(),
    titleDraft: '',
    setTitleDraft: vi.fn(),
    renameLoading: false,
    canRenameTitle: false,
    submitTitleRename: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useWorkspaceCollapse', () => ({
  useWorkspaceCollapse: () => {
    const [rightSiderCollapsed, setRightSiderCollapsed] = useState(true);
    return { rightSiderCollapsed, setRightSiderCollapsed };
  },
}));

import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import { publishWorkProgress, resetWorkProgressForTest } from '@/renderer/pages/conversation/PlanBar/workProgress';

function renderChatLayout(previewHosted: boolean) {
  return render(
    <ChatLayout previewHosted={previewHosted} sider={<div>sider</div>} workspaceEnabled={false}>
      <div>chat body</div>
    </ChatLayout>
  );
}

describe('ChatLayout workspace panel', () => {
  afterEach(() => {
    mockIsMobile = false;
    mockPreviewOpen = true;
    resetWorkProgressForTest();
  });

  it('yields the preview to the Layout host on mobile for project conversations', () => {
    mockIsMobile = true;
    renderChatLayout(true);
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
  });

  it('yields the preview to the Layout host on desktop for project conversations', () => {
    mockIsMobile = false;
    renderChatLayout(true);
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'renders preview inside the local panel when isMobile=%s for a non-project conversation',
    (isMobile) => {
      mockIsMobile = isMobile;
      const { container } = renderChatLayout(false);
      const frame = container.querySelector('.chat-layout-right-sider');
      expect(frame).toHaveAttribute('data-collapsed', 'false');
      expect(frame).toContainElement(screen.getByTestId('preview-panel'));
      expect(screen.getByText('chat body')).toBeVisible();
    }
  );

  it('does not allocate a second right column for project progress on either desktop or mobile', () => {
    publishWorkProgress('project-chat', {
      tasks: [{ id: 'install', title: 'Download model', kind: 'install', status: 'running' }],
      isProcessing: false,
      pendingConfirmations: 0,
    });
    const { container, rerender } = render(
      <ChatLayout conversation_id='project-chat' previewHosted sider={<div>sider</div>} workspaceEnabled={false}>
        <div>chat body</div>
      </ChatLayout>
    );
    expect(container.querySelector('.chat-layout-right-sider')).toBeNull();
    expect(screen.queryByTestId('conversation-work-progress')).not.toBeInTheDocument();
    mockIsMobile = true;
    rerender(
      <ChatLayout conversation_id='project-chat' previewHosted sider={<div>sider</div>} workspaceEnabled={false}>
        <div>chat body</div>
      </ChatLayout>
    );
    expect(container.querySelector('.chat-layout-right-sider')).toBeNull();
  });

  it('keeps the right panel collapsed for task progress without a workspace', () => {
    mockPreviewOpen = false;
    publishWorkProgress('no-workspace', {
      tasks: [{ id: 'bash', title: 'Build preview', kind: 'background', status: 'running' }],
      isProcessing: false,
      pendingConfirmations: 0,
    });
    const { container } = render(
      <ChatLayout conversation_id='no-workspace' sider={null} workspaceEnabled={false}>
        <div>chat body</div>
      </ChatLayout>
    );
    // The existing right-panel shell stays collapsed when inline task progress starts.
    expect(container.querySelector('.chat-layout-right-sider')).toHaveStyle({ width: '0px' });
    // The inline bar is rendered by the send box layer (AcpSendBox), not ChatLayout itself
    expect(screen.queryByTestId('conversation-work-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conversation-plan-bar')).not.toBeInTheDocument();
  });
});
