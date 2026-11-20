import React, { useId, useState } from 'react';
import { Button, DatePicker, Input, InputNumber } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountData, CloudAccountRequest, CloudUsage } from '@/common/types/platform/cloudAccount';
import { Details, Field, Panel, ReadState, useQuota, useSafeLabel } from './Wallet';
import { useCloudRead } from './useCloudRead';
import { formatAccountAmount, formatAccountTime } from './format';
import { DEFAULT_USAGE_INPUT } from './freshness';
const isUsage = (data: CloudAccountData): data is CloudUsage => !!data && 'completeness' in data;
type Filters = Extract<CloudAccountRequest, { operation: 'usage' }>['input'];
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function UsagePanel() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const label = useSafeLabel();
  const quota = useQuota();
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_USAGE_INPUT });
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
          <DatePicker
            inputProps={{ id: `${id}-start` }}
            className='w-full min-w-0'
            showTime
            value={start ? start * 1000 : undefined}
            onChange={(_, date) => setStart(date ? date.unix() : 0)}
          />
        </label>
        <label htmlFor={`${id}-end`}>
          {t('settings.cloudAccount.endTime')}
          <DatePicker
            inputProps={{ id: `${id}-end` }}
            className='w-full min-w-0'
            showTime
            value={end ? end * 1000 : undefined}
            onChange={(_, date) => setEnd(date ? date.unix() : 0)}
          />
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
          <div className='text-12px text-t-secondary'>{label(usage.data.completeness)}</div>
          {usage.data.items?.map((item) => (
            <div key={item.id} className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
              <Field name='kind'>{label(item.kind)}</Field>
              <Field name='direction'>{label(item.direction)}</Field>
              <div className='font-500 tabular-nums'>
                {formatAccountAmount(item.quota) ?? t('settings.cloudAccount.unavailable')}
              </div>
              <Field name='model'>{item.model}</Field>
              <Details>
                <Field name='quota'>{quota(item.quota)}</Field>
                <Field name='createdAt'>{formatAccountTime(item.created_at, i18n?.language)}</Field>
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
              </Details>
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
    </Panel>
  );
}

const RECENT_ROWS = 3;

/** Overview preview of the newest ledger rows; reuses the default first-page read of the full ledger. */
export function RecentActivity({ onViewAll }: { onViewAll: () => void }) {
  const { t, i18n } = useTranslation();
  const label = useSafeLabel();
  const usage = useCloudRead({ operation: 'usage', input: DEFAULT_USAGE_INPUT }, isUsage);
  const rows = usage.data?.items?.slice(0, RECENT_ROWS) ?? [];
  return (
    <Panel title='recentActivity'>
      <ReadState loading={usage.loading} failed={usage.failed} hasData={!!usage.data} />
      {usage.data && rows.length === 0 && (
        <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.emptyUsage')}</div>
      )}
      {rows.map((item) => (
        <div key={item.id} className='flex flex-wrap items-baseline justify-between gap-8px min-w-0 text-12px'>
          <div className='flex flex-col gap-2px min-w-0 [overflow-wrap:anywhere]'>
            <span className='text-14px'>{item.model || label(item.kind)}</span>
            <span className='text-t-secondary'>
              {label(item.direction)} · {formatAccountTime(item.created_at, i18n?.language)}
            </span>
          </div>
          <span className='text-14px font-500 tabular-nums'>
            {formatAccountAmount(item.quota) ?? t('settings.cloudAccount.unavailable')}
          </span>
        </div>
      ))}
      <Button size='small' type='text' className='self-start' onClick={onViewAll}>
        {t('settings.cloudAccount.viewAllActivity')}
      </Button>
    </Panel>
  );
}
