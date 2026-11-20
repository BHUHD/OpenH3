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
import { summarizeWorkProgress, visibleWorkRows } from './summarizeWorkProgress';
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
  const taskLabel = (task: WorkTask) =>
    task.summaryKey
      ? t(`conversation.workProgress.summaries.${task.summaryKey}`)
      : task.title || t(`conversation.workProgress.kinds.${task.kind}`);

  const overview = summarizeWorkProgress(snapshot);
  const current = visibleWorkRows(snapshot.tasks.filter((item) => !item.historical));
  const history = visibleWorkRows(snapshot.tasks.filter((item) => item.historical));
  const leaves = current.flatMap((task) => (task.children?.length ? task.children : [task]));
  if (!snapshot.tasks.length) return null;
  const statusText = overview.task
    ? taskLabel(overview.task)
    : overview.status === 'history' || overview.status === 'partial'
      ? t(`conversation.workProgress.${overview.status}`)
      : t(`conversation.workProgress.statuses.${overview.status}`);
  const meter = overview.meter;
  const measurement =
    meter?.unit === 'percent'
      ? `${meter.value}%`
      : meter && t('conversation.planBar.progress', { completed: meter.value, total: meter.max });

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
        aria-label={[
          overview.media && t('conversation.workProgress.kinds.generation'),
          statusText,
          measurement,
          expanded ? t('conversation.planBar.collapse') : t('conversation.planBar.expand'),
        ]
          .filter(Boolean)
          .join(' · ')}
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
          className={`text-13px font-[500] truncate min-w-0 max-w-240px ${overview.status === 'failed' ? 'text-danger' : 'text-t-primary'}`}
        >
          {overview.media && <>{t('conversation.workProgress.kinds.generation')} · </>}
          {statusText}
        </span>
        {meter && (
          <>
            <div
              role='progressbar'
              aria-label={overview.task ? taskLabel(overview.task) : t('conversation.planBar.title')}
              aria-valuemin={0}
              aria-valuemax={meter.max}
              aria-valuenow={meter.value}
              aria-valuetext={measurement}
              className={`${styles.track} rd-full bg-3 overflow-hidden`}
            >
              <div
                className='h-full rd-full bg-primary transition-all duration-300'
                style={{ width: `${(meter.value / meter.max) * 100}%` }}
              />
            </div>
            <span className='text-12px tabular-nums shrink-0'>{measurement}</span>
          </>
        )}
      </div>

      {/* Expanded task list */}
      {expanded && (
        <div
          className='flex flex-col gap-8px pt-8px px-12px overflow-y-auto overscroll-contain'
          style={{ maxHeight: 'min(22vh, 180px)' }}
        >
          {[...current, ...history].map((task, i) => {
            const taskLeaves = task.children?.length ? task.children : [task];
            const isRunning = task.status === 'running' || taskLeaves.some((e) => e.status === 'running');
            const percent = isRunning ? realProgress(task) : undefined;
            return (
              <React.Fragment key={task.id}>
                {i === current.length && (
                  <div className='text-12px text-t-secondary'>{t('conversation.workProgress.history')}</div>
                )}
                <div data-status={task.status} className='flex items-center gap-10px text-13px text-t-secondary'>
                  {task.kind === 'generation' ? (
                    <GenerationThumb task={task} running={isRunning} />
                  ) : (
                    <span
                      className={[
                        'size-5px rd-full shrink-0',
                        isRunning
                          ? 'bg-primary'
                          : task.status === 'completed'
                            ? 'bg-success'
                            : task.status === 'failed'
                              ? 'bg-danger'
                              : 'bg-3',
                      ].join(' ')}
                      aria-hidden='true'
                    />
                  )}
                  <span className={isRunning ? 'text-t-primary truncate min-w-0' : 'truncate min-w-0'}>
                    {taskLabel(task)}
                  </span>
                  <span className='text-12px text-t-secondary tabular-nums ml-auto shrink-0'>
                    {percent !== undefined
                      ? `${Math.round(percent)}%`
                      : t(`conversation.workProgress.statuses.${task.status}`)}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorkProgressBar;
