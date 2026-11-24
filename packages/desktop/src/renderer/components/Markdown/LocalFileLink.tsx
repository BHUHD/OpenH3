/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useId, useState } from 'react';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Copy, Download } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useTranslation } from 'react-i18next';
import type { LocalFileLinkReference } from './markdownUtils';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { useRenderedMedia } from './RenderedMediaContext';
import FileTypeIcon from '@/renderer/pages/conversation/explorer/fileIcon/FileTypeIcon';
import { FileActions } from '../files/FileActions';

/** Command-produced edits are ordinary local files, not generation jobs. */
function LocalVideoPreview({ path, label }: { path: string; label: string }) {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState<{ width: number; height: number; duration: number }>();
  const [failed, setFailed] = useState(false);
  return (
    <span style={{ display: 'block', maxWidth: '100%' }}>
      <video
        src={buildFileStreamUrl({ kind: 'local', path })}
        aria-label={label}
        controls
        preload='metadata'
        onError={() => setFailed(true)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setFailed(false);
          setMetadata({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        }}
        style={{
          display: 'block',
          width: 'auto',
          height: 'auto',
          maxWidth: '100%',
          maxHeight: 'min(420px, 52dvh)',
          objectFit: 'contain',
          borderRadius: 8,
        }}
      />
      {failed ? (
        <span role='alert' style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('preview.video.loadFailed')}
        </span>
      ) : metadata ? (
        <span
          style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: 'var(--text-secondary)' }}
        >
          <span>
            {t('conversation.h3Activity.qualityLabel')} {metadata.width} × {metadata.height}
          </span>
          <span>
            {t('conversation.h3Activity.durationLabel')} {Number(metadata.duration.toFixed(2))} s
          </span>
        </span>
      ) : null}
    </span>
  );
}

type LocalFileLinkProps = {
  reference: LocalFileLinkReference;
  children?: React.ReactNode;
  onOpen?: (path: string, reference?: LocalFileLinkReference) => void | Promise<void>;
  standalone?: boolean;
};

