import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CloudTopupOrder, CloudTopupQuote } from '@/common/types/platform/cloudAccount';
import { Field } from '../Wallet';

export type OwnedOrder = Omit<CloudTopupOrder, 'checkout_url'>;
/** Only the checkout helper may retain a signed URL, in a transient closure. */
export function withoutCheckout(order: CloudTopupOrder): OwnedOrder {
  const { checkout_url: _url, ...safe } = order;
  return safe;
}
export function Terms({ quote }: { quote: CloudTopupQuote }) {
  return (
    <div className='flex flex-col gap-4px min-w-0'>
      <Field name='purchaseAmount'>
        {String(quote.amount)} {quote.amount_unit}
      </Field>
      <Field name='payableMoney'>
        {quote.payable_money} {quote.currency}
      </Field>
      <Field name='creditedQuota'>
        {quote.credited_quota} {quote.quota_unit}
      </Field>
      <Field name='paymentMethod'>{quote.payment_method}</Field>
      <Field name='paymentProvider'>{quote.provider}</Field>
      <Field name='quoteVersion'>{quote.quote_version}</Field>
      <Field name='conversionVersion'>{quote.conversion_version}</Field>
      <Field name='feeScope'>{quote.fee_scope}</Field>
    </div>
  );
}
export function OrderDetails({ order }: { order: OwnedOrder }) {
  const { t } = useTranslation();
  return (
    <div className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
      <Field name='orderId'>{order.order_id}</Field>
      <Field name='orderOwner'>{order.owner_id}</Field>
      <Field name='status'>{t(`settings.cloudAccount.order_${order.status}`)}</Field>
      <Terms quote={order} />
      <Field name='createdAt'>{String(order.created_at)}</Field>
      <Field name='completedAt'>{String(order.completed_at)}</Field>
      <Field name='handoffStatus'>{t(`settings.cloudAccount.handoff_${order.handoff_status}`)}</Field>
      <Field name='handoffExpiresAt'>{String(order.handoff_expires_at)}</Field>
    </div>
  );
}
