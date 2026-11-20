import { useEffect, useRef } from 'react';
import { useSWRConfig } from 'swr';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import { PROVIDERS_SWR_KEY } from '@/renderer/hooks/agent/useModelProviderList';
import { signalAccountActivity } from './freshness';

const MAX_SEEN_TURNS = 200;

/**
 * After a chat turn ends on an account-managed model, settle balance and ledger.
 * `turn.completed` carries no model provenance, so the persisted conversation
 * provider is classified against the configured providers; unknown or BYOK fails closed.
 */
export function useManagedTurnSettlement(connected: boolean, captureScope: () => () => boolean): void {
  const { cache } = useSWRConfig();
  const capture = useRef(captureScope);
  capture.current = captureScope;
  useEffect(() => {
    const emitter = ipcBridge.conversation?.turnCompleted;
    if (!connected || !emitter) return;
    const seen = new Set<string>();
    return emitter.on((event) => {
      const key = `${event.session_id}:${event.turn_id}`;
      if (!event.session_id || seen.has(key)) return;
      seen.add(key);
      if (seen.size > MAX_SEEN_TURNS) seen.delete(seen.values().next().value as string);
      const stillCurrent = capture.current();
      void (async () => {
        try {
          const conversation = await ipcBridge.conversation.get.invoke({ id: event.session_id });
          const model = conversation && 'model' in conversation ? conversation.model : undefined;
          if (!model?.id || !stillCurrent()) return;
          const providers = cache.get(PROVIDERS_SWR_KEY)?.data as IProvider[] | undefined;
          const managed =
            model.managed_by === 'cloud_account' ||
            !!providers?.some((provider) => provider.id === model.id && provider.managed_by === 'cloud_account');
          if (managed) signalAccountActivity();
        } catch {
          // A lookup failure leaves the balance to focus or manual refresh.
        }
      })();
    });
  }, [connected, cache]);
}
