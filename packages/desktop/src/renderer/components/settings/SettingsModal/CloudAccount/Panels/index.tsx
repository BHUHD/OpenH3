import React, { useEffect } from 'react';
import { useCloudAccount } from '../Provider';
import { Button, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { Details, Field, Panel, ReadState, useSafeLabel, WalletPanel } from './Wallet';
import { DevicesPanel } from './Devices';
import { UsagePanel } from './Usage';
import { PurchasePanel } from './Purchase';
export function CatalogPanel() {
  const cloud = useCloudAccount();
  useEffect(() => {
    if (!cloud.catalogRead && !cloud.catalogPending) void cloud.refreshCatalog();
  }, [cloud.catalogRead, cloud.catalogPending, cloud.refreshCatalog]);
  const catalog = {
    data: cloud.catalog,
    loading: !!cloud.catalogPending,
    failed: cloud.notice === 'catalogFailed',
    refresh: cloud.refreshCatalog,
  };
  const { t } = useTranslation();
  const label = useSafeLabel();
  return (
    <Panel title='officialCatalog'>
      <ReadState loading={catalog.loading} failed={catalog.failed} hasData={!!catalog.data} />
      <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.quoteNotice')}</div>
      {catalog.data && (
        <>
          <Field name='status'>{label(catalog.data.status)}</Field>
          {catalog.data.reason && <Field name='reason'>{label(catalog.data.reason)}</Field>}
        </>
      )}
      {catalog.data?.models.map((model, index) => (
        <div
          key={`${model.model_id}:${model.protocol}:${index}`}
          className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'
        >
          <div className='font-500'>{model.display_name || model.model_id}</div>
          <Field name='inputs'>{model.input_capabilities.map(label).join(', ')}</Field>
          <Field name='tools'>{t(`settings.cloudAccount.${model.supports_tools ? 'yes' : 'no'}`)}</Field>
          <Field name='contextLimit'>{String(model.context_limit)}</Field>
          <Field name='outputLimit'>{String(model.max_output_tokens)}</Field>
          {model.selection_unavailable_reason && <div role='status'>{label(model.selection_unavailable_reason)}</div>}
          {model.quotes.map((quote, i) => (
            <div key={i} className='border-t border-solid border-[var(--color-border-2)] pt-4px'>
              <Field name='group'>{quote.group}</Field>
              <Field name='kind'>{label(quote.kind)}</Field>
              <Field name='unit'>
                {quote.unit === 'USD_per_million_tokens'
                  ? t('settings.cloudAccount.tokenPriceUnit')
                  : quote.unit === 'USD_per_request'
                    ? t('settings.cloudAccount.requestPriceUnit')
                    : quote.unit === 'USD_by_effective_expression'
                      ? t('settings.cloudAccount.dynamicPriceUnit')
                      : quote.unit}
              </Field>
              {(
                [
                  'input',
                  'output',
                  'cache_read',
                  'cache_write',
                  'cache_write_1h',
                  'cache_write_12h',
                  'per_request',
                ] as const
              ).map(
                (key) =>
                  quote[key] !== undefined && (
                    <Field key={key} name={key}>
                      {quote[key]}
                    </Field>
                  )
              )}
              <Details title='purchaseDetails'>
                {Object.entries(quote)
                  .filter(
                    ([key]) =>
                      ![
                        'group',
                        'kind',
                        'unit',
                        'input',
                        'output',
                        'cache_read',
                        'cache_write',
                        'cache_write_1h',
                        'cache_write_12h',
                        'per_request',
                      ].includes(key)
                  )
                  .map(([key, value]) => (
                    <Field key={key} name={key}>
                      {key === 'kind' || key === 'cache_write_mode'
                        ? label(String(value))
                        : key === 'expression_semantics'
                          ? t('settings.cloudAccount.expressionNotice')
                          : typeof value === 'object'
                            ? Object.entries(value).map(([name, amount]) => (
                                <div key={name}>
                                  {name === 'condition'
                                    ? t('settings.cloudAccount.conditionNotice')
                                    : name === 'usd'
                                      ? `${amount} USD`
                                      : `${name}: ${amount}`}
                                </div>
                              ))
                            : value}
                    </Field>
                  ))}
              </Details>
            </div>
          ))}
          <Details title='modelDetails'>
            <Field name='model'>{model.model_id}</Field>
            <Field name='protocol'>{model.protocol}</Field>
            <Field name='version'>{model.compatibility_version}</Field>
          </Details>
        </div>
      ))}
      <Button size='small' onClick={catalog.refresh}>
        {t('settings.cloudAccount.refreshCatalog')}
      </Button>
    </Panel>
  );
}
export function ConnectedPanels() {
  const { t } = useTranslation();
  return (
    <Tabs
      defaultActiveTab='overview'
      lazyload={false}
      destroyOnHide={false}
      animation={false}
      className='my-16px'
      headerPadding={false}
    >
      <Tabs.TabPane key='overview' title={t('settings.cloudAccount.overviewTab')}>
        <div className='flex flex-col gap-12px'>
          <WalletPanel />
          <CatalogPanel />
        </div>
      </Tabs.TabPane>
      <Tabs.TabPane key='purchase' title={t('settings.cloudAccount.purchaseTab')}>
        <div className='flex flex-col gap-12px'>
          <PurchasePanel />
        </div>
      </Tabs.TabPane>
      <Tabs.TabPane key='activity' title={t('settings.cloudAccount.activityTab')}>
        <UsagePanel />
      </Tabs.TabPane>
      <Tabs.TabPane key='devices' title={t('settings.cloudAccount.devicesTab')}>
        <DevicesPanel />
      </Tabs.TabPane>
    </Tabs>
  );
}
