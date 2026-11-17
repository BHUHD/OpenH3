import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Radio } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type {
  CloudAccountData,
  CloudTopupCreateInput,
  CloudTopupOptions,
  CloudTopupQuote,
} from '@/common/types/platform/cloudAccount';
import { browserCloudCheckout, cloudCheckout } from '@/common/adapter/httpBridge/cloudAccount';
import { useCloudAccount } from '../../Provider';
import { useCloudRead } from '../useCloudRead';
import { Panel, ReadState } from '../Wallet';
import { OrderDetails, Terms, usePaymentLabel, withoutCheckout, type OwnedOrder } from './Terms';
import { useOrder } from './useOrder';
import { Orders } from './Orders';

const isOptions = (data: CloudAccountData): data is CloudTopupOptions => !!data && 'options' in data;
type Intent = { input: CloudTopupCreateInput; terms: CloudTopupQuote };
export function PurchasePanel() {
  const cloud = useCloudAccount();
  // A purchase intent belongs to an identity, not an ephemeral read ticket.
  return <Purchase key={cloud.accountKey} />;
}
function Purchase() {
  const cloud = useCloudAccount();
  const { t } = useTranslation();
  const paymentLabel = usePaymentLabel();
  const options = useCloudRead({ operation: 'topupOptions' }, isOptions);
  const [selection, setSelection] = useState('');
  const [intent, setIntent] = useState<Intent>();
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const [known, setKnown] = useState<OwnedOrder>();
  const tracked = useOrder(known);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [conflict, setConflict] = useState<CloudTopupQuote>();
  const [newIntent, setNewIntent] = useState(false);
  const handoff = useRef<{ open: () => boolean; valid: () => boolean; orderId: string } | undefined>(undefined);
  const [handoffReady, setHandoffReady] = useState(false);
  const live = useRef(true);
  const flight = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      flight.current++;
      handoff.current = undefined;
    };
  }, []);
  useEffect(() => {
    flight.current++;
    handoff.current = undefined;
    setHandoffReady(false);
    setBusy(false);
    if (busy && intentRef.current) setNotice('purchaseAmbiguous');
  }, [cloud.scope]);
  useEffect(() => {
    if (!tracked.handoffAvailable) {
      handoff.current = undefined;
      setHandoffReady(false);
    }
  }, [tracked.handoffAvailable]);
  const available = !options.failed && options.data?.status === 'available' && options.data.options.length > 0;
  const choices = available ? (options.data?.options ?? []) : [];
  const selected = choices.find((q) => `${q.amount}:${q.payment_method}:${q.quote_version}` === selection);
  const create = async (original: Intent) => {
    if (busy) return;
    const attempt = ++flight.current;
    const valid = cloud.captureScope();
    if (!valid()) return;
    setBusy(true);
    setNotice(undefined);
    handoff.current = undefined;
    setHandoffReady(false);
    const result = await cloud.readOwned({ operation: 'topupCreateAndOpen', input: original.input });
    if (!live.current || attempt !== flight.current || !valid()) return;
    setBusy(false);
    const order =
      result?.success && result.data && 'order_id' in result.data
        ? result.data
        : result?.success === false
          ? result.order
          : undefined;
    if (order) {
      if (known && known.order_id !== order.order_id) {
        setNotice('purchaseAmbiguous');
        return;
      }
      setKnown(withoutCheckout(order));
      if (result?.success && !window.electronAPI && order.status === 'pending') {
        if (cloudCheckout(order, original.input)) {
          handoff.current = { open: browserCloudCheckout(order, original.input), valid, orderId: order.order_id };
          setHandoffReady(true);
        } else setNotice('checkoutFailed');
      }
    }
    if (result?.success) return;
    if (result?.success === false && result.code === 'CLOUD_TOPUP_CONFLICT') {
      setNotice('quoteChanged');
      setBusy(true);
      const fresh = await cloud.readOwned({
        operation: 'topupQuote',
        input: { amount: original.input.amount, payment_method: original.input.payment_method },
      });
      if (!live.current || attempt !== flight.current || !valid()) return;
      setBusy(false);
      if (fresh?.success && fresh.data && 'quote_version' in fresh.data && !('order_id' in fresh.data))
        setConflict(fresh.data);
      return;
    }
    setNotice(order ? 'checkoutFailed' : 'purchaseAmbiguous');
  };
  const begin = (terms: CloudTopupQuote) => {
    // CSPRNG only. A click that cannot generate a secure key cannot create.
    try {
      const original: Intent = {
        terms,
        input: {
          amount: terms.amount,
          payment_method: terms.payment_method,
          quote_version: terms.quote_version,
          idempotency_key: crypto.randomUUID(),
        },
      };
      intentRef.current = original;
      setIntent(original);
      setConflict(undefined);
      void create(original);
    } catch {
      setNotice('purchaseUnavailable');
    }
  };
  return (
    <>
      <Panel title='purchase'>
        <div className='text-12px text-t-secondary'>{t('settings.cloudAccount.purchaseNotice')}</div>
        <ReadState loading={options.loading} failed={options.failed} hasData={!!options.data} />
        {!available && !options.loading && <div role='status'>{t('settings.cloudAccount.purchaseUnavailable')}</div>}
        {!intent && available && (
          <>
            <Radio.Group
              direction='vertical'
              value={selection}
              onChange={setSelection}
              aria-label={t('settings.cloudAccount.purchaseAmount')}
            >
              {choices.map((quote) => {
                const key = `${quote.amount}:${quote.payment_method}:${quote.quote_version}`;
                return (
                  <div key={key} className='bg-fill-1 rd-4px p-8px min-w-0'>
                    <Radio value={key}>
                      {quote.payable_money} {quote.currency} · {paymentLabel(quote.payment_method)}
                    </Radio>
                    <Terms quote={quote} />
                  </div>
                );
              })}
            </Radio.Group>
            <Button
              type='primary'
              disabled={!selected || busy}
              onClick={() => {
                if (selected && !intentRef.current) begin(selected);
              }}
            >
              {t('settings.cloudAccount.confirmPurchase')}
            </Button>
          </>
        )}
        {intent && (
          <>
            <Terms quote={intent.terms} />
            {notice && <Alert type='warning' content={t(`settings.cloudAccount.${notice}`)} />}
            {conflict && (
              <>
                <Terms quote={conflict} />
                <Button disabled={busy} onClick={() => begin(conflict)}>
                  {t('settings.cloudAccount.reconfirmPurchase')}
                </Button>
              </>
            )}
            {tracked.order && <OrderDetails order={tracked.order} />}
            <ReadState loading={tracked.loading} failed={tracked.failed} hasData={!!tracked.order} />
            {tracked.processing && <div role='status'>{t('settings.cloudAccount.orderProcessing')}</div>}
            {tracked.order && !tracked.handoffAvailable && tracked.order.status !== 'paid' && (
              <div role='status'>{t('settings.cloudAccount.handoffUnavailable')}</div>
            )}
            <div className='flex flex-wrap gap-8px'>
              <Button
                loading={busy}
                disabled={busy || !!conflict || (!!tracked.order && !tracked.handoffAvailable)}
                onClick={() => {
                  void create(intent);
                }}
              >
                {t(`settings.cloudAccount.${tracked.order ? 'reopenCheckout' : 'retryPurchase'}`)}
              </Button>
              {handoffReady && (
                <Button
                  disabled={!tracked.handoffAvailable}
                  onClick={() => {
                    const pending = handoff.current;
                    if (
                      !pending ||
                      !pending.valid() ||
                      !tracked.handoffAvailable ||
                      pending.orderId !== tracked.order?.order_id ||
                      !pending.open()
                    )
                      setNotice('checkoutFailed');
                  }}
                >
                  {t('settings.cloudAccount.openCheckout')}
                </Button>
              )}
              <Button onClick={tracked.refresh} disabled={!tracked.order}>
                {t('settings.cloudAccount.refreshOrder')}
              </Button>
              <Button disabled={busy} onClick={() => setNewIntent(true)}>
                {t('settings.cloudAccount.changePurchase')}
              </Button>
            </div>
            {newIntent && (
              <>
                <Alert type='warning' content={t('settings.cloudAccount.newPurchaseWarning')} />
                <Button
                  onClick={() => {
                    // This explicit new intent supersedes pending renderer continuations.
                    // A previously authorized checkout can still exist remotely.
                    flight.current++;
                    setBusy(false);
                    intentRef.current = undefined;
                    setKnown(undefined);
                    setIntent(undefined);
                    setConflict(undefined);
                    setNotice(undefined);
                    setNewIntent(false);
                    setSelection('');
                    handoff.current = undefined;
                    setHandoffReady(false);
                    options.refresh();
                  }}
                >
                  {t('settings.cloudAccount.startNewPurchase')}
                </Button>
                <Button onClick={() => setNewIntent(false)}>{t('settings.cloudAccount.cancel')}</Button>
              </>
            )}
          </>
        )}
        {!intent && notice && <Alert type='warning' content={t(`settings.cloudAccount.${notice}`)} />}
        <Button onClick={options.refresh}>{t('settings.cloudAccount.refreshOptions')}</Button>
      </Panel>
      <Orders />
    </>
  );
}
