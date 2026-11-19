/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the heavy tree; the column test only covers host chrome (gating, collapse).
vi.mock('@/renderer/pages/conversation/explorer/ExplorerContainer', () => ({
  ExplorerContainer: ({ projectId }: { projectId: string }) => {
    const { openPreview } = usePreviewContext();
    return (
      <div data-testid='explorer'>
        {projectId}
        <button
          onClick={() =>
            openPreview('project fixture', 'markdown', {
              file_name: 'fixture.md',
              fileRef: { kind: 'project', pe_id: 'attachment-1', relative_path: 'fixture.md' },
            })
          }
        >
          Open file
        </button>
      </div>
    );
  },
}));
vi.mock('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel', () => ({
  default: () => {
    const { activeTab, closeTab, toggleMaximized } = usePreviewContext();
    return (
      <div data-testid='fixture-preview'>
        {activeTab?.title}
        <button onClick={() => activeTab && closeTab(activeTab.id)}>Close file</button>
        <button onClick={toggleMaximized}>Maximize</button>
      </div>
    );
  },
}));
vi.mock('@/common', () => ({
  ipcBridge: { fileStream: { contentUpdate: { on: () => () => {} } }, preview: { open: { on: () => () => {} } } },
}));
vi.mock('@/renderer/pages/conversation/PlanBar/ConversationWorkProgress', () => ({
  default: () => <div>Task progress</div>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'conversation.explorer.tabs.files': 'Files',
        'conversation.workProgress.tab': 'Progress',
        'preview.preview': 'Preview',
      })[key] ?? key,
  }),
}));

import { ProjectPanelHost } from '@/renderer/components/layout/ProjectPanelHost';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import {
  setCurrentConversation,
  resetCurrentConversationForTest,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import {
  setCurrentProject,
  resetCurrentProjectForTest,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';

const renderHost = (host: React.ReactNode) => render(host, { wrapper: PreviewProvider });
const BrowserLauncher = () => {
  const { openBrowserTab } = usePreviewContext();
  return <button onClick={() => openBrowserTab()}>Open browser</button>;
};

beforeEach(() => {
  resetCurrentProjectForTest();
  resetCurrentConversationForTest();
});
afterEach(() => cleanup());

describe('ProjectPanelHost (Layout-level host chrome)', () => {
  it('renders nothing when there is no active project', () => {
    renderHost(<ProjectPanelHost widthPx={260} collapsed={false} />);
    expect(document.querySelector('[data-explorer-column]')).toBeNull();
    expect(screen.queryByTestId('explorer')).not.toBeInTheDocument();
  });

  it('renders the explorer column (expanded) for the active project', () => {
    setCurrentProject('proj-9');
    renderHost(<ProjectPanelHost widthPx={280} collapsed={false} />);
    const col = document.querySelector('[data-explorer-column]') as HTMLElement;
    expect(col).not.toBeNull();
    expect(col.getAttribute('data-mount-id')).toBeTruthy();
    expect(col.getAttribute('data-collapsed')).toBe('false');
    expect(col.style.width).toBe('280px');
    expect(screen.getByTestId('explorer')).toHaveTextContent('proj-9');
  });

  it('collapses to width 0 but keeps the explorer mounted (no remount)', () => {
    setCurrentProject('proj-9');
    renderHost(<ProjectPanelHost widthPx={280} collapsed />);
    const col = document.querySelector('[data-explorer-column]') as HTMLElement;
    expect(col.getAttribute('data-collapsed')).toBe('true');
    expect(col.style.width).toBe('0px');
    // Component stays mounted — collapse is width-only, not an unmount.
    expect(screen.getByTestId('explorer')).toHaveTextContent('proj-9');
  });

  it('does not render a duplicate collapse control inside the explorer column', () => {
    setCurrentProject('proj-9');
    renderHost(<ProjectPanelHost widthPx={280} collapsed={false} />);
    expect(screen.queryByLabelText('common.collapse')).not.toBeInTheDocument();
  });

  it('opens and reopens a file in Preview within the same column', () => {
    setCurrentProject('proj-9');
    setCurrentConversation('chat-1');
    const { container } = renderHost(<ProjectPanelHost widthPx={280} collapsed={false} />);
    const selectedTab = (name: string) =>
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    const explorer = screen.getByTestId('explorer');
    selectedTab('Files');
    expect(screen.getByRole('tab', { name: 'Progress' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Preview' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    selectedTab('Preview');
    const preview = screen.getByTestId('fixture-preview');
    expect(container.querySelector('[data-project-panel-host]')).toContainElement(preview);
    expect(screen.getByTestId('explorer')).toBe(explorer);
    expect(explorer).not.toBeVisible();
    expect(preview).toHaveTextContent('fixture.md');

    fireEvent.click(screen.getByRole('tab', { name: 'Progress' }));
    selectedTab('Progress');
    expect(screen.getByText('Task progress')).toBeVisible();
    expect(preview).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    selectedTab('Preview');
    expect(screen.getByTestId('fixture-preview')).toBe(preview);

    fireEvent.click(screen.getByRole('button', { name: 'Close file' }));
    expect(screen.queryByRole('tab', { name: 'Preview' })).toBeNull();
    selectedTab('Files');
  });

  it('keeps a preview in the same panel across project conversations and viewport changes', () => {
    setCurrentProject('proj-9');
    setCurrentConversation('chat-1');
    const { container, rerender } = renderHost(<ProjectPanelHost widthPx={280} collapsed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    const preview = screen.getByTestId('fixture-preview');
    const host = container.querySelector('[data-project-panel-host]');

    act(() => setCurrentConversation('chat-2'));
    rerender(<ProjectPanelHost widthPx={360} collapsed={false} isMobile />);
    expect(container.querySelector('[data-explorer-mobile-overlay]')).toBe(host);
    expect(host).toContainElement(preview);
    expect(preview).toBeVisible();
  });

  it('routes a browser preview opened from outside the Explorer to the same narrow panel', () => {
    setCurrentProject('proj-9');
    setCurrentConversation('chat-1');
    const { container } = renderHost(
      <>
        <BrowserLauncher />
        <ProjectPanelHost widthPx={360} collapsed={false} isMobile />
      </>
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open browser' }));
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-explorer-mobile-overlay]')).toContainElement(
      screen.getByTestId('fixture-preview')
    );
  });
});
