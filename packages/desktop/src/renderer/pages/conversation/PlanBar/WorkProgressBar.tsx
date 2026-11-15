/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Down, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useWorkProgress } from '@/renderer/pages/conversation/PlanBar/workProgress';
import type { WorkTask } from '@/renderer/pages/conversation/PlanBar/workProgress';
import GenerationQueue from '@/renderer/pages/conversation/runtime/GenerationCard/GenerationQueue';
import styles from './WorkProgressBar.module.css';

type WorkProgressBarProps = {
  conversationId: string;
};

const THUMB_HEIGHT = 28;
const DEFAULT_RATIO = 16 / 9;

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/** Real backend progress (0-100) only; never a guessed value. */
const realProgress = (task: WorkTask): number | undefined =>
  typeof task.progress === 'number' && Number.isFinite(task.progress) ? clampPercent(task.progress) : undefined;

/** Ratio-true stand-in for a generation's output, so each queued job reads as the image or video it will become. */
const GenerationThumb: React.FC<{ task: WorkTask; running: boolean }> = ({ task, running }) => {
  const ratio = task.ratio !== undefined && task.ratio > 0 ? task.ratio : DEFAULT_RATIO;
  const width = Math.min(56, Math.max(20, Math.round(ratio * THUMB_HEIGHT)));
  const percent = realProgress(task);
  return (
    <span
      aria-hidden='true'
      className={`relative shrink-0 overflow-hidden rd-4px border border-solid border-3 ${running ? 'bg-3' : 'bg-2'}`}
      style={{ width, height: THUMB_HEIGHT }}
    >
      {running && percent !== undefined && (
        <span className='absolute bottom-0 h-3px bg-primary' style={{ width: `${percent}%`, insetInlineStart: 0 }} />
      )}
    </span>
  );
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
  const running = leaves.filter((e) => e.status === 'running');
  const anyRunning = running.length > 0;
  const anyPending = leaves.some((e) => e.status === 'pending');
  const anyWaiting = leaves.some((e) => e.status === 'waiting');
  const anyFailed = leaves.some((e) => e.status === 'failed');
  const anyInterrupted = leaves.some((e) => e.status === 'interrupted' || e.status === 'cancelled');

  if (!total) return null;

  const waiting = anyWaiting || snapshot.pendingConfirmations > 0;

  // Derive status text from leaf states to cover all WorkStatus values.
  // This ensures background tasks, pending queues and waiting confirmations
  // all display the correct label instead of always falling through to "completed".
  const statusText = anyRunning
    ? (tasks.find((task) => task.status === 'running')?.title ?? t('conversation.workProgress.statuses.running'))
    : waiting
      ? t('conversation.workProgress.statuses.waiting')
      : anyPending
        ? t('conversation.workProgress.statuses.pending')
        : anyFailed
          ? t('conversation.workProgress.statuses.failed')
          : anyInterrupted
            ? t('conversation.workProgress.statuses.interrupted')
            : t('conversation.workProgress.statuses.completed');
  const failedOnly = !anyRunning && !waiting && !anyPending && anyFailed;

  // Running generations that report real progress move the bar between whole-task completions.
  const partial = running.reduce((sum, task) => sum + (realProgress(task) ?? 0) / 100, 0);
  const percentNow = Math.round(Math.min(1, (completed + partial) / total) * 100);
  const livePercents = running.map(realProgress).filter((value): value is number => value !== undefined);
  const livePercent = livePercents.length === 1 ? Math.round(livePercents[0]) : undefined;

  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      data-work-progress-bar
      data-testid='work-progress-bar'
      className={`${styles.bar} shrink-0 px-12px pt-4px pb-6px`}
    >
      {/* Summary row */}
      <div
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? t('conversation.planBar.collapse') : t('conversation.planBar.expand')}
        className='flex items-center gap-10px px-12px py-8px rd-12px bg-2 cursor-pointer select-none text-t-secondary hover:text-t-primary transition-colors'
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {expanded ? <Down size={13} /> : <Right size={13} />}
        <GenerationQueue tasks={leaves} />
        <span
          className={`text-13px font-[500] truncate min-w-0 max-w-240px ${failedOnly ? 'text-danger' : 'text-t-primary'}`}
        >
          {statusText}
        </span>
        {/* Progress track */}
        <div
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentNow}
          className={`${styles.track} rd-full bg-3 overflow-hidden`}
        >
          <div className='h-full rd-full bg-primary transition-all duration-300' style={{ width: `${percentNow}%` }} />
        </div>
        <span className='text-12px tabular-nums shrink-0'>
          {livePercent !== undefined ? `${livePercent}%` : t('conversation.planBar.progress', { completed, total })}
        </span>
      </div>

      {/* Expanded task list */}
      {expanded && (
        <div
          className='flex flex-col gap-8px pt-8px px-12px overflow-y-auto overscroll-contain'
          style={{ maxHeight: 'min(22vh, 180px)' }}
        >
          {tasks.map((task, i) => {
            const taskLeaves = task.children?.length ? task.children : [task];
            const done = taskLeaves.filter((e) => e.status === 'completed').length;
            const isRunning = task.status === 'running' || taskLeaves.some((e) => e.status === 'running');
            const percent = isRunning ? realProgress(task) : undefined;
            return (
              <div key={`${i}-${task.id}`} className='flex items-center gap-10px text-13px text-t-secondary'>
                {task.kind === 'generation' ? (
                  <GenerationThumb task={task} running={isRunning} />
                ) : (
                  <span
                    className={[
                      'size-5px rd-full shrink-0',
                      isRunning ? 'bg-primary' : done === taskLeaves.length ? 'bg-success' : 'bg-3',
                    ].join(' ')}
                    aria-hidden='true'
                  />
                )}
                <span className={isRunning ? 'text-t-primary truncate min-w-0' : 'truncate min-w-0'}>
                  {task.title ?? t(`conversation.workProgress.kinds.${task.kind}`)}
                </span>
                {task.children?.length ? (
                  <span className='text-12px text-t-disabled tabular-nums ml-auto shrink-0'>
                    {done}/{taskLeaves.length}
                  </span>
                ) : percent !== undefined ? (
                  <span className='text-12px text-t-secondary tabular-nums ml-auto shrink-0'>
                    {Math.round(percent)}%
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
