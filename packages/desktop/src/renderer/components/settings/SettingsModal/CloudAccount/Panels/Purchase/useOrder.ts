import { useEffect, useRef, useState } from 'react';
import { useCloudAccount } from '../../Provider';
import { withoutCheckout, type OwnedOrder } from './Terms';

/** Only owned server observations change payment status. Local expiry is handoff-only. */
export function useOrder(initial?: OwnedOrder) {
  const cloud = useCloudAccount();
  const [order, setOrder] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const orderRef = useRef(order);
  const refreshRef = useRef<() => void>(() => {});
  const pollingWindow = useRef<{ id: string; deadline: number } | undefined>(undefined);
  const billing = useRef(cloud.refreshBilling);
  billing.current = cloud.refreshBilling;
  useEffect(() => {
    if (!initial) {
      setOrder(undefined);
      return;
    }
    setOrder((previous) =>
      previous?.order_id === initial.order_id && previous.status === 'paid' ? previous : initial
    );
  }, [initial]);
  orderRef.current = order;
  const orderId = order?.order_id;
  useEffect(() => {
    if (orderId && order?.status === 'paid') billing.current([orderId]);
  }, [orderId, order?.status, cloud.scope]);
  useEffect(() => {
    if (!orderId) return;
    let live = true;
    let sequence = 0;
    let step = 0;
    const valid = cloud.captureScope();
    if (pollingWindow.current?.id !== orderId) pollingWindow.current = { id: orderId, deadline: Date.now() + 60000 };
    const deadline = pollingWindow.current.deadline;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (timer) clearTimeout(timer);
    };
    const read = async () => {
      const currentSequence = ++sequence;
      setLoading(true);
      const result = await cloud.readOwned({ operation: 'topupOrders', input: { order_id: orderId, page_size: 1 } });
      if (!live || !valid()) return;
      const found =
        result?.success && result.data && 'items' in result.data
          ? result.data.items.find((item) => 'order_id' in item && item.order_id === orderId)
          : undefined;
      // Dispatch order cannot establish server observation order. A paid result
      // for this owned order dominates pending even from an earlier request.
      if (currentSequence !== sequence && (!found || !('order_id' in found) || found.status !== 'paid')) return;
      setLoading(false);
      if (!found || !('order_id' in found)) {
        setFailed(true);
        return;
      }
      const next = withoutCheckout(found);
      if (orderRef.current?.status !== 'paid' || next.status === 'paid') {
        orderRef.current = next;
        setOrder(next);
      }
      setFailed(false);
      if (orderRef.current?.status !== 'pending') {
        stop();
        setProcessing(false);
      }
    };
    const schedule = () => {
      if (!live || !valid() || orderRef.current?.status !== 'pending') return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setProcessing(true);
        return;
      }
      const delay = [2000, 5000, 10000][Math.min(step++, 2)];
      timer = setTimeout(
        () => {
          if (!live || !valid()) return;
          if (Date.now() >= deadline) {
            setProcessing(true);
            return;
          }
          void read().then(schedule);
        },
        Math.min(delay, remaining)
      );
    };
    // The deadline also bounds a slow/inflight read, independently of backoff.
    const cutoff = setTimeout(
      () => {
        if (live && valid() && orderRef.current?.status === 'pending') {
          stop();
          setProcessing(true);
        }
      },
      Math.max(0, deadline - Date.now())
    );
    const foreground = () => {
      if (document.visibilityState === 'visible' && valid()) void read();
    };
    refreshRef.current = () => {
      if (live && valid()) void read();
    };
    setLoading(false);
    setProcessing(false);
    schedule();
    window.addEventListener('focus', foreground);
    return () => {
      live = false;
      sequence++;
      stop();
      clearTimeout(cutoff);
      refreshRef.current = () => {};
      window.removeEventListener('focus', foreground);
    };
  }, [cloud.scope, cloud.readOwned, orderId]);
  useEffect(() => {
    if (!order || order.handoff_status !== 'available') return;
    const delay = Math.max(0, order.handoff_expires_at * 1000 - Date.now());
    const timer = setTimeout(() => setNow(Date.now()), Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [order]);
  return {
    order,
    loading,
    failed,
    processing,
    handoffAvailable:
      order?.status === 'pending' &&
      order.handoff_status === 'available' &&
      order.handoff_expires_at * 1000 > Math.max(now, Date.now()),
    refresh: () => refreshRef.current(),
  };
}
