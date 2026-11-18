import React from 'react';
import { Button } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { useOptionalCloudAccount } from './Provider';
import { CloudAccountIcon, useCloudAccountIdentity } from './Identity';

export const CloudAccountEntry: React.FC<{ collapsed?: boolean; disconnectedOnly?: boolean }> = ({
  collapsed,
  disconnectedOnly,
}) => {
  const cloud = useOptionalCloudAccount();
  const { label } = useCloudAccountIdentity();
  if (!cloud || (disconnectedOnly && cloud.session?.state === 'connected')) return null;
  return <EntryButton label={label} collapsed={collapsed} />;
};
const EntryButton: React.FC<{ label: string; collapsed?: boolean }> = ({ label, collapsed }) => {
  const navigate = useNavigate();
  return (
    <Button
      type='text'
      className='!text-t-primary max-w-full'
      aria-label={label}
      icon={<CloudAccountIcon />}
      onClick={() => {
        void navigate('/settings/cloud-account');
      }}
    >
      {!collapsed && <span className='truncate'>{label}</span>}
    </Button>
  );
};
