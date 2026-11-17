import React from 'react';
import { Avatar } from '@arco-design/web-react';
import { User } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useOptionalCloudAccount } from './Provider';

/** Shared identity for settings navigation and the desktop account controls. */
export function useCloudAccountIdentity() {
  const cloud = useOptionalCloudAccount();
  const { t } = useTranslation();
  const account = cloud?.session?.state === 'connected' ? cloud.session.account : undefined;
  return {
    account,
    label: account?.display_name || account?.username || t('settings.cloudAccount.entry'),
  };
}

export function CloudAccountAvatar({ size = 24 }: { size?: number }) {
  const { account, label } = useCloudAccountIdentity();
  return (
    <Avatar
      size={size}
      data-account-avatar
      aria-hidden='true'
      style={{ background: 'var(--bg-3)', color: 'var(--primary)', flexShrink: 0 }}
    >
      {account ? label.slice(0, 1).toLocaleUpperCase() : <User size={Math.round(size * 0.65)} />}
    </Avatar>
  );
}
