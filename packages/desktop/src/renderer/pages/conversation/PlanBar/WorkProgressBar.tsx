/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useWorkProgress } from '@/renderer/pages/conversation/PlanBar/workProgress';

type WorkProgressBarProps = {
  conversationId: string;
};

/** Compact inline progress bar rendered above the send box.
 * Replaces the right-column WorkProgress panel for non-project conversations.
 * Renders nothing while there are no active tasks.
 */
const WorkProgressBar: React.FC<WorkProgressBarProps> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);
  const snapshot = useWorkProgress(conversationId);

  const tasks = snapshot.tasks.flatMap((task) => (task.kind === 'plan' && task.children ? task.children : [task]));
  const leaves = tasks.flatMap((task) => (task.children?.length ? task.children : [task]));
  const completed = leaves.filter((e) => e.status === 'completed').length;
  const total = leaves.length;
  const anyRunning = leaves.some((e) => e.status === 'running');
  const anyPending = leaves.some((e) => e.status === 'pending');
  const anyWaiting = leaves.some((e) => e.status === 'waiting');
  const anyFailed = leaves.some((e) => e.status === 'failed');
  const anyInterrupted = leaves.some((e) => e.status === 'interrupted' || e.status === 'cancelled');
  const isActive = snapshot.isProcessing || anyRunning || anyPending || anyWaiting;

  if (!total) return null;

  // Derive status text from leaf states to cover all WorkStatus values.
  // This ensures background tasks, pending queues and waiting confirmations
  // all display the correct label instead of always falling through to "completed".
  const statusText = anyRunning
    ? (tasks.find((t) => t.status === 'running')?.title ?? t('conversation.workProgress.statuses.running'))
    : anyWaiting || snapshot.pendingConfirmations > 0
      ? t('conversation.workProgress.statuses.waiting')
      : anyPending
        ? t('conversation.workProgress.statuses.pending')
        : anyFailed
          ? t('conversation.workProgress.statuses.failed')
          : anyInterrupted
            ? t('conversation.workProgress.statuses.interrupted')
            : t('conversation.workProgress.statuses.completed');

  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      data-work-progress-bar
      data-testid='work-progress-bar'
      className='shrink-0 border-t border-solid border-3 border-s-0 border-e-0 border-b-0'
    >
      {/* Summary row */}
      <div
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? t('conversation.planBar.collapse') : t('conversation.planBar.expand')}
        className='flex items-center gap-8px px-16px py-6px cursor-pointer select-none text-t-secondary hover:text-t-primary transition-colors'
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {expanded ? <Down size={13} /> : <Right size={13} />}
        {/* Progress track */}
        <div
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          className='h-3px rd-full bg-3 flex-1 overflow-hidden'
          style={{ maxWidth: 120 }}
        >
          <div
            className='h-full rd-full bg-primary transition-all duration-300'
            style={{ width: total > 0 ? `${Math.round((completed / total) * 100)}%` : '0%' }}
          />
        </div>
        <span className='text-12px tabular-nums'>{t('conversation.planBar.progress', { completed, total })}</span>
        <span className='text-12px text-t-secondary truncate max-w-240px'>{statusText}</span>
      </div>

      {/* Expanded task list */}
      {expanded && (
        <div
          className='flex flex-col gap-6px pb-8px px-16px overflow-y-auto overscroll-contain'
          style={{ maxHeight: 'min(22vh, 180px)' }}
        >
          {tasks.map((task, i) => {
            const taskLeaves = task.children?.length ? task.children : [task];
            const done = taskLeaves.filter((e) => e.status === 'completed').length;
            const running = task.status === 'running' || taskLeaves.some((e) => e.status === 'running');
            return (
              <div key={`${i}-${task.id}`} className='flex items-center gap-8px text-13px text-t-secondary'>
                <span
                  className={[
                    'size-5px rd-full shrink-0',
                    running ? 'bg-primary' : done === taskLeaves.length ? 'bg-success' : 'bg-3',
                  ].join(' ')}
                  aria-hidden='true'
                />
                <span className={running ? 'text-t-primary' : undefined}>
                  {task.title ?? t(`conversation.workProgress.kinds.${task.kind}`)}
                </span>
                {task.children?.length ? (
                  <span className='text-12px text-t-disabled tabular-nums ml-auto'>
                    {done}/{taskLeaves.length}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorkProgressBar;
