import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { Magic } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type SiderCreationEntryProps = {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
};

const SiderCreationEntry: React.FC<SiderCreationEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  const label = t('guid.aiCreation');
  return (
    <Tooltip {...siderTooltipProps} content={label} position='right'>
      <div
        className={classNames(
          'box-border group h-34px w-full flex items-center cursor-pointer shrink-0 transition-all text-t-primary',
          collapsed ? 'justify-center rd-8px' : 'justify-start gap-8px ps-10px pe-8px rd-0.5rem',
          isMobile && 'sider-action-btn-mobile',
          isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={onClick}
      >
        <span className='size-22px flex items-center justify-center shrink-0 text-primary'>
          <Magic theme='outline' size={collapsed ? '20' : '16'} fill='currentColor' />
        </span>
        {!collapsed && <span className='text-t-primary text-14px font-[500] leading-24px'>{label}</span>}
      </div>
    </Tooltip>
  );
};

export default SiderCreationEntry;
