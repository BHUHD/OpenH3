import React from 'react';
import { Button } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TMessage } from '@/common/chat/chatLib';
import { useOptionalCloudAccount } from '../Provider';
export const OfficialFailure: React.FC<{ message: TMessage }> = ({ message }) => {
  if (message.model_source?.kind !== 'cloud_account' || message.type !== 'tips' || message.content.type !== 'error')
    return null;
  return <RecoveryActions failure={message.content.error?.code !== 'CLOUD_ACCOUNT_INSUFFICIENT_BALANCE'} />;
};
export const RecoveryActions: React.FC<{ failure?: boolean }> = ({ failure }) => {
  const cloud = useOptionalCloudAccount();
  const { t } = useTranslation();
  return (
    <div className='text-12px text-t-secondary mt-8px'>
      {failure && <div>{t('settings.cloudAccount.failureUnknown')}</div>}
      <div className='flex flex-wrap gap-8px'>
        {cloud?.session?.state === 'connected' && (
          <Button size='small' onClick={cloud.refreshWallet}>
            {t('settings.cloudAccount.refreshWallet')}
          </Button>
        )}
        <AccountAction />
        <span>{t('settings.cloudAccount.manualByok')}</span>
      </div>
    </div>
  );
};
const AccountAction = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <Button
      size='small'
      onClick={() => {
        void navigate('/settings/cloud-account');
      }}
    >
      {t('settings.cloudAccount.entry')}
    </Button>
  );
};
