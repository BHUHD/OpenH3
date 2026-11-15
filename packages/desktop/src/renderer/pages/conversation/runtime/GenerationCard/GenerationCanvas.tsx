/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import styles from './GenerationCanvas.module.css';

const DEFAULT_RATIO = 16 / 9;
const MIN_RATIO = 0.4;
const MAX_RATIO = 2.5;

type GenerationCanvasProps = {
  /** Requested output width / height. Falls back to 16:9 when the request carries no size. */
  ratio?: number;
  /** 0-100 only when the backend reports real progress; otherwise the sweep stays indeterminate. */
  percent?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Decorative stand-in for the output while a job is queued or running; status text and cancel stay in the owning card. */
const GenerationCanvas: React.FC<GenerationCanvasProps> = ({ ratio, percent }) => {
  const safeRatio =
    ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? clamp(ratio, MIN_RATIO, MAX_RATIO) : DEFAULT_RATIO;
  const fraction = percent !== undefined && Number.isFinite(percent) ? clamp(percent, 0, 100) / 100 : undefined;
  return (
    <div
      className={styles.canvas}
      style={{ '--generation-ratio': safeRatio } as React.CSSProperties}
      data-testid='generation-canvas'
      aria-hidden='true'
    >
      <div className={styles.sweep} />
      {fraction !== undefined && (
        <div className={styles.track}>
          <div className={styles.fill} style={{ transform: `scaleX(${fraction})` }} />
        </div>
      )}
    </div>
  );
};

export default GenerationCanvas;
