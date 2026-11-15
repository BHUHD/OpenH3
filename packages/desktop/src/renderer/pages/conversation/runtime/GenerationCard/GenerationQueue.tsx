/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import type { WorkTask } from '@/renderer/pages/conversation/PlanBar/workProgress';
import styles from './GenerationQueue.module.css';

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const INDETERMINATE_FRACTION = 0.25;
const MAX_CHIPS = 4;
const THUMB_HEIGHT = 10;
const DEFAULT_RATIO = 16 / 9;

const isActiveGeneration = (task: WorkTask): boolean =>
  task.kind === 'generation' && ['running', 'pending', 'waiting'].includes(task.status);

type GenerationQueueProps = { tasks: WorkTask[] };

/** Decorative ring + ratio thumbnail per active generation. The owning bar keeps the status text and progressbar semantics. */
const GenerationQueue: React.FC<GenerationQueueProps> = ({ tasks }) => {
  const active = tasks.filter(isActiveGeneration);
  if (!active.length) return null;
  const shown = active.slice(0, MAX_CHIPS);
  const hidden = active.length - shown.length;
  return (
    <span className={styles.queue} data-testid='generation-queue' aria-hidden='true'>
      {shown.map((task) => {
        const fraction =
          typeof task.progress === 'number' && Number.isFinite(task.progress)
            ? Math.min(1, Math.max(0, task.progress / 100))
            : undefined;
        const running = task.status === 'running';
        const ratio = task.ratio !== undefined && task.ratio > 0 ? task.ratio : DEFAULT_RATIO;
        const thumbWidth = Math.min(18, Math.max(6, Math.round(ratio * THUMB_HEIGHT)));
        const indeterminate = running && fraction === undefined;
        return (
          <span key={task.id} className={styles.chip}>
            <svg
              className={classNames(styles.ring, {
                [styles.determinate]: fraction !== undefined,
                [styles.spin]: indeterminate,
              })}
              viewBox='0 0 22 22'
            >
              <circle className={styles.ringTrack} cx='11' cy='11' r={RADIUS} />
              {running && (
                <circle
                  className={styles.ringFill}
                  cx='11'
                  cy='11'
                  r={RADIUS}
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - (fraction ?? INDETERMINATE_FRACTION))}
                />
              )}
            </svg>
            <span className={styles.thumb} style={{ width: thumbWidth, height: THUMB_HEIGHT }} />
          </span>
        );
      })}
      {hidden > 0 && <span className={styles.more}>+{hidden}</span>}
    </span>
  );
};

export default GenerationQueue;
