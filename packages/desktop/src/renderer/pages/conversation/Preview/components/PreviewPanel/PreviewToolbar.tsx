/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { More, Refresh, Save, Code, PreviewOpen } from '@icon-park/react';
import styles from '@/renderer/components/files/FilePreview.module.css';
import { isElectronDesktop } from '@/renderer/utils/platform';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { shouldShowDownload } from './previewToolbarUtils';

/**
 * PreviewToolbar 组件属性
 * PreviewToolbar component props
 */
interface PreviewToolbarProps {
  /**
   * 内容类型
   * Content type
   */
  content_type: string;

  /**
   * 是否为 Markdown 文件
   * Whether it's a Markdown file
   */
  isMarkdown: boolean;

  /**
   * 是否为 HTML 文件
   * Whether it's an HTML file
   */
  isHTML: boolean;

  /**
   * 当前视图模式
   * Current view mode
   */
  viewMode: 'source' | 'preview';

  /**
   * 是否启用分屏模式
   * Whether split-screen mode is enabled
   */
  isSplitScreenEnabled: boolean;

  /**
   * 文件名
   * Filename
   */
  file_name?: string;
  fileTitle?: React.ReactNode;

  /**
   * 是否显示"在系统中打开"按钮
   * Whether to show "Open in System" button
   */
  showOpenInSystemButton: boolean;

  /**
   * 这个 tab 没有内容可操作（超过大小上限，或格式无法渲染）。
   * 视图切换、分屏、审查元素都是对内容的操作，隐藏；
   * 但「在系统中打开」与「下载」照常显示 —— 那是用户唯一的出路。
   *
   * The tab has no content to act on — either it exceeded the size ceiling or its
   * format cannot be rendered. View-mode switching, split screen and inspect all
   * operate on content, so they are hidden; "open in system" and "download" stay,
   * because they are the only way the user reaches the file.
   */
  hasNoRenderableContent?: boolean;

  /**
   * 文件是否在磁盘上（有 file_path）。
   * 刻意与 showOpenInSystemButton 分开传：后者现在也接受纯 fileRef（逃生出口），
   * 不再等价于「文件在磁盘上」，继续复用它会让 Explorer 打开的 code/md tab
   * 悄悄丢掉下载按钮。
   *
   * Whether the file exists on disk (has a file_path). Passed separately from
   * showOpenInSystemButton on purpose: that flag now also accepts a bare fileRef
   * (the escape hatch), so it no longer means "on disk". Reusing it here would
   * silently drop the download button from explorer-opened code/markdown tabs.
   */
  hasFilePath: boolean;

  /**
   * 刷新按钮状态 token；`'hidden'` 或未提供时不渲染。
   * Refresh control state token; not rendered when `'hidden'` or absent.
   */
  refreshState?: string;

  /** 刷新按钮是否可点 / Whether the refresh control accepts a click */
  refreshActionable?: boolean;

  /** 点击刷新 / Reload the current tab */
  onRefresh?: () => void;

  /**
   * 是否显示保存按钮（仅可编辑类型且有可渲染内容时）。
   * Whether to show the save button (only editable types with renderable content).
   */
  showSave?: boolean;

  /** 保存按钮是否可点（有未保存修改时）/ Whether the save control accepts a click (has unsaved edits) */
  saveActionable?: boolean;

  /** 点击保存 / Save the current tab */
  onSave?: () => void;

  /**
   * 设置视图模式
   * Set view mode
   */
  onViewModeChange: (mode: 'source' | 'preview') => void;

  /**
   * 设置分屏模式
   * Set split-screen mode
   */
  onSplitScreenToggle: () => void;

  /**
   * 在系统中打开文件
   * Open file in system
   */
  onOpenInSystem: () => void;

  /**
   * 下载文件
   * Download file
   */
  onDownload: () => void;

  /**
   * 关闭预览面板
   * Close preview panel
   */
  onClose: () => void;

  /**
   * HTML 审核元素模式（仅HTML类型使用）
   * HTML inspect mode (only for HTML type)
   */
  inspectMode?: boolean;

  /**
   * 切换HTML审核元素模式（仅HTML类型使用）
   * Toggle HTML inspect mode (only for HTML type)
   */
  onInspectModeToggle?: () => void;

  /**
   * 左侧额外渲染内容
   * Extra content rendered on the left section
   */
  leftExtra?: React.ReactNode;

  /**
   * 右侧额外渲染内容
   * Extra content rendered on the right section
   */
  rightExtra?: React.ReactNode;
}

/**
 * 预览面板工具栏组件
 * Preview panel toolbar component
 *
 * 包含文件名、视图模式切换、下载按钮、关闭按钮等
 * Contains filename, view mode toggle, download button, close button, etc.
 */
