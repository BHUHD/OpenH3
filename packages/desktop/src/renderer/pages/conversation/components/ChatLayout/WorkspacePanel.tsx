import { Tabs } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConversationWorkProgress from '../../PlanBar/ConversationWorkProgress';
import PreviewPanel from '../../Preview/components/PreviewPanel/PreviewPanel';
import { usePreviewContextOptional } from '../../Preview/context/PreviewContext';
import styles from './WorkspacePanel.module.css';

type Tab = 'files' | 'progress' | 'preview';

type WorkspacePanelProps = {
  files?: React.ReactNode;
  fileActions?: React.ReactNode;
  conversationId?: string;
  project?: boolean;
  collapsed?: boolean;
  onReturnToConversation?: () => void;
};

/** Keeps the tree and open preview mounted while the user moves between tabs. */
export default function WorkspacePanel({
  files,
  fileActions,
  conversationId,
  project,
  collapsed,
  onReturnToConversation,
}: WorkspacePanelProps) {
  const { t } = useTranslation();
  const preview = usePreviewContextOptional();
  const previewOpen = Boolean(preview?.isOpen);
  const openRevision = preview?.openRevision ?? 0;
  const [selection, setSelection] = useState<{ tab: Tab; openRevision: number; conversationId?: string }>();
  const defaultTab: Tab = files ? 'files' : 'progress';
  let activeTab: Tab = defaultTab;
  if (previewOpen && selection?.openRevision !== openRevision) {
    activeTab = 'preview';
  } else if (selection?.tab === 'preview' && previewOpen) {
    activeTab = 'preview';
  } else if (selection?.tab === 'progress' && conversationId && selection.conversationId === conversationId) {
    activeTab = 'progress';
  }

  return (
    <Tabs
      type='line'
      size='mini'
      headerPadding={false}
      className={styles.panel}
      data-project-panel-content={project || undefined}
      activeTab={activeTab}
      onChange={(key) => {
        if (key !== 'files' && key !== 'progress' && key !== 'preview') return;
        setSelection({ tab: key, openRevision, conversationId });
        if (key !== 'preview' && preview?.isMaximized) preview.toggleMaximized();
      }}
      extra={activeTab === 'files' ? fileActions : undefined}
      lazyload={false}
    >
      {files && (
        <Tabs.TabPane
          key='files'
          title={t('conversation.explorer.tabs.files')}
          className='h-full'
          style={{ display: activeTab === 'files' ? undefined : 'none' }}
        >
          {files}
        </Tabs.TabPane>
      )}
      {conversationId && (
        <Tabs.TabPane key='progress' title={t('conversation.workProgress.tab')} className='h-full overflow-auto'>
          {!collapsed && activeTab === 'progress' && (
            <ConversationWorkProgress key={conversationId} conversationId={conversationId} />
          )}
        </Tabs.TabPane>
      )}
      {previewOpen && (
        <Tabs.TabPane
          key='preview'
          title={t('preview.preview')}
          className='h-full'
          style={{ display: activeTab === 'preview' ? undefined : 'none' }}
        >
          <div className='h-full min-w-0 preview-panel' data-project-preview-region={project || undefined}>
            <PreviewPanel
              conversationId={conversationId}
              isVisible={!collapsed && activeTab === 'preview'}
              onReturnToConversation={onReturnToConversation}
            />
          </div>
        </Tabs.TabPane>
      )}
    </Tabs>
  );
}
