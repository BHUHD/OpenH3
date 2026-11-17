import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CloudTopupOrder, CloudTopupQuote } from '@/common/types/platform/cloudAccount';
import { Details, Field, useQuota } from '../Wallet';
import { formatAccountTime } from '../format';

export type OwnedOrder = Omit<CloudTopupOrder, 'checkout_url'>;
/** Only the checkout helper may retain a signed URL, in a transient closure. */
export function withoutCheckout(order: CloudTopupOrder): OwnedOrder {
  const { checkout_url: _url, ...safe } = order;
  return safe;
}
export const usePaymentLabel = () => {
  const { t } = useTranslation();
  return (method: string) =>
    method === 'alipay' || method === 'wxpay' ? t(`settings.cloudAccount.${method}`) : method;
};
export function Terms({ quote }: { quote: CloudTopupQuote }) {
  const { t } = useTranslation();
  const quota = useQuota();
  const paymentLabel = usePaymentLabel();
  return (
    <div className='flex flex-col gap-4px min-w-0'>
      <Field name='payableMoney'>
        {quote.payable_money} {quote.currency}
      </Field>
      <Field name='paymentMethod'>{paymentLabel(quote.payment_method)}</Field>
      <Details title='purchaseDetails'>
        <Field name='creditedQuota'>{quota({ amount: quote.credited_quota, unit: quote.quota_unit })}</Field>
        <Field name='purchaseAmount'>
          {String(quote.amount)} {quote.amount_unit}
        </Field>
        <Field name='paymentProvider'>{quote.provider}</Field>
        <Field name='quoteVersion'>{quote.quote_version}</Field>
        <Field name='conversionVersion'>{quote.conversion_version}</Field>
        <Field name='feeScope'>{t('settings.cloudAccount.gatewayTotal')}</Field>
      </Details>
    </div>
  );
}
export function OrderDetails({ order }: { order: OwnedOrder }) {
  const { t, i18n } = useTranslation();
  return (
    <div className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
      <Field name='orderId'>{order.order_id}</Field>
      <Field name='status'>{t(`settings.cloudAccount.order_${order.status}`)}</Field>
      <Terms quote={order} />
      <Details title='orderDetails'>
        <Field name='createdAt'>{formatAccountTime(order.created_at, i18n?.language)}</Field>
        {order.completed_at > 0 && (
          <Field name='completedAt'>{formatAccountTime(order.completed_at, i18n?.language)}</Field>
        )}
        <Field name='orderOwner'>{order.owner_id}</Field>
        <Field name='handoffStatus'>{t(`settings.cloudAccount.handoff_${order.handoff_status}`)}</Field>
        <Field name='handoffExpiresAt'>{formatAccountTime(order.handoff_expires_at, i18n?.language)}</Field>
      </Details>
    </div>
  );
}
