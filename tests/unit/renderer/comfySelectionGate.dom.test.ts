import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  beginComfySelectionChange,
  useComfySelectionPending,
} from '@/renderer/pages/conversation/runtime/Creation/useComfySelectionPending';

describe('local profile selection gate', () => {
  it('blocks all views of one conversation until each pending selection completes', () => {
    const first = renderHook(() => useComfySelectionPending('conv-a'));
    const peer = renderHook(() => useComfySelectionPending('conv-a'));
    const other = renderHook(() => useComfySelectionPending('conv-b'));
    let done!: () => void;
    let donePeer!: () => void;
    act(() => {
      done = beginComfySelectionChange('conv-a');
      donePeer = beginComfySelectionChange('conv-a');
    });
    expect(first.result.current).toBe(true);
    expect(peer.result.current).toBe(true);
    expect(other.result.current).toBe(false);
    act(() => {
      done();
      done();
    });
    expect(first.result.current).toBe(true);
    act(() => donePeer());
    expect(peer.result.current).toBe(false);
  });
});