// eslint-disable-next-line max-len
const PreviewToolbar: React.FC<PreviewToolbarProps> = ({
  content_type,
  isMarkdown,
  isHTML,
  viewMode,
  isSplitScreenEnabled,
  file_name,
  fileTitle,
  showOpenInSystemButton,
  hasNoRenderableContent = false,
  hasFilePath,
  refreshState,
  refreshActionable = false,
  onRefresh,
  showSave = false,
  saveActionable = false,
  onSave,
  onViewModeChange,
  onSplitScreenToggle,
  onOpenInSystem,
  onDownload,
  inspectMode,
  onInspectModeToggle,
  leftExtra,
  rightExtra,
}) => {
  const { t } = useTranslation();
  const isDiff = content_type === 'diff';
  const switchable = (isMarkdown || isHTML || isDiff) && !hasNoRenderableContent;
  const refreshLabel =
    refreshState === 'updated'
      ? t('preview.refresh.hasUpdate')
      : refreshState === 'idle-no-signal'
        ? t('preview.refresh.noSignalSource')
        : refreshState === 'disabled'
          ? t('preview.refresh.unavailable')
          : t('preview.refresh.tooltip');
  return (
    <div className={styles.toolbar}>
      <div className={styles.title}>{fileTitle ?? <span title={file_name}>{file_name}</span>}</div>
      {switchable && (
        <Button.Group className='flex-shrink-0'>
          <Tooltip content={isHTML ? t('preview.code') : t('preview.source')}>
            <Button
              size='mini'
              type={viewMode === 'source' ? 'secondary' : 'text'}
              aria-label={t('preview.source')}
              aria-pressed={viewMode === 'source'}
              icon={<Code size={15} />}
              onClick={() => onViewModeChange('source')}
            />
          </Tooltip>
          <Tooltip content={t('preview.preview')}>
            <Button
              size='mini'
              type={viewMode === 'preview' ? 'secondary' : 'text'}
              aria-label={t('preview.preview')}
              aria-pressed={viewMode === 'preview'}
              icon={<PreviewOpen size={15} />}
              onClick={() => onViewModeChange('preview')}
            />
          </Tooltip>
        </Button.Group>
      )}
      <div className={styles.extras}>
        {leftExtra}
        {rightExtra}
      </div>
      <Dropdown
        trigger='click'
        position='br'
        droplist={
          <Menu selectable={false}>
            {showOpenInSystemButton && (
              <Menu.Item key='open' onClick={onOpenInSystem}>
                {t('preview.openInSystemApp')}
              </Menu.Item>
            )}
            {shouldShowDownload(content_type, hasFilePath) && (
              <Menu.Item key='download' onClick={onDownload}>
                {isElectronDesktop() ? t('preview.saveAs') : t('preview.downloadFile')}
              </Menu.Item>
            )}
            {switchable && !isDiff && (
              <Menu.Item key='split' onClick={onSplitScreenToggle}>
                {isSplitScreenEnabled ? t('preview.closeSplitScreen') : t('preview.openSplitScreen')}
              </Menu.Item>
            )}
            {isHTML && !hasNoRenderableContent && onInspectModeToggle && (
              <Menu.Item key='inspect' onClick={onInspectModeToggle}>
                {inspectMode ? t('preview.html.inspectElementDisable') : t('preview.html.inspectElementEnable')}
              </Menu.Item>
            )}
          </Menu>
        }
      >
        <Button type='text' size='mini' aria-label={t('common.more')} icon={<More size={16} />} />
      </Dropdown>
      <div className='flex items-center gap-2px flex-shrink-0'>
        {refreshState !== undefined && refreshState !== 'hidden' && (
          <Tooltip content={refreshLabel}>
            <Button
              type='text'
              size='mini'
              data-testid='preview-refresh'
              data-refresh-state={refreshState}
              aria-label={t('preview.refresh.label')}
              disabled={!refreshActionable}
              className={refreshState === 'updated' ? '!text-warning-6' : ''}
              icon={<Refresh size={15} />}
              onClick={onRefresh}
            />
          </Tooltip>
        )}
        {showSave && (
          <Tooltip content={saveActionable ? t('preview.save.tooltip') : t('preview.save.clean')}>
            <Button
              type='text'
              size='mini'
              data-testid='preview-save'
              aria-label={t('common.save')}
              disabled={!saveActionable}
              className={saveActionable ? '!text-warning-6' : '!cursor-not-allowed'}
              icon={<Save size={15} />}
              onClick={onSave}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default PreviewToolbar;
