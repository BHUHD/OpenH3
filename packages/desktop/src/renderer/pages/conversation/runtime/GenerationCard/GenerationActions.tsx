/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Copy, Download, Picture, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { localFileRef } from '@/common/types/chatFile';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { downloadArtifact } from './downloadArtifact';
import styles from './GenerationActions.module.css';

type GenerationActionsProps = {
  /** Needed by the prefill actions, which stay hidden when the card has no conversation. */
  conversationId?: string;
  /** Artifact URL served by the local media service. */
  src: string;
  fileName: string;
  /** Prompt recorded on the job; prompt-based actions are hidden when absent. */
  prompt?: string;
  /** Absolute local path of an image artifact; enables use-as-reference. */
  referencePath?: string;
  /** Drop the top margin when the bar shares a row with other content. */
  inline?: boolean;
};

/** Result action bar shared by the generation cards. Never invents a prompt or a path the job did not record. */
const GenerationActions: React.FC<GenerationActionsProps> = ({
  conversationId,
  src,
  fileName,
  prompt,
  referencePath,
  inline,
}) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const download = async (): Promise<void> => {
    setSaving(true);
    try {
      await downloadArtifact(src, fileName);
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const copyPrompt = (): void => {
    if (!prompt) return;
    void copyText(prompt)
      .then(() => Message.success(t('common.copySuccess')))
      .catch(() => Message.error(t('common.copyFailed')));
  };

  const downloadLabel = t('common.download');
  const copyLabel = t('conversation.generationActions.copyPrompt');
  const regenerateLabel = t('conversation.generationActions.regenerate');
  const referenceLabel = t('conversation.generationActions.useAsReference');

  return (
    <div className={`${styles.frame} ${inline ? styles.inline : 'mt-8px'}`}>
      <div
        role='group'
        aria-label={t('conversation.generationActions.forArtifact', { fileName })}
        className={styles.actions}
        data-testid='generation-actions'
      >
        <Tooltip content={downloadLabel} trigger={['hover', 'focus']}>
          <Button
            type='text'
            size='small'
            aria-label={downloadLabel}
            loading={saving}
            icon={<Download size={16} aria-hidden />}
            onClick={() => void download()}
          >
            <span className={styles.label}>{downloadLabel}</span>
          </Button>
        </Tooltip>
        {prompt && (
          <Tooltip content={copyLabel} trigger={['hover', 'focus']}>
            <Button
              type='text'
              size='small'
              aria-label={copyLabel}
              icon={<Copy size={16} aria-hidden />}
              onClick={copyPrompt}
            >
              <span className={styles.label}>{copyLabel}</span>
            </Button>
          </Tooltip>
        )}
        {conversationId && prompt && (
          <Tooltip content={regenerateLabel} trigger={['hover', 'focus']}>
            <Button
              type='text'
              size='small'
              aria-label={regenerateLabel}
              icon={<Refresh size={16} aria-hidden />}
              onClick={() => requestConversationSendBoxPrefill(conversationId, prompt)}
            >
              <span className={styles.label}>{regenerateLabel}</span>
            </Button>
          </Tooltip>
        )}
        {conversationId && referencePath && (
          <Tooltip content={referenceLabel} trigger={['hover', 'focus']}>
            <Button
              type='text'
              size='small'
              aria-label={referenceLabel}
              icon={<Picture size={16} aria-hidden />}
              onClick={() =>
                requestConversationSendBoxPrefill(conversationId, t('conversation.generationActions.referencePrompt'), [
                  localFileRef(referencePath),
                ])
              }
            >
              <span className={styles.label}>{referenceLabel}</span>
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default GenerationActions;
