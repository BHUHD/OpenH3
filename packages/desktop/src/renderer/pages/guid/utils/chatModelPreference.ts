import type { IProvider } from '@/common/config/storage';
import { useSyncExternalStore } from 'react';

export type ChatModelChoice = {
  providerId: string;
  modelName: string;
  source: 'byok' | 'cloud_account';
  accountKey?: string;
  protocol?: string;
};
const listeners = new Set<() => void>();
const memory = new Map<string, string>();
const keyFor = (owner: string) => `openh3.chat-model.v1:${encodeURIComponent(owner)}`;

export function chatModelChoice(
  provider: Pick<IProvider, 'id' | 'managed_by' | 'model_settings'>,
  modelName: string,
  accountKey?: string
): ChatModelChoice {
  return provider.managed_by === 'cloud_account'
    ? {
        providerId: provider.id,
        modelName,
        source: 'cloud_account',
        accountKey,
        protocol: provider.model_settings?.[modelName]?.openai_api_mode,
      }
    : { providerId: provider.id, modelName, source: 'byok' };
}

/** Keep only the binding, never a provider object containing credentials or endpoints. */
export function rememberChatModel(owner: string, choice: ChatModelChoice | 'unavailable'): void {
  const key = keyFor(owner);
  const value = JSON.stringify(choice);
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
};
export function useRememberedChatModel(owner: string | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!owner) return null;
      const key = keyFor(owner);
      try {
        return memory.get(key) ?? localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    (): null => null
  );
}
export function parseChatModelChoice(value: string | null): ChatModelChoice | 'unavailable' | undefined {
  if (value === null) return undefined;
  try {
    const item: unknown = JSON.parse(value);
    if (
      item &&
      typeof item === 'object' &&
      'providerId' in item &&
      typeof item.providerId === 'string' &&
      'modelName' in item &&
      typeof item.modelName === 'string' &&
      'source' in item &&
      (item.source === 'byok' ||
        (item.source === 'cloud_account' &&
          'accountKey' in item &&
          typeof item.accountKey === 'string' &&
          (!('protocol' in item) || typeof item.protocol === 'string')))
    )
      return item as ChatModelChoice;
  } catch {
    // An unreadable explicit preference requires the user to choose the billing source again.
  }
  return 'unavailable';
}
