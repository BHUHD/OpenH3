import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clearGuidDraftIfMatches, useGuidDraft } from '@/renderer/pages/guid/hooks/useGuidDraft';

describe('useGuidDraft', () => {
  it('clears the sent draft after navigation has unmounted its composer', () => {
    const first = renderHook(() => useGuidDraft());
    act(() => first.result.current[1]('Sent prompt'));
    const staleSetter = first.result.current[1];
    first.unmount();
    act(() => staleSetter(''));
    const second = renderHook(() => useGuidDraft());
    expect(second.result.current[0]).toBe('');
    second.unmount();
  });

  it('does not discard a newer draft when an earlier send is acknowledged', () => {
    const hook = renderHook(() => useGuidDraft());
    act(() => hook.result.current[1]('New draft'));
    act(() => clearGuidDraftIfMatches('Earlier send'));
    expect(hook.result.current[0]).toBe('New draft');
    act(() => clearGuidDraftIfMatches('New draft'));
    expect(hook.result.current[0]).toBe('');
    hook.unmount();
  });

  it('keeps the new-chat draft when the Guid surface is unmounted and mounted again', () => {
    const first = renderHook(() => useGuidDraft());
    act(() => first.result.current[1]('A prompt I am still working on'));
    first.unmount();

    const second = renderHook(() => useGuidDraft());
    expect(second.result.current[0]).toBe('A prompt I am still working on');
    second.unmount();
  });
});
