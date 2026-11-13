/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useSyncExternalStore } from 'react';
import {
  getSidebarUpdateState,
  subscribeSidebarUpdateState,
  requestSidebarUpdateAction,
} from '@/renderer/components/settings/updateReadyState';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@arco-design/web-react';
import { ArrowCircleLeft, Download, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import styles from './Sider.module.css';
import AccountMenu from './AccountMenu';

type SiderFooterProps = {
  isMobile: boolean;
  isSettings: boolean;
  collapsed?: boolean;
  theme: string;
  siderTooltipProps: SiderTooltipProps;
  onSettingsClick: () => void;
  onThemeToggle: () => void;
  showLogout?: boolean;
  onLogoutClick?: () => void;
  onOpenLogin: () => void;
};

const SiderFooter: React.FC<SiderFooterProps> = ({
  isMobile,
  isSettings,
  collapsed = false,
  theme,
  siderTooltipProps,
  onSettingsClick,
  onThemeToggle,
  showLogout: _showLogout,
  onLogoutClick,
  onOpenLogin,
}) => {
  const { t } = useTranslation();
  const update = useSyncExternalStore(subscribeSidebarUpdateState, getSidebarUpdateState);
  const showUpdate =
    isElectronDesktop() &&
    update &&
    ['available', 'downloading', 'downloaded', 'preparing-install', 'error'].includes(update.status) &&
    Boolean(update.autoUpdateInfo?.version || update.updateInfo?.version);
  const updateLabel =
    update?.status === 'downloading'
      ? t('update.sidebarDownloading', { percent: update.progress.percent })
      : update?.status === 'downloaded'
        ? t(update.downloadPath ? 'update.openInstaller' : 'update.sidebarWaitingForIdle')
        : update?.status === 'preparing-install'
          ? t('update.preparingInstall')
          : update?.status === 'error'
            ? t('update.sidebarRetry')
            : t('update.sidebarAvailable');

  const settingsIcon = isSettings ? (
    <ArrowCircleLeft
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  ) : (
    <SettingTwo
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  );

  return (
    <div className='shrink-0 sider-footer mt-auto pt-8px pb-8px border-t border-solid border-[var(--color-border-2)] border-s-0 border-e-0 border-b-0'>
      {/* Account entry: login button (not connected) or username dropdown (connected) */}
      <AccountMenu
        collapsed={collapsed}
        isMobile={isMobile}
        theme={theme}
        siderTooltipProps={siderTooltipProps}
        onThemeToggle={onThemeToggle}
        onOpenLogin={onOpenLogin}
        onLogout={onLogoutClick}
      />
      <div className={classNames('flex', collapsed ? 'flex-col gap-2px' : 'items-center gap-2px')}>
        <Tooltip {...siderTooltipProps} content={isSettings ? t('common.back') : t('common.settings')} position='right'>
          <div
            onClick={onSettingsClick}
            className={classNames(
              'group h-34px flex items-center rd-0.5rem cursor-pointer transition-colors',
              collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-8px ps-10px pe-8px',
              isMobile && 'sider-footer-btn-mobile',
              {
                'bg-active': isSettings,
                'hover:bg-hover active:bg-active': !isSettings,
              }
            )}
          >
            <span className='size-22px flex items-center justify-center shrink-0 text-t-secondary'>{settingsIcon}</span>
            <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
              {isSettings ? t('common.back') : t('common.settings')}
            </span>
          </div>
        </Tooltip>
        {showUpdate && (
          <Tooltip
            className={siderTooltipProps.className}
            getPopupContainer={siderTooltipProps.getPopupContainer}
            unmountOnExit
            popupHoverStay={false}
            trigger={['hover', 'focus']}
            content={updateLabel}
            position='top'
          >
            <Button
              type='text'
              size='small'
              shape='circle'
              aria-label={updateLabel}
              aria-busy={update.status === 'downloading' || update.status === 'preparing-install'}
              aria-disabled={update.status === 'preparing-install'}
              data-update-status={update.status}
              onClick={update.status === 'preparing-install' ? undefined : requestSidebarUpdateAction}
              className={classNames(
                'sider-update-button shrink-0 !h-34px !w-34px !p-0',
                styles.updateButton,
                collapsed && '!self-center'
              )}
              icon={
                <span aria-hidden='true' className='relative inline-flex'>
                  <Download size='16' strokeWidth={3} fill='currentColor' />
                  {update.status === 'available' && <span aria-hidden='true' className={styles.updateDot} />}
                </span>
              }
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default SiderFooter;
