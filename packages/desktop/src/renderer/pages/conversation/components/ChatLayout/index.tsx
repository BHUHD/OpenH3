import { AgentLogoIcon } from '@/renderer/components/agent/AgentBadge';
import type { PresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useWorkspacePanelWidth } from '@/renderer/hooks/ui/useWorkspacePanelWidth';
import ChatTitleEditor from '@/renderer/pages/conversation/components/ChatTitleEditor';
import WorkspaceOpenButton from './WorkspaceOpenButton';
import WorkspacePanel from './WorkspacePanel';
import WorkspacePanelFrame from './WorkspacePanelFrame';
import { useContainerWidth } from '@/renderer/pages/conversation/hooks/useContainerWidth';
import { useTitleRename } from '@/renderer/pages/conversation/hooks/useTitleRename';
import { useWorkspaceCollapse } from '@/renderer/pages/conversation/hooks/useWorkspaceCollapse';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';
import classNames from 'classnames';
import { Layout as ArcoLayout } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './chat-layout.css';

// headerExtra allows injecting custom actions (e.g., model picker) into the header's right area
const ChatLayout: React.FC<{
  children: React.ReactNode;
  title?: React.ReactNode;
  sider: React.ReactNode;
  backend?: string;
  /** Preset assistant info — when provided, badge shows assistant identity instead of backend */
  presetAssistant?: PresetAssistantInfo & { id?: string };
  /** Fallback agent name (used when no presetAssistant, e.g. from conversation.extra.agent_name) */
  agent_name?: string;
  headerExtra?: React.ReactNode;
  workspaceEnabled?: boolean;
  /**
   * Project conversations use the Layout-level panel on every viewport so the
   * Explorer and Preview survive same-project conversation switches.
   */
  previewHosted?: boolean;
  /** Conversation ID for mode switching */
  conversation_id?: string;
  /** Custom tabs slot; when provided, replaces the default ConversationTabs */
  tabsSlot?: React.ReactNode;
  /** Workspace path for opening in external tools */
  workspacePath?: string;
  /** Authoritative temp-workspace flag from `conversation.extra.is_temporary_workspace`. */
  isTemporaryWorkspace?: boolean;
  /**
   * Stable key for persisting the workspace collapse preference. Defaults to
   * `conversation_id` for single chats; team mode passes `team_id` so the
   * preference survives agent-tab switches.
   */
  workspacePreferenceKey?: string;
  /** Custom rename handler; when provided, replaces the default conversation.update rename flow */
  onRenameTitle?: (new_name: string) => Promise<boolean>;
  /** Optional override for the leading icon shown before the title (e.g. team Peoples icon) */
  headerLeading?: React.ReactNode;
}> = (props) => {
  const { conversation_id, workspacePath, isTemporaryWorkspace } = props;
  const { backend, presetAssistant, agent_name, workspaceEnabled = true, workspacePreferenceKey } = props;
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const { isOpen, isMaximized, openRevision } = usePreviewContext();
  const isPreviewOpen = isOpen && !props.previewHosted;
  const rightPanelEnabled = !props.previewHosted && Boolean(workspaceEnabled || conversation_id || isPreviewOpen);

  const { rightSiderCollapsed, setRightSiderCollapsed } = useWorkspaceCollapse({
    workspaceEnabled: rightPanelEnabled,
    isMobile,
    conversation_id,
    preferenceKey: workspacePreferenceKey ?? conversation_id,
    isTemporaryWorkspace,
  });

  useEffect(() => {
    if (isPreviewOpen) setRightSiderCollapsed(false);
  }, [isMobile, isPreviewOpen, openRevision, setRightSiderCollapsed]);
  const previewMaximized = !isMobile && !rightSiderCollapsed && isPreviewOpen && isMaximized;

  const { containerRef, containerWidth } = useContainerWidth();
  const { widthPx, createDragHandle } = useWorkspacePanelWidth(rightPanelEnabled && !isMobile ? containerWidth : 0);
  const panelWidth = isMobile ? Math.min(420, Math.max(280, Math.round(containerWidth * 0.85))) : widthPx;
  const titleAreaMaxWidth = Math.max(320, Math.min(820, containerWidth - 520));

  const { editingTitle, setEditingTitle, titleDraft, setTitleDraft, renameLoading, canRenameTitle, submitTitleRename } =
    useTitleRename({
      title: props.title,
      conversation_id,
      onRename: props.onRenameTitle,
    });

  const capitalizedBackend = backend ? backend.charAt(0).toUpperCase() + backend.slice(1) : backend;

  // Compute display name with fallback chain
  const display_name = presetAssistant?.name || agent_name || capitalizedBackend;

  const [mobileActionsSlot, setMobileActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileActionsSlot(null);
      return;
    }
    const findSlot = () => document.getElementById('app-titlebar-actions-slot');
    setMobileActionsSlot(findSlot());
    const observer = new MutationObserver(() => {
      const next = findSlot();
      setMobileActionsSlot((prev) => (prev === next ? prev : next));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [layout?.isMobile]);

  const desktopHeader = (
    <ArcoLayout.Header
      className={classNames(
        'min-h-44px flex items-center justify-between px-16px pt-8px pb-10px gap-16px !bg-1 chat-layout-header chat-layout-header--glass overflow-hidden'
      )}
    >
      <FlexFullContainer className='h-full min-w-0' containerClassName='flex items-center'>
        <ChatTitleEditor
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          setTitleDraft={setTitleDraft}
          setEditingTitle={setEditingTitle}
          renameLoading={renameLoading}
          canRenameTitle={canRenameTitle}
          submitTitleRename={submitTitleRename}
          titleAreaMaxWidth={titleAreaMaxWidth}
          title={props.title}
          conversation_id={conversation_id}
          leading={
            props.headerLeading ??
            ((backend || presetAssistant) && (
              <AgentLogoIcon
                backend={backend}
                agent_name={display_name}
                agentLogo={presetAssistant?.logo}
                agentLogoIsEmoji={presetAssistant?.isEmoji}
                agentLogoIsFallback={presetAssistant?.isFallback}
              />
            ))
          }
        />
      </FlexFullContainer>
      <div className='flex items-center gap-12px shrink-0'>{props.headerExtra}</div>
    </ArcoLayout.Header>
  );

  const headerBlock = (
    <>
      {layout?.isMobile
        ? mobileActionsSlot && props.headerExtra && createPortal(props.headerExtra, mobileActionsSlot)
        : desktopHeader}
      {props.tabsSlot}
    </>
  );

  return (
    <ArcoLayout className='size-full color-black'>
      <div ref={containerRef} className='flex flex-1 relative w-full overflow-hidden'>
        <div className='flex flex-1 flex-col min-w-0' style={{ display: previewMaximized ? 'none' : undefined }}>
          <div className='shrink-0 !bg-1'>{headerBlock}</div>
          <ArcoLayout.Content className='flex flex-col flex-1 min-h-0 bg-1 overflow-hidden'>
            {props.children}
          </ArcoLayout.Content>
        </div>
        {rightPanelEnabled && (
          <WorkspacePanelFrame
            collapsed={rightSiderCollapsed}
            isMobile={isMobile}
            maximized={previewMaximized}
            widthPx={panelWidth}
            onCollapse={dispatchWorkspaceToggleEvent}
            dragHandle={createDragHandle({ className: 'absolute start-0 top-0 bottom-0 z-20', reverse: true })}
          >
            <WorkspacePanel
              files={workspaceEnabled ? props.sider : undefined}
              fileActions={
                workspacePath && (
                  <WorkspaceOpenButton workspacePath={workspacePath} isTemporary={isTemporaryWorkspace} />
                )
              }
              conversationId={conversation_id}
              collapsed={rightSiderCollapsed}
              onReturnToConversation={() => setRightSiderCollapsed(true)}
            />
          </WorkspacePanelFrame>
        )}
      </div>
    </ArcoLayout>
  );
};

export default ChatLayout;
