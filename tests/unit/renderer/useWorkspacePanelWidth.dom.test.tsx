import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspacePanelWidth } from '@/renderer/hooks/ui/useWorkspacePanelWidth';

beforeEach(() => localStorage.clear());

describe('useWorkspacePanelWidth', () => {
  it('restores the existing workspace width preference', () => {
    localStorage.setItem('chat-workspace-width-px', '400');
    const { result } = renderHook(() => useWorkspacePanelWidth(900));
    expect(result.current.widthPx).toBe(400);
  });

  it('keeps space for chat when the row shrinks', () => {
    localStorage.setItem('chat-workspace-width-px', '400');
    const { result, rerender } = renderHook(({ width }) => useWorkspacePanelWidth(width), {
      initialProps: { width: 900 },
    });
    rerender({ width: 680 });
    expect(result.current.widthPx).toBe(320);
    expect(localStorage.getItem('chat-workspace-width-px')).toBe('320');
  });
});
