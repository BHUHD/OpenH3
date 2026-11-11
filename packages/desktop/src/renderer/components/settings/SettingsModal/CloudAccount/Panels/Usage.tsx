import React, { useId, useState } from 'react';
import { Button, Input, InputNumber } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountData, CloudAccountRequest, CloudUsage } from '@/common/types/platform/cloudAccount';
import { Field, Panel, ReadState, quota, useSafeLabel } from './Wallet';
import { useCloudRead } from './useCloudRead';
const isUsage = (data: CloudAccountData): data is CloudUsage => !!data && 'completeness' in data;
type Filters = Extract<CloudAccountRequest, { operation: 'usage' }>['input'];
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function UsagePanel() {
  const { t } = useTranslation();
  const id = useId();
  const label = useSafeLabel();
  const [filters, setFilters] = useState<Filters>({ page: 1, page_size: 20 });
  const [model, setModel] = useState('');
  const [device, setDevice] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [size, setSize] = useState(20);
  const valid =
    bytes(model) <= 256 &&
    bytes(device) <= 64 &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end >= 0 &&
    (!end || end >= start) &&
    Number.isInteger(size) &&
    size >= 1 &&
    size <= 100;
  const usage = useCloudRead({ operation: 'usage', input: filters }, isUsage);
  return (
    <Panel title='usage'>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-8px'>
        <label htmlFor={`${id}-model`}>
          {t('settings.cloudAccount.filterModel')}
          <Input id={`${id}-model`} value={model} onChange={setModel} />
        </label>
        <label htmlFor={`${id}-device`}>
          {t('settings.cloudAccount.filterDevice')}
          <Input id={`${id}-device`} value={device} onChange={setDevice} />
        </label>
        <label htmlFor={`${id}-start`}>
          {t('settings.cloudAccount.startTime')}
          <InputNumber id={`${id}-start`} value={start} onChange={setStart} min={0} />
        </label>
        <label htmlFor={`${id}-end`}>
          {t('settings.cloudAccount.endTime')}
          <InputNumber id={`${id}-end`} value={end} onChange={setEnd} min={0} />
        </label>
        <label htmlFor={`${id}-size`}>
          {t('settings.cloudAccount.pageSize')}
          <InputNumber id={`${id}-size`} value={size} onChange={setSize} min={1} max={100} precision={0} />
        </label>
        <Button
          disabled={!valid}
          onClick={() =>
            setFilters({
              page: 1,
              page_size: size,
              ...(model ? { model } : {}),
              ...(device ? { device_id: device } : {}),
              ...(start ? { start_time: start } : {}),
              ...(end ? { end_time: end } : {}),
            })
          }
        >
          {t('settings.cloudAccount.applyFilters')}
        </Button>
      </div>
      <ReadState loading={usage.loading} failed={usage.failed} hasData={!!usage.data} />
      {usage.data && (
        <>
          <Field name='status'>{label(usage.data.status)}</Field>
          {usage.data.reason && <Field name='reason'>{label(usage.data.reason)}</Field>}
          <Field name='completeness'>{label(usage.data.completeness)}</Field>
          <Field name='readStartedAt'>{String(usage.data.read_started_at)}</Field>
          <Field name='asOf'>{String(usage.data.as_of)}</Field>
          {usage.data.items?.map((item) => (
            <div key={item.id} className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
              <Field name='kind'>{label(item.kind)}</Field>
              <Field name='direction'>{label(item.direction)}</Field>
              <Field name='quota'>{quota(item.quota)}</Field>
              <Field name='model'>{item.model}</Field>
              <Field name='createdAt'>{String(item.created_at)}</Field>
              <Field name='requestId'>{item.request_id || undefined}</Field>
              <Field name='deviceId'>{item.device_id}</Field>
              <Field name='informationalTokens'>
                {item.prompt_tokens} / {item.completion_tokens}
              </Field>
              {item.funding &&
                Object.entries(item.funding).map(([name, value]) => (
                  <Field key={name} name={name}>
                    {['billing_source', 'billing_preference'].includes(name) ? label(value) : value}
                  </Field>
                ))}
            </div>
          ))}
          {(!usage.data.items || usage.data.items.length === 0) && <div>{t('settings.cloudAccount.emptyUsage')}</div>}
          <Field name='page'>{String(usage.data.page)}</Field>
          <div className='flex flex-wrap gap-8px'>
            <Button
              disabled={(filters.page ?? 1) <= 1}
              onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) - 1 })}
            >
              {t('settings.cloudAccount.previousPage')}
            </Button>
            <Button
              disabled={!usage.data.has_more || (filters.page ?? 1) >= 1000000}
              onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) + 1 })}
            >
              {t('settings.cloudAccount.nextPage')}
            </Button>
          </div>
        </>
      )}
      <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.noTaskAccounting')}</div>
      <Button size='small' onClick={usage.refresh}>
        {t('settings.cloudAccount.refreshUsage')}
      </Button>
    </Panel>
  );
}
