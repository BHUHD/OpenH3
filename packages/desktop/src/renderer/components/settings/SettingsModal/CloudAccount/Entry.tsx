import React from 'react';
import { Button } from '@arco-design/web-react';
import { LinkCloud } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOptionalCloudAccount } from './Provider';

export const CloudAccountEntry: React.FC<{ collapsed?: boolean; disconnectedOnly?: boolean }> = ({
  collapsed,
  disconnectedOnly,
}) => {
  const cloud = useOptionalCloudAccount();
  const { t } = useTranslation();
  if (!cloud || (disconnectedOnly && cloud.session?.state === 'connected')) return null;
  const account = cloud.session?.state === 'connected' ? cloud.session.account : undefined;
  const label = account?.display_name || account?.username || t('settings.cloudAccount.entry');
  return <EntryButton label={label} collapsed={collapsed} />;
};
const EntryButton: React.FC<{ label: string; collapsed?: boolean }> = ({ label, collapsed }) => {
  const navigate = useNavigate();
  return (
    <Button
      type='text'
      className='!text-t-primary max-w-full'
      aria-label={label}
      icon={<LinkCloud size={16} />}
      onClick={() => {
        void navigate('/settings/cloud-account');
      }}
    >
      {!collapsed && <span className='truncate'>{label}</span>}
    </Button>
  );
};
