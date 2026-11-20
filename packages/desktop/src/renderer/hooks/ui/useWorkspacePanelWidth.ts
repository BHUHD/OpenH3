import { useEffect } from 'react';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

const MIN_CHAT_WIDTH = 360;
const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 600;
const DEFAULT_PANEL_WIDTH = 360;

/** A single resize preference applies to Files, Progress, and Preview. */
export function useWorkspacePanelWidth(availableWidth: number) {
  const maxWidth = availableWidth
    ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, availableWidth - MIN_CHAT_WIDTH))
    : MAX_PANEL_WIDTH;
  const { splitRatio, setSplitRatio, createDragHandle } = useResizableSplit({
    unit: 'px',
    defaultWidth: Math.min(DEFAULT_PANEL_WIDTH, maxWidth),
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    storageKey: 'chat-workspace-width-px',
  });

  useEffect(() => {
    if (splitRatio > maxWidth) setSplitRatio(maxWidth);
  }, [splitRatio, maxWidth, setSplitRatio]);

  return { widthPx: Math.min(splitRatio, maxWidth), createDragHandle };
}
