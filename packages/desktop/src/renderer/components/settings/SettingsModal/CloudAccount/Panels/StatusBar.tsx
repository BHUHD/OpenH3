import React, { useEffect, useRef } from 'react';
import { Button } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountData, CloudUsage } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from '../Provider';
import { useCloudRead } from './useCloudRead';
import { formatAccountTime } from './format';
import { balanceBehindLedger, DEFAULT_USAGE_INPUT, sharedReadTime } from './freshness';

const isUsage = (data: CloudAccountData): data is CloudUsage => !!data && 'completeness' in data;

/** Shared read time, settlement state, and recovery for balance and ledger. */
export function AccountStatusBar() {
  const cloud = useCloudAccount();
  const { t, i18n } = useTranslation();
  const usage = useCloudRead({ operation: 'usage', input: DEFAULT_USAGE_INPUT }, isUsage);
  const wallet = cloud.wallet;
  const { latest, behind } = balanceBehindLedger(wallet?.read_started_at, usage.data?.items ?? []);
  // One bounded settlement round per newest ledger entry, never a loop on every new snapshot.
  const settledFor = useRef('');
  useEffect(() => {
    if (!behind) return;
    const key = `${cloud.scope}:${latest}`;
    if (settledFor.current === key) return;
    settledFor.current = key;
    cloud.settle();
  }, [behind, latest, cloud.scope, cloud.settle]);
  const loading = cloud.walletLoading || usage.loading;
  const unsettled = behind && !cloud.settling;
  const retry = unsettled || cloud.walletFailed || usage.failed;
  const readAt = cloud.walletFailed || usage.failed ? undefined : sharedReadTime(wallet?.as_of, usage.data?.as_of);
  const updated = readAt ? formatAccountTime(readAt, i18n?.language) : undefined;
  return (
    <div data-cloud-status className='flex flex-wrap items-center justify-between gap-8px min-w-0'>
      <div role='status' className='flex flex-col gap-2px text-12px text-t-secondary min-w-0'>
        {updated && <span>{t('settings.cloudAccount.updatedAt', { time: updated })}</span>}
        {behind && (
          <span className={unsettled ? 'text-warning' : undefined}>
            {t(`settings.cloudAccount.${unsettled ? 'settlementStale' : 'settling'}`)}
          </span>
        )}
      </div>
      {/* Healthy reads refresh on their own; a manual control appears only when a read failed or stayed stale. */}
      {retry && (
        <Button
          size='small'
          type='outline'
          // Spin without disabling: a read that never settles must not lock out a deliberate retry.
          icon={<Refresh size={14} className={loading ? 'animate-spin' : undefined} />}
          aria-busy={loading}
          onClick={cloud.refreshAccount}
        >
          {t('settings.cloudAccount.retryRead')}
        </Button>
      )}
    </div>
  );
}
