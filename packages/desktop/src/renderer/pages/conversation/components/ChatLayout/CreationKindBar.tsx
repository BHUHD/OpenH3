/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import { Film, Pic } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CreationKindBar.module.css';
import type { CreationRequest } from '@/common/chat/document/creation/creation';

type CreationKindBarProps = {
  /** Creation request snapshot from conversation.extra; null/undefined = not a creation conversation. */
  request?: CreationRequest | null;
};

/**
 * Compact identity strip for creation conversations, rendered above the message
 * list where the plan bar / tabs slot lives. Shows the creation kind (image/video),
 * source (local/cloud) and model name as tags — one glance tells the user what
 * this conversation is for. Non-creation conversations never render this bar.
 */
const CreationKindBar: React.FC<CreationKindBarProps> = ({ request }) => {
  const { t } = useTranslation();
  if (!request || !request.kind) return null;

  const isVideo = request.kind === 'video';
  const KindIcon = isVideo ? Film : Pic;
  const kindLabel = t(`guid.localModels.filters.${request.kind}`);
  const sourceLabel = request.source ? t(`guid.creation.${request.source}`) : null;
  const modelLabel = request.name || undefined;

  return (
    <div className='w-full shrink-0 flex justify-center'>
      <div className='box-border w-full min-w-0 max-w-[var(--chat-column-max-width)] flex items-center gap-8px px-8px py-6px'>
        <span
          className='inline-flex items-center gap-6px text-13px font-[500] text-t-primary shrink-0'
          data-testid='creation-kind-bar'
        >
          <KindIcon size={15} className='text-primary' />
          {kindLabel}
        </span>
        {sourceLabel && (
          <Tag size='small' bordered={false} className={`${styles.sourceTag} !text-12px`}>
            {sourceLabel}
          </Tag>
        )}
        {modelLabel && (
          <span className='text-12px text-t-secondary truncate min-w-0' title={modelLabel}>
            {modelLabel}
          </span>
        )}
      </div>
    </div>
  );
};

export default CreationKindBar;
