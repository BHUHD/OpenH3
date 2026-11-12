import React, { useEffect, useId, useState } from 'react';
import { Button, Input, InputNumber, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountData, CloudAccountRequest, CloudTopupOrders } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from '../../Provider';
import { Panel, ReadState } from '../Wallet';
import { useCloudRead } from '../useCloudRead';
import { OrderDetails, withoutCheckout } from './Terms';

const isOrders = (data: CloudAccountData): data is CloudTopupOrders => !!data && 'next_before_id' in data;
type Filters = Extract<CloudAccountRequest, { operation: 'topupOrders' }>['input'];
export function Orders() {
  const cloud = useCloudAccount();
  return <History key={cloud.scope} />;
}
function History() {
  const cloud = useCloudAccount();
  const { t } = useTranslation();
  const id = useId();
  const [orderId, setOrderId] = useState('');
  const [status, setStatus] = useState<Filters['status']>('');
  const [size, setSize] = useState(20);
  const [filters, setFilters] = useState<Filters>({ page_size: 20 });
  const orders = useCloudRead({ operation: 'topupOrders', input: filters }, isOrders);
  useEffect(() => {
    if (orders.data)
      cloud.refreshBilling(orders.data.items.filter((order) => order.status === 'paid').map((order) => order.order_id));
  }, [orders.data, cloud.scope, cloud.refreshBilling]);
  const valid = new TextEncoder().encode(orderId).length <= 64 && Number.isInteger(size) && size >= 1 && size <= 50;
  return (
    <Panel title='ownedOrders'>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-8px'>
        <label htmlFor={`${id}-order`}>
          {t('settings.cloudAccount.orderId')}
          <Input id={`${id}-order`} value={orderId} onChange={setOrderId} />
        </label>
        <label htmlFor={`${id}-status`}>
          {t('settings.cloudAccount.orderStatus')}
          <Select id={`${id}-status`} value={status} onChange={setStatus}>
            {(['', 'pending', 'paid', 'failed', 'expired'] as const).map((value) => (
              <Select.Option key={value} value={value}>
                {t(`settings.cloudAccount.order_${value || 'all'}`)}
              </Select.Option>
            ))}
          </Select>
        </label>
        <label htmlFor={`${id}-size`}>
          {t('settings.cloudAccount.orderPageSize')}
          <InputNumber id={`${id}-size`} value={size} onChange={setSize} min={1} max={50} precision={0} />
        </label>
        <Button
          disabled={!valid}
          onClick={() =>
            setFilters({ page_size: size, ...(orderId ? { order_id: orderId } : {}), ...(status ? { status } : {}) })
          }
        >
          {t('settings.cloudAccount.applyOrderFilters')}
        </Button>
      </div>
      <ReadState loading={orders.loading} failed={orders.failed} hasData={!!orders.data} />
      {orders.data?.items.map((order) => (
        <OrderDetails key={order.order_id} order={withoutCheckout(order)} />
      ))}
      {orders.data?.items.length === 0 && <div>{t('settings.cloudAccount.emptyOrders')}</div>}
      <div className='flex flex-wrap gap-8px'>
        <Button onClick={orders.refresh}>{t('settings.cloudAccount.refreshOrders')}</Button>
        <Button
          disabled={!filters.before_id}
          onClick={() => setFilters(({ before_id: _cursor, ...original }) => original)}
        >
          {t('settings.cloudAccount.firstOrders')}
        </Button>
        <Button
          disabled={orders.loading || orders.failed || !orders.data?.has_more || !orders.data.next_before_id}
          onClick={() => {
            if (orders.data?.has_more) setFilters({ ...filters, before_id: orders.data.next_before_id });
          }}
        >
          {t('settings.cloudAccount.moreOrders')}
        </Button>
      </div>
    </Panel>
  );
}