const LocalFileLink: React.FC<LocalFileLinkProps> = ({ reference, children, onOpen, standalone }) => {
  const { t } = useTranslation();
  const renderedMedia = useRenderedMedia();
  const [saving, setSaving] = useState(false);
  const descriptionId = useId();
  const { filePath, line, rawReference } = reference;
  const fallbackLabel = filePath.split(/[\\/]/).pop() || filePath;
  const extension = /\.([^./\\]+)$/.exec(fallbackLabel)?.[1];
  const isVideo = /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(filePath);
  const isDocument = line == null && /\.(?:pdf|docx?|xlsx?|xlsm|csv|pptx?|md|markdown|zip)$/i.test(filePath);
  const label = isDocument ? fallbackLabel : children || fallbackLabel;
  const textLabel =
    React.Children.toArray(children)
      .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
      .join('')
      .trim() || fallbackLabel;
  const locationLabel =
    line == null
      ? null
      : `L${line}${reference.endLine == null ? (reference.column == null ? '' : `:${reference.column}`) : `-L${reference.endLine}`}`;
  const canOpen = Boolean(onOpen);
  const showVideo = line == null && isVideo && !renderedMedia?.contains(filePath);

  const handleOpen = useCallback(
    (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (onOpen) {
        void onOpen(filePath, reference);
      }
    },
    [filePath, onOpen, reference]
  );

  const handleCopy = useCallback(
    (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      copyText(rawReference).catch(() => {
        Message.error(t('common.copyFailed'));
      });
    },
    [rawReference, t]
  );

  const handleDownload = async (event: Event) => {
    event.stopPropagation();
    setSaving(true);
    try {
      await downloadFileFromRef({ kind: 'local', path: filePath }, fallbackLabel);
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const fileIcon = <FileTypeIcon node={{ name: fallbackLabel, relativePath: filePath, isFile: true }} />;
  const copyAction = (
    <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
      <Button
        aria-label={t('common.copy', { defaultValue: 'Copy' })}
        type='text'
        size='mini'
        className='markdown-local-file-copy !p-1px !w-20px !h-20px flex-shrink-0'
        icon={<Copy theme='outline' size='14' fill={iconColors.secondary} />}
        onClick={handleCopy}
      />
    </Tooltip>
  );
  const content = (
    <span className='inline-flex items-center gap-4px max-w-full'>
      {fileIcon}
      <span className='markdown-local-file-name'>{label}</span>
      {locationLabel && (
        <span className='flex-shrink-0 rd-4px bg-fill-2 px-4px text-12px font-mono text-t-secondary'>
          {locationLabel}
        </span>
      )}
    </span>
  );

  if (standalone && line == null && extension && !isVideo) {
    const downloadLabel = isElectronDesktop() ? t('preview.saveAs') : t('preview.downloadFile');
    const description = textLabel === fallbackLabel ? undefined : textLabel;
    const cardContent = (
      <>
        <span className='markdown-output-file-icon' aria-hidden>
          {fileIcon}
        </span>
        <span className='markdown-output-file-text'>
          <span className='markdown-output-file-name'>
            <span className='markdown-output-file-stem'>{fallbackLabel.slice(0, -(extension.length + 1))}</span>
            <span className='markdown-output-file-suffix'>.{extension}</span>
          </span>
          {description && (
            <span id={descriptionId} className='markdown-output-file-description'>
              {description}
            </span>
          )}
        </span>
      </>
    );
    return (
      <FileActions
        file={{ kind: 'local', path: filePath }}
        path={filePath}
        name={fallbackLabel}
        onOpen={onOpen ? () => onOpen(filePath, reference) : undefined}
        className='markdown-output-file'
        menuButtonClassName='markdown-output-file-menu'
      >
        {canOpen ? (
          <Button
            type='text'
            className='markdown-output-file-main'
            aria-label={fallbackLabel}
            aria-describedby={description ? descriptionId : undefined}
            title={filePath}
            onClick={handleOpen}
          >
            {cardContent}
          </Button>
        ) : (
          <span className='markdown-output-file-main' title={filePath}>
            {cardContent}
          </span>
        )}
        <Button
          type='text'
          className='markdown-output-file-download'
          aria-label={downloadLabel}
          aria-busy={saving}
          title={downloadLabel}
          loading={saving}
          icon={<Download size={16} aria-hidden />}
          onClick={(event) => void handleDownload(event)}
        />
      </FileActions>
    );
  }

  return (
    <FileActions
      file={{ kind: 'local', path: filePath }}
      path={filePath}
      name={fallbackLabel}
      onOpen={onOpen ? () => onOpen(filePath, reference) : undefined}
    >
      <span
        className='markdown-local-file inline-flex items-center gap-2px max-w-full align-baseline'
        style={
          showVideo
            ? {
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                maxWidth: 'min(100%, 640px)',
                verticalAlign: 'top',
              }
            : undefined
        }
        data-local-file-path={filePath}
        data-local-file-line={line}
        title={rawReference}
      >
        {showVideo && <LocalVideoPreview key={filePath} path={filePath} label={textLabel} />}
        <span className='inline-flex items-center gap-2px max-w-full'>
          {canOpen ? (
            <Button
              type='text'
              size='mini'
              aria-label={locationLabel ? `${textLabel} ${locationLabel}` : isDocument ? fallbackLabel : textLabel}
              title={isDocument ? `${textLabel}\n${filePath}` : rawReference}
              className='markdown-local-file-link !px-0 !py-0 !h-auto !leading-normal !align-baseline max-w-full'
              onClick={handleOpen}
            >
              {content}
            </Button>
          ) : (
            <span className='markdown-local-file-link inline-flex items-center gap-4px max-w-full'>{content}</span>
          )}
          {copyAction}
        </span>
      </span>
    </FileActions>
  );
};

export default LocalFileLink;
