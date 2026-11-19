import { Button } from '@arco-design/web-react';
import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';

type WorkspacePanelFrameProps = {
  children: React.ReactNode;
  collapsed: boolean;
  widthPx: number;
  isMobile?: boolean;
  maximized?: boolean;
  project?: boolean;
  onCollapse?: () => void;
  dragHandle?: React.ReactNode;
};

/** Uses one panel DOM on desktop and narrow viewports so open content stays mounted. */
export default function WorkspacePanelFrame({
  children,
  collapsed,
  widthPx,
  isMobile = false,
  maximized = false,
  project = false,
  onCollapse,
  dragHandle,
}: WorkspacePanelFrameProps) {
  const { t } = useTranslation();
  const mountId = useId();
  const mobileWidth = Math.round(widthPx);
  const mobileOpen = isMobile && !collapsed;

  return (
    <>
      {mobileOpen && <div className='fixed inset-0 bg-black/30 z-90' onClick={onCollapse} aria-hidden='true' />}
      <div
        data-project-panel-host={project || undefined}
        data-explorer-column={(project && !isMobile) || undefined}
        data-explorer-mobile-overlay={(project && isMobile) || undefined}
        data-mount-id={project ? mountId : undefined}
        data-collapsed={collapsed}
        inert={collapsed}
        className='!bg-1 h-full flex-shrink-0 overflow-hidden relative chat-layout-right-sider'
        style={
          isMobile
            ? {
                position: 'fixed',
                right: 0,
                top: 0,
                height: '100dvh',
                width: mobileWidth,
                maxWidth: 'calc(100vw - 20px)',
                zIndex: 100,
                transform: collapsed ? 'translateX(100%)' : 'translateX(0)',
                pointerEvents: collapsed ? 'none' : 'auto',
                borderLeft: '1px solid var(--bg-3)',
              }
            : {
                width: collapsed ? 0 : maximized ? '100%' : Math.round(widthPx),
                borderLeft: collapsed || maximized ? 'none' : '1px solid var(--bg-3)',
              }
        }
      >
        {!isMobile && !collapsed && !maximized && dragHandle}
        {children}
      </div>
      {mobileOpen && (
        <Button
          type='text'
          className='!fixed z-101 !flex !items-center !justify-center workspace-toggle-floating'
          style={{
            top: '50%',
            right: `min(${mobileWidth}px, calc(100vw - 20px))`,
            transform: 'translateY(-50%)',
            width: 20,
            height: 64,
            borderStartStartRadius: 'var(--radius-control)',
            borderEndStartRadius: 'var(--radius-control)',
            padding: 0,
          }}
          onClick={onCollapse}
          aria-label={t('common.collapse')}
        >
          <span className='flex flex-col items-center justify-center gap-5px text-t-secondary' aria-hidden='true'>
            <span className='block w-8px h-2px rd-full bg-current opacity-85' />
            <span className='block w-8px h-2px rd-full bg-current opacity-65' />
            <span className='block w-8px h-2px rd-full bg-current opacity-45' />
          </span>
        </Button>
      )}
    </>
  );
}
