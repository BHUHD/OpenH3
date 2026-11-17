import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Pagination, Spin } from '@arco-design/web-react';
import { ArrowLeft, FolderOpen, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { FileActions } from '@/renderer/components/files/FileActions';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { useLocalFilePreview } from '../../hooks/useLocalFilePreview';
import { registerTabReloader } from '../../context/tabReloaderRegistry';
import FileTypeIcon from '../../../explorer/fileIcon/FileTypeIcon';
import styles from './DirectoryPreview.module.css';

type Entry = Awaited<ReturnType<typeof ipcBridge.fs.getFilesByDir.invoke>>[number];
const PAGE_SIZE = 60;

/** Page large frame folders without reading image bytes or mounting every thumbnail. */
export default function DirectoryPreview({ path, tabId }: { path: string; tabId?: string }) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState(path);
  const [entries, setEntries] = useState<Entry[]>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const openFile = useLocalFilePreview(path, false);
  useEffect(() => {
    setDirectory(path);
  }, [path]);
  useEffect(() => {
    if (tabId) return registerTabReloader(tabId, () => setRevision((value) => value + 1));
  }, [tabId]);
  useEffect(() => {
    let active = true;
    setEntries(undefined);
    setFailed(false);
    setPage(1);
    setQuery('');
    void ipcBridge.fs.getFilesByDir
      .invoke({ dir: directory, root: path })
      .then((value) => {
        if (active) setEntries(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [directory, path, revision]);
  const filtered = useMemo(
    () => entries?.filter((entry) => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [],
    [entries, query]
  );
  const relative = directory
    .replace(/\\/g, '/')
    .slice(path.replace(/\\/g, '/').replace(/\/$/, '').length)
    .replace(/^\//, '');
  const navigate = (next: string) => {
    setDirectory(next);
    setPage(1);
  };
  return (
    <div className={styles.root}>
      <div className={styles.navigation}>
        <Button
          size='mini'
          type='text'
          icon={<ArrowLeft />}
          disabled={!relative}
          aria-label={t('preview.directory.up')}
          onClick={() => navigate(relative.includes('/') ? directory.replace(/[\\/][^\\/]+[\\/]?$/, '') : path)}
        />
        <Button size='mini' type='text' className='min-w-0 truncate' title={path} onClick={() => navigate(path)}>
          {path
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop() || path}
        </Button>
        <span className='truncate flex-1 text-t-secondary' title={relative}>
          {relative ? `/ ${relative}` : ''}
        </span>
        <Button
          size='mini'
          type='text'
          icon={<Refresh />}
          aria-label={t('preview.refresh.label')}
          onClick={() => setRevision((value) => value + 1)}
        />
      </div>
      <Input.Search
        className='mx-12px !w-auto'
        value={query}
        placeholder={t('preview.directory.search')}
        onChange={(value) => {
          setQuery(value);
          setPage(1);
        }}
      />
      <div className={styles.content}>
        {failed ? (
          <Empty description={t('preview.directory.loadFailed')} />
        ) : entries === undefined ? (
          <Spin />
        ) : !filtered.length ? (
          <Empty description={t('preview.directory.empty')} />
        ) : (
          <div className={styles.grid}>
            {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => {
              const file = { kind: 'local' as const, path: entry.fullPath };
              const open = () => (entry.isDir ? navigate(entry.fullPath) : void openFile(entry.fullPath));
              return (
                <FileActions
                  key={entry.fullPath}
                  file={file}
                  path={entry.fullPath}
                  name={entry.name}
                  directory={entry.isDir}
                  onOpen={open}
                >
                  <Button type='text' className={styles.entry} title={entry.name} onClick={open}>
                    <span className={styles.thumbnail}>
                      {entry.isDir ? (
                        <FolderOpen size={36} />
                      ) : /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(entry.name) ? (
                        <img src={buildFileStreamUrl(file)} alt='' loading='lazy' />
                      ) : (
                        <FileTypeIcon node={entry} />
                      )}
                    </span>
                    <span className={styles.name}>{entry.name}</span>
                  </Button>
                </FileActions>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <span>{t('preview.directory.entries', { count: filtered.length })}</span>
        <Pagination simple size='mini' current={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}
