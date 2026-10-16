import { useCallback, useSyncExternalStore } from 'react';

let draft = '';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => draft;
const writeDraft = (next: string) => {
  if (draft === next) return;
  draft = next;
  for (const listener of listeners) listener();
};

/** Release only the prompt acknowledged by the backend, even after navigation. */
export const clearGuidDraftIfMatches = (sent: string): void => {
  if (draft === sent) writeDraft('');
};

export const useGuidDraft = () => {
  const content = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setDraft = useCallback<React.Dispatch<React.SetStateAction<string>>>((nextValue) => {
    writeDraft(typeof nextValue === 'function' ? nextValue(draft) : nextValue);
  }, []);
  return [content, setDraft] as const;
};
