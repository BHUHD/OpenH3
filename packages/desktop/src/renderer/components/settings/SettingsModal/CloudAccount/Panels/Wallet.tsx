import React from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudQuota, CloudQuotaView } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from '../Provider';

export const quota = (value?: CloudQuota | null): string | undefined =>
  value ? `${value.amount} ${value.unit}` : undefined;
const known = new Set([
  'batch_updates_enabled',
  'consume_logging_disabled',
  'unsupported_log_database',
  'native_inference_unavailable',
  'limited',
  'committed_snapshot',
  'reset_pending',
  'not_reconciled',
  'unsupported_verification',
  'none',
  'standard',
  'claude_ttl',
  'openai_ttl',
  'token',
  'request',
  'dynamic_expression',
  'available',
  'unavailable',
  'unlimited',
  'expired',
  'active',
  'revoked',
  'unknown',
  'debit',
  'credit',
  'consume',
  'refund',
  'wallet',
  'subscription',
  'subscription_first',
  'wallet_first',
  'subscription_only',
  'wallet_only',
  'text',
  'image',
  'audio',
  'video',
  'ambiguous_model_protocol',
]);
export const useSafeLabel = () => {
  const { t } = useTranslation();
  return (value?: string) =>
    t(`settings.cloudAccount.${value === 'expired' ? 'deviceExpired' : value && known.has(value) ? value : 'unknown'}`);
};
export const Field: React.FC<{ name: string; children?: React.ReactNode }> = ({ name, children }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap gap-8px text-12px min-w-0 [overflow-wrap:anywhere]'>
      <span className='text-t-secondary'>{t(`settings.cloudAccount.${name}`)}</span>
      <span>{children ?? t('settings.cloudAccount.unavailable')}</span>
    </div>
  );
};
export const ReadState: React.FC<{ loading: boolean; failed: boolean; hasData: boolean }> = ({
  loading,
  failed,
  hasData,
}) => {
  const { t } = useTranslation();
  return (
    <div role='status' className='text-12px text-t-secondary'>
      {loading
        ? t('settings.cloudAccount.loading')
        : failed
          ? t(`settings.cloudAccount.${hasData ? 'stale' : 'readFailed'}`)
          : null}
    </div>
  );
};
export const Panel: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t(`settings.cloudAccount.${title}`)}
      className='border border-solid border-[var(--color-border-2)] rd-8px p-12px flex flex-col gap-8px min-w-0'
    >
      <Typography.Title heading={6} className='!m-0'>
        {t(`settings.cloudAccount.${title}`)}
      </Typography.Title>
      {children}
    </section>
  );
};
const QuotaView: React.FC<{ name: string; value?: CloudQuotaView }> = ({ name, value }) => {
  const label = useSafeLabel();
  return (
    <Field name={name}>
      {value?.status === 'available' || value?.status === 'limited' ? quota(value.amount) : label(value?.status)}
    </Field>
  );
};
export function WalletPanel() {
  const cloud = useCloudAccount();
  const { t } = useTranslation();
  const label = useSafeLabel();
  const wallet = cloud.wallet;
  return (
    <Panel title='wallet'>
      <ReadState loading={cloud.walletLoading} failed={cloud.walletFailed} hasData={!!wallet} />
      <QuotaView name='walletBalance' value={wallet?.wallet_balance} />
      <QuotaView name='deviceLimit' value={wallet?.device_limit} />
      {wallet?.wallet_balance.reason && <Field name='reason'>{label(wallet.wallet_balance.reason)}</Field>}
      {wallet?.device_limit.reason && <Field name='reason'>{label(wallet.device_limit.reason)}</Field>}
      {wallet && (
        <>
          <Field name='readStartedAt'>{String(wallet.read_started_at)}</Field>
          <Field name='asOf'>{String(wallet.as_of)}</Field>
          <Field name='billingPreference'>{label(wallet.billing_preference)}</Field>
          <Field name='subscriptions'>{label(wallet.subscriptions.status)}</Field>
          {wallet.subscriptions.items.map((item) => (
            <div key={item.id} className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
              <Field name='subscriptionId'>{item.id}</Field>
              <Field name='allowance'>
                {item.unlimited ? label('unlimited') : (quota(item.remaining) ?? label(item.allowance_state))}
              </Field>
              <Field name='allowanceState'>{label(item.allowance_state)}</Field>
              <Field name='used'>{quota(item.used)}</Field>
              <Field name='expiresAt'>{String(item.expires_at)}</Field>
              <Field name='nextResetAt'>{String(item.next_reset_at)}</Field>
              <Field name='walletOverflow'>
                {t(`settings.cloudAccount.${item.allow_wallet_overflow ? 'yes' : 'no'}`)}
              </Field>
            </div>
          ))}
        </>
      )}
      <Button size='small' onClick={cloud.refreshWallet}>
        {t('settings.cloudAccount.refreshWallet')}
      </Button>
    </Panel>
  );
}
