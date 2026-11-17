import React from 'react';
import { Button, Collapse, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudQuota, CloudQuotaView } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from '../Provider';
import { formatAccountAmount, formatAccountTime } from './format';

export const useQuota = () => {
  const { t } = useTranslation();
  return (value?: CloudQuota | null): string | undefined =>
    value
      ? `${value.amount} ${value.unit === 'new_api_quota' ? t('settings.cloudAccount.quotaUnit') : value.unit}`
      : undefined;
};
export const Details: React.FC<React.PropsWithChildren<{ title?: string }>> = ({ title = 'details', children }) => {
  const { t } = useTranslation();
  return (
    <Collapse bordered={false} lazyload={false} className='min-w-0'>
      <Collapse.Item name='details' header={t(`settings.cloudAccount.${title}`)}>
        <div className='flex flex-col gap-4px min-w-0'>{children}</div>
      </Collapse.Item>
    </Collapse>
  );
};
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
      data-cloud-panel={title}
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
      {value?.status === 'available' || value?.status === 'limited'
        ? (formatAccountAmount(value.amount) ?? label('unavailable'))
        : label(value?.status)}
    </Field>
  );
};
export function WalletPanel() {
  const cloud = useCloudAccount();
  const { t, i18n } = useTranslation();
  const label = useSafeLabel();
  const quota = useQuota();
  const wallet = cloud.wallet;
  return (
    <Panel title='wallet'>
      <ReadState loading={cloud.walletLoading} failed={cloud.walletFailed} hasData={!!wallet} />
      <div className='bg-fill-1 rd-8px p-16px flex flex-col gap-8px'>
        <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.walletBalance')}</div>
        <div className='text-24px font-600 tabular-nums min-w-0 [overflow-wrap:anywhere]'>
          {wallet?.wallet_balance.status === 'available' || wallet?.wallet_balance.status === 'limited'
            ? (formatAccountAmount(wallet.wallet_balance.amount) ?? label('unavailable'))
            : label(wallet?.wallet_balance.status)}
        </div>
        <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.quotaExplanation')}</div>
      </div>
      {wallet?.wallet_balance.reason && <Field name='reason'>{label(wallet.wallet_balance.reason)}</Field>}
      {wallet?.device_limit.reason && <Field name='reason'>{label(wallet.device_limit.reason)}</Field>}
      {wallet && (
        <>
          <Field name='billingPreference'>{label(wallet.billing_preference)}</Field>
          <QuotaView name='deviceLimit' value={wallet.device_limit} />
          <Typography.Title heading={6} className='!m-0'>
            {t('settings.cloudAccount.subscriptions')}
          </Typography.Title>
          <Field name='status'>{label(wallet.subscriptions.status)}</Field>
          {wallet.subscriptions.status === 'available' && wallet.subscriptions.items.length === 0 && (
            <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.noSubscriptions')}</div>
          )}
          {wallet.subscriptions.items.map((item) => (
            <div key={item.id} className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
              <Field name='allowance'>
                {item.unlimited ? label('unlimited') : (formatAccountAmount(item.remaining) ?? label('unavailable'))}
              </Field>
              <Field name='used'>{formatAccountAmount(item.used)}</Field>
              <Field name='walletOverflow'>
                {t(`settings.cloudAccount.${item.allow_wallet_overflow ? 'yes' : 'no'}`)}
              </Field>
              <Details>
                {!item.unlimited && <Field name='allowance'>{quota(item.remaining)}</Field>}
                <Field name='used'>{quota(item.used)}</Field>
                <Field name='subscriptionId'>{item.id}</Field>
                <Field name='allowanceState'>{label(item.allowance_state)}</Field>
                <Field name='expiresAt'>{formatAccountTime(item.expires_at, i18n?.language)}</Field>
                <Field name='nextResetAt'>{formatAccountTime(item.next_reset_at, i18n?.language)}</Field>
              </Details>
            </div>
          ))}
          <Details title='accountDetails'>
            <Field name='walletBalance'>{quota(wallet.wallet_balance.amount)}</Field>
            {wallet.device_limit.amount && <Field name='deviceLimit'>{quota(wallet.device_limit.amount)}</Field>}
            <Field name='asOf'>{formatAccountTime(wallet.as_of, i18n?.language)}</Field>
            <Field name='readStartedAt'>{formatAccountTime(wallet.read_started_at, i18n?.language)}</Field>
            <Field name='unit'>new_api_quota</Field>
          </Details>
        </>
      )}
      <Button size='small' onClick={cloud.refreshWallet}>
        {t('settings.cloudAccount.refreshWallet')}
      </Button>
    </Panel>
  );
}
