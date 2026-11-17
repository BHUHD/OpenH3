import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, FolderOpen, PreviewOpen } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ChatFileRef } from '@/common/types/chatFile';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { ContextActions, contextMenuKey, type ContextAction, type MenuPoint } from './ContextActions';

type FileActionsProps = {
  file: ChatFileRef;
  path?: string;
  name: string;
  directory?: boolean;
  onOpen?: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
};

/** File actions are shared by chat links, directory entries and preview titles. */
export function FileActions({ file, path, name, directory, onOpen, children, className }: FileActionsProps) {
  const { t } = useTranslation();
  const [point, setPoint] = useState<MenuPoint | null>(null);
  const [isDirectory, setDirectory] = useState(directory);
  const close = useCallback(() => setPoint(null), []);
  const identity = JSON.stringify(file);
  useEffect(() => {
    if (!point) return;
    if (directory !== undefined) {
      setDirectory(directory);
      return;
    }
    let active = true;
    setDirectory(undefined);
    void ipcBridge.fs.getContentMetadata
      .invoke({ file })
      .then((metadata) => {
        if (active) setDirectory(Boolean(metadata.isDirectory));
      })
      .catch(() => {
        if (active) setDirectory(undefined);
      });
    return () => {
      active = false;
    };
  }, [point, identity, directory]);
  const absolute = path ?? (file.kind !== 'project' ? file.path : undefined);
  const actions: ContextAction[] = [];
  if (onOpen) actions.push({ key: 'preview', label: t('preview.preview'), icon: <PreviewOpen />, run: onOpen });
  if (isElectronDesktop()) {
    actions.push({
      key: 'open',
      label: t('preview.openInSystemApp'),
      icon: <PreviewOpen />,
      disabled: isDirectory === undefined,
      run: async () => {
        if (isDirectory && absolute)
          await ipcBridge.shell.openFolderWith.invoke({ folder_path: absolute, tool: 'explorer' });
        else await ipcBridge.fs.openSystem.invoke({ file });
      },
    });
    actions.push({
      key: 'reveal',
      label: t('preview.openLocation'),
      icon: <FolderOpen />,
      run: async () => {
        if (absolute) await ipcBridge.shell.showItemInFolder.invoke(absolute);
        else if (file.kind === 'project')
          await ipcBridge.fs.reveal.invoke({ pe_id: file.pe_id, relative_path: file.relative_path });
      },
    });
  }
  if (absolute || isElectronDesktop())
    actions.push({
      key: 'copyPath',
      label: t('preview.copyPath'),
      icon: <Copy />,
      run: async () => {
        if (absolute) await copyText(absolute);
        else if (file.kind === 'project')
          await ipcBridge.fs.copyAbsolutePath.invoke({ pe_id: file.pe_id, relative_path: file.relative_path });
      },
    });
  if (file.kind === 'project')
    actions.push({
      key: 'copyRelativePath',
      label: t('preview.copyRelativePath'),
      run: () => copyText(file.relative_path),
    });
  if (/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(name))
    actions.push({
      key: 'copyImage',
      label: t('preview.copyImage'),
      icon: <Copy />,
      run: async () => {
        const response = await fetch(buildFileStreamUrl(file));
        if (!response.ok) throw new Error('Image unavailable');
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Image conversion failed'))), 'image/png')
        );
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      },
    });
  if (isDirectory === false)
    actions.push({
      key: 'download',
      label: isElectronDesktop() ? t('preview.saveAs') : t('preview.downloadFile'),
      icon: <Download />,
      run: () => downloadFileFromRef(file, name),
    });
  return (
    <span
      className={className}
      style={{ minWidth: 0 }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPoint({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => contextMenuKey(event, setPoint)}
    >
      {children}
      <ContextActions point={point} actions={actions} onClose={close} />
    </span>
  );
}
