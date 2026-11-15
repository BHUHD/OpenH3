/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Message } from '@arco-design/web-react';
import { Copy, Download, Picture, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { localFileRef } from '@/common/types/chatFile';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { downloadArtifact } from './downloadArtifact';

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

  return (
    <div className={`${inline ? '' : 'mt-8px '}flex flex-wrap items-center gap-4px`} data-testid='generation-actions'>
      <Button size='mini' type='text' loading={saving} icon={<Download size={14} />} onClick={() => void download()}>
        {t('common.download')}
      </Button>
      {prompt && (
        <Button size='mini' type='text' icon={<Copy size={14} />} onClick={copyPrompt}>
          {t('conversation.generationActions.copyPrompt')}
        </Button>
      )}
      {prompt && conversationId && (
        <Button
          size='mini'
          type='text'
          icon={<Refresh size={14} />}
          onClick={() => requestConversationSendBoxPrefill(conversationId, prompt)}
        >
          {t('conversation.generationActions.regenerate')}
        </Button>
      )}
      {referencePath && conversationId && (
        <Button
          size='mini'
          type='text'
          icon={<Picture size={14} />}
          onClick={() =>
            requestConversationSendBoxPrefill(conversationId, t('conversation.generationActions.referencePrompt'), [
              localFileRef(referencePath),
            ])
          }
        >
          {t('conversation.generationActions.useAsReference')}
        </Button>
      )}
    </div>
  );
};

export default GenerationActions;
