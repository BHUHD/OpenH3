import { useEffect, useState } from 'react';

export const WORKSPACE_EXPANSION_STORAGE_KEY = 'openh3_workspace_expansion';
export const LEGACY_WORKSPACE_EXPANSION_STORAGE_KEY = 'aionui_workspace_expansion';
export const WORKSPACE_EXPANSION_EVENT = 'openh3:workspace-expansion-changed';
export const LEGACY_WORKSPACE_EXPANSION_EVENT = 'aionui:workspace-expansion-changed';

type WorkspaceExpansionChangeDetail = {
  expandedWorkspaces: string[];
};

export const readExpandedWorkspaces = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored =
      localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_WORKSPACE_EXPANSION_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const dispatchWorkspaceExpansionChange = (expandedWorkspaces: string[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const detail = { expandedWorkspaces };
  window.dispatchEvent(new CustomEvent<WorkspaceExpansionChangeDetail>(WORKSPACE_EXPANSION_EVENT, { detail }));
  window.dispatchEvent(new CustomEvent<WorkspaceExpansionChangeDetail>(LEGACY_WORKSPACE_EXPANSION_EVENT, { detail }));
};

export const useWorkspaceExpansionState = (): string[] => {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>(() => readExpandedWorkspaces());

  useEffect(() => {
    const handleWorkspaceExpansionChange = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceExpansionChangeDetail>;
      setExpandedWorkspaces(customEvent.detail?.expandedWorkspaces ?? readExpandedWorkspaces());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_EXPANSION_STORAGE_KEY || event.key === LEGACY_WORKSPACE_EXPANSION_STORAGE_KEY) {
        setExpandedWorkspaces(readExpandedWorkspaces());
      }
    };

    window.addEventListener(WORKSPACE_EXPANSION_EVENT, handleWorkspaceExpansionChange as EventListener);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(WORKSPACE_EXPANSION_EVENT, handleWorkspaceExpansionChange as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return expandedWorkspaces;
};
