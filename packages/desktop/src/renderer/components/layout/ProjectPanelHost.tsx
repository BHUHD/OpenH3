/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import WorkspacePanel from '@/renderer/pages/conversation/components/ChatLayout/WorkspacePanel';
import WorkspacePanelFrame from '@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelFrame';
import { ExplorerContainer } from '@/renderer/pages/conversation/explorer/ExplorerContainer';
import { useCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import { useCurrentConversation } from '@/renderer/pages/conversation/explorer/currentConversationStore';

type ProjectPanelHostProps = {
  widthPx: number;
  collapsed: boolean;
  isMobile?: boolean;
  maximized?: boolean;
  onCollapse?: () => void;
  onReturnToConversation?: () => void;
  dragHandle?: React.ReactNode;
};

/** Layout hosts the panel above the route so same-project conversations share it. */
export const ProjectPanelHost: React.FC<ProjectPanelHostProps> = ({ onReturnToConversation, ...props }) => {
  const projectId = useCurrentProject();
  const conversationId = useCurrentConversation();
  if (!projectId) return null;

  return (
    <WorkspacePanelFrame {...props} project>
      <WorkspacePanel
        key={projectId}
        project
        collapsed={props.collapsed}
        onReturnToConversation={onReturnToConversation}
        files={<ExplorerContainer projectId={projectId} />}
        conversationId={conversationId ?? undefined}
      />
    </WorkspacePanelFrame>
  );
};
