/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Logout, SettingTwo, Wallet } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import {
  CloudAccountAvatar,
  CloudAccountIcon,
  useCloudAccountIdentity,
} from '@/renderer/components/settings/SettingsModal/CloudAccount/Identity';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type AccountMenuProps = {
  collapsed: boolean;
  isMobile: boolean;
  siderTooltipProps: SiderTooltipProps;
  onOpenLogin: () => void;
  onOpenSettings?: () => void;
  trigger?: 'account' | 'settings';
};

/** Account identity and gear share the same account shortcuts and session. */
const AccountMenu: React.FC<AccountMenuProps> = ({
  collapsed,
  isMobile,
  siderTooltipProps,
  onOpenLogin,
  onOpenSettings,
  trigger = 'account',
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cloud = useOptionalCloudAccount();
  const { account, label } = useCloudAccountIdentity();
  const settingsTrigger = trigger === 'settings';
  const triggerLabel = settingsTrigger ? t('common.settings') : label;
  const rowClass = `sider-nav-entry !h-34px ${collapsed ? 'sider-nav-entry--collapsed' : '!ps-11px !pe-8px !gap-9px'} ${isMobile ? 'sider-footer-btn-mobile' : ''}`;
  const button = (
    <Button
      type='text'
      aria-label={triggerLabel}
      aria-haspopup={account || settingsTrigger ? 'menu' : undefined}
      className={
        settingsTrigger
          ? `!h-34px !w-34px !p-0 shrink-0 !rd-0.5rem !flex items-center justify-center text-t-secondary hover:text-t-primary hover:bg-hover active:bg-active ${isMobile ? 'sider-footer-btn-mobile' : ''}`
          : rowClass
      }
      icon={settingsTrigger ? <SettingTwo size={16} /> : account ? <CloudAccountAvatar /> : <CloudAccountIcon />}
      onClick={!account && !settingsTrigger ? onOpenLogin : undefined}
    >
      {!collapsed && !settingsTrigger && <span className='truncate text-14px font-[500]'>{label}</span>}
    </Button>
  );
  const menu = (
    <Menu
      style={{ minWidth: 184, padding: 6, borderRadius: 12 }}
      onClickMenuItem={(key) => {
        if (key === 'account') {
          if (account) void navigate('/settings/cloud-account');
          else onOpenLogin();
        }
        if (key === 'balance') void navigate('/settings/cloud-account?view=balance');
        if (key === 'logout') void cloud?.run({ operation: 'logout' });
        if (key === 'settings') {
          if (onOpenSettings) onOpenSettings();
          else void navigate('/settings/agent');
        }
      }}
    >
      <Menu.Item key='account'>
        <span className='flex items-center gap-10px'>
          <CloudAccountIcon />
          {t(account ? 'settings.cloudAccount.mine' : 'settings.cloudAccount.entry')}
        </span>
      </Menu.Item>
      {account && (
        <Menu.Item key='balance'>
          <span className='flex items-center gap-10px'>
            <Wallet size={16} />
            {t('settings.cloudAccount.balanceShortcut')}
          </span>
        </Menu.Item>
      )}
      {account && (
        <Menu.Item key='logout' disabled={cloud?.busy}>
          <span className='flex items-center gap-10px text-t-secondary'>
            <Logout size={16} />
            {t('settings.cloudAccount.logout')}
          </span>
        </Menu.Item>
      )}
      <div className='h-1px bg-[var(--color-border-2)] my-4px mx-4px' aria-hidden='true' />
      <Menu.Item key='settings'>
        <span className='flex items-center gap-10px'>
          <SettingTwo size={16} />
          {t('common.settings')}
        </span>
      </Menu.Item>
    </Menu>
  );
  return (
    <Tooltip {...siderTooltipProps} content={triggerLabel} position='right'>
      {account || settingsTrigger ? (
        <Dropdown droplist={menu} position='tr' trigger='click' unmountOnExit>
          {button}
        </Dropdown>
      ) : (
        button
      )}
    </Tooltip>
  );
};

export default AccountMenu;
