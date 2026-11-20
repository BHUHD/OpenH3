import React from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import CloudAccount from './index';

export default function CloudAccountPage() {
  const [search] = useSearchParams();
  const location = useLocation();
  // A new location key per menu entry re-focuses the balance even when this page is already open.
  const balanceRequest = search.get('view') === 'balance' ? location.key : undefined;
  return (
    <SettingsPageWrapper>
      <CloudAccount balanceRequest={balanceRequest} />
    </SettingsPageWrapper>
  );
}
