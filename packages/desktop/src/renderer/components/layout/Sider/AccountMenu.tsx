/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Comment, LinkCloud, Logout, Moon, SunOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import { useFeedback } from '@/renderer/hooks/context/FeedbackContext';
import { resolveFeedbackModule } from '@/renderer/services/feedback/resolveFeedbackModule';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type AccountMenuProps = {
  collapsed: boolean;
  isMobile: boolean;
  theme: string;
  siderTooltipProps: SiderTooltipProps;
  onThemeToggle: () => void;
  onOpenLogin: () => void;
  onLogout?: () => void;
};

/** Sidebar footer account control.
 * - Not connected: shows a 「登录」 button that opens the LoginModal.
 * - Connected: shows username in a dropdown with account, theme, feedback, logout items.
 * - Collapsed: icon-only, tooltip shows username.
 */
const AccountMenu: React.FC<AccountMenuProps> = ({
  collapsed,
  isMobile,
  theme,
  siderTooltipProps,
  onThemeToggle,
  onOpenLogin,
  onLogout: _onLogout,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const cloud = useOptionalCloudAccount();
  const { openFeedback } = useFeedback();
  const connected = cloud?.session?.state === 'connected';
  const account = connected && cloud?.session?.state === 'connected' ? cloud.session.account : undefined;
  const displayName = account?.display_name ?? account?.username;
  const themeLabel = theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode');
  const mobileClass = isMobile ? 'sider-footer-btn-mobile' : '';

  const rowClass = `sider-nav-entry !h-34px ${collapsed ? 'sider-nav-entry--collapsed' : '!ps-13px !pe-8px !gap-11px'} ${mobileClass}`;

  if (!connected) {
    return (
      <Tooltip {...siderTooltipProps} content={t('settings.cloudAccount.entry')} position='right'>
        <Button
          type='text'
          icon={<LinkCloud size={16} />}
          aria-label={t('settings.cloudAccount.entry')}
          className={rowClass}
          onClick={onOpenLogin}
        >
          {!collapsed && <span className='truncate text-14px font-[500]'>{t('settings.cloudAccount.entry')}</span>}
        </Button>
      </Tooltip>
    );
  }

  const menu = (
    <Menu
      onClickMenuItem={(key) => {
        if (key === 'account') void navigate('/settings/cloud-account');
        if (key === 'theme') onThemeToggle();
        if (key === 'feedback')
          void openFeedback({ autoScreenshot: true, module: resolveFeedbackModule(location.pathname) });
        // Cloud logout: call directly on the cloud context rather than delegating
        // to the footer's onLogout prop, which routes to WebUI auth logout instead.
        if (key === 'logout') void cloud?.run({ operation: 'logout' });
      }}
    >
      <Menu.Item key='account'>
        <span className='flex items-center gap-8px'>
          <LinkCloud size={14} />
          {t('settings.cloudAccount.accountMenu')}
        </span>
      </Menu.Item>
      <Menu.Item key='theme'>
        <span className='flex items-center gap-8px'>
          {theme === 'dark' ? <SunOne size={14} /> : <Moon size={14} />}
          {themeLabel}
        </span>
      </Menu.Item>
      <Menu.Item key='feedback'>
        <span className='flex items-center gap-8px'>
          <Comment size={14} />
          {t('conversation.welcome.quickActionFeedback', { defaultValue: 'Feedback' })}
        </span>
      </Menu.Item>
      <div className='h-1px bg-[var(--color-border-2)] my-4px mx-4px' aria-hidden='true' />
      <Menu.Item key='logout'>
        <span className='flex items-center gap-8px text-danger'>
          <Logout size={14} />
          {t('settings.cloudAccount.logout')}
        </span>
      </Menu.Item>
    </Menu>
  );

  const label = displayName ?? t('settings.cloudAccount.accountMenu');

  if (collapsed) {
    return (
      <Tooltip {...siderTooltipProps} content={label} position='right'>
        <Dropdown droplist={menu} position='tr' trigger='click'>
          <Button
            type='text'
            shape='circle'
            aria-label={label}
            className='!w-34px !h-34px !p-0 !rd-0.5rem text-t-secondary hover:text-t-primary hover:bg-hover active:bg-active transition-colors'
            icon={<LinkCloud size={16} />}
          />
        </Dropdown>
      </Tooltip>
    );
  }

  return (
    <Dropdown droplist={menu} position='tr' trigger='click'>
      <Button type='text' icon={<LinkCloud size={16} />} aria-label={label} className={rowClass}>
        <span className='truncate text-14px font-[500]'>{label}</span>
      </Button>
    </Dropdown>
  );
};

export default AccountMenu;
