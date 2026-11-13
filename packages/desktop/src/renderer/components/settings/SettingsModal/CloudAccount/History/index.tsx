import { RecoveryActions } from './Failure';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TMessage } from '@/common/chat/chatLib';

/** Top-level server provenance is display-only. Message content and current selection carry no historical authority. */
export const ModelSource: React.FC<{ message: TMessage }> = ({ message }) => {
  const { t } = useTranslation();
  const source = message.model_source;
  if (message.position !== 'left' || message.type !== 'text') return null;
  const known = source?.kind === 'cloud_account' || source?.kind === 'byok';
  return (
    <div className='text-12px text-t-secondary mb-4px [overflow-wrap:anywhere]' data-testid='historical-model-source'>
      <span>
        {t(
          `settings.cloudAccount.${known ? (source.kind === 'cloud_account' ? 'official' : 'byok') : 'unknownSource'}`
        )}
      </span>
      {known && (
        <span className='ms-8px'>
          {source.model} · {source.protocol}
        </span>
      )}
      <div>{t('settings.cloudAccount.sourceDisclaimer')}</div>
      {source?.kind === 'cloud_account' && <RecoveryActions />}
    </div>
  );
};
