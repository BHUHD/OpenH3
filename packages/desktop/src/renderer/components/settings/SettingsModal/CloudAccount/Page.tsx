import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import CloudAccount from './index';
import { useCloudAccount } from './Provider';

export default function CloudAccountPage() {
  const [search] = useSearchParams();
  const cloud = useCloudAccount();
  const balance = search.get('view') === 'balance';
  useEffect(() => {
    if (balance && cloud.session?.state === 'connected') {
      document.querySelector('[data-cloud-panel="wallet"]')?.scrollIntoView({ block: 'start' });
    }
  }, [balance, cloud.session?.state]);
  return (
    <SettingsPageWrapper>
      <CloudAccount />
    </SettingsPageWrapper>
  );
}
