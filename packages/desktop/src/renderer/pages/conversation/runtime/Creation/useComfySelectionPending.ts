import { useSyncExternalStore } from 'react';

const pending = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Freeze sends until the snapshot and the media-service binding agree. */
export function beginComfySelectionChange(id: string): () => void {
  pending.set(id, (pending.get(id) ?? 0) + 1);
  notify();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const count = (pending.get(id) ?? 1) - 1;
    if (count) pending.set(id, count);
    else pending.delete(id);
    notify();
  };
}

export function useComfySelectionPending(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending.has(id),
    () => false
  );
}
