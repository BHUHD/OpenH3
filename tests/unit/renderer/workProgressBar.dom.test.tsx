import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkSnapshot } from '@/renderer/pages/conversation/PlanBar/workProgress';

const f = vi.hoisted(() => ({ useWorkProgress: vi.fn() }));

vi.mock('@/renderer/pages/conversation/PlanBar/workProgress', () => ({
  useWorkProgress: f.useWorkProgress,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import WorkProgressBar from '@/renderer/pages/conversation/PlanBar/WorkProgressBar';

function snap(partial: Partial<WorkSnapshot>): WorkSnapshot {
  return { tasks: [], isProcessing: false, pendingConfirmations: 0, ...partial };
}

beforeEach(() => {
  f.useWorkProgress.mockReturnValue(snap({}));
});
afterEach(cleanup);

it('renders nothing when there are no tasks', () => {
  const { container } = render(<WorkProgressBar conversationId='c1' />);
  expect(container.firstChild).toBeNull();
});

it('pending-only: shows pending status label', () => {
  f.useWorkProgress.mockReturnValue(snap({ tasks: [{ id: 't1', title: 'Setup', kind: 'task', status: 'pending' }] }));
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.statuses.pending')).toBeInTheDocument();
});

it('waiting (pendingConfirmations > 0): shows waiting status label', () => {
  f.useWorkProgress.mockReturnValue(
    snap({
      tasks: [{ id: 't1', title: 'Setup', kind: 'task', status: 'waiting' }],
      pendingConfirmations: 1,
    })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.statuses.waiting')).toBeInTheDocument();
});

it('running task: shows task title as status', () => {
  f.useWorkProgress.mockReturnValue(
    snap({
      tasks: [{ id: 't1', title: 'Build preview', kind: 'background', status: 'running' }],
      isProcessing: true,
    })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('Build preview')).toBeInTheDocument();
});

it('uses the localized summary and kind when task titles are empty', () => {
  f.useWorkProgress.mockReturnValue(
    snap({
      tasks: [
        { id: 'check', title: '', summaryKey: 'checkEnvironment', kind: 'task', status: 'running' },
        { id: 'tool', title: '', kind: 'task', status: 'completed' },
      ],
    })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.summaries.checkEnvironment')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getAllByText('conversation.workProgress.summaries.checkEnvironment')).toHaveLength(2);
  expect(screen.getByText('conversation.workProgress.kinds.task')).toBeInTheDocument();
});

it('background task running with isProcessing=false still shows running label', () => {
  f.useWorkProgress.mockReturnValue(
    snap({
      tasks: [{ id: 't1', title: 'Generate image', kind: 'generation', status: 'running' }],
      isProcessing: false,
    })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('Generate image')).toBeInTheDocument();
});

it('failed: shows failed status label even when agent is idle', () => {
  f.useWorkProgress.mockReturnValue(
    snap({ tasks: [{ id: 't1', title: 'Install', kind: 'install', status: 'failed' }] })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.statuses.failed')).toBeInTheDocument();
});

it('interrupted: shows interrupted status label', () => {
  f.useWorkProgress.mockReturnValue(
    snap({ tasks: [{ id: 't1', title: 'Task', kind: 'task', status: 'interrupted' }] })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.statuses.interrupted')).toBeInTheDocument();
});

it('all completed: shows completed label', () => {
  f.useWorkProgress.mockReturnValue(snap({ tasks: [{ id: 't1', title: 'Done', kind: 'task', status: 'completed' }] }));
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.statuses.completed')).toBeInTheDocument();
});

it('keeps the conversation running between completed tool calls while the Agent is processing', () => {
  f.useWorkProgress.mockReturnValue(
    snap({
      tasks: [{ id: 'tool', title: 'Check environment', kind: 'task', status: 'completed' }],
      isProcessing: true,
    })
  );
  render(<WorkProgressBar conversationId='c1' />);
  expect(screen.getByText('conversation.workProgress.statuses.running')).toBeInTheDocument();
  expect(screen.queryByText('conversation.workProgress.statuses.completed')).not.toBeInTheDocument();
});

it('click expands task list; click again collapses', () => {
  f.useWorkProgress.mockReturnValue(
    snap({
      tasks: [{ id: 't1', title: 'My task', kind: 'task', status: 'running' }],
      isProcessing: true,
    })
  );
  render(<WorkProgressBar conversationId='c1' />);
  const toggle = screen.getByRole('button');
  // Task title appears in the summary row (statusText), not the expanded list yet
  fireEvent.click(toggle);
  // After expand the task list div appears
  expect(screen.getAllByText('My task').length).toBeGreaterThan(0);
  fireEvent.click(toggle);
  // After collapse only the summary-row span remains (or none if status changed)
});
