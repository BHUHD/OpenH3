import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, InputNumber, Slider, Tooltip, Select } from '@arco-design/web-react';
import { Add, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { chatFileRefKey, type ChatFileRef } from '@/common/types/chatFile';
import { buildVideoDraft } from '@/common/chat/document/videoDraft';
import { mediaJobApi } from '@/common/chat/document/mediaJobApi';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { registerTabReloader } from '../../context/tabReloaderRegistry';
import { usePreviewContextOptional } from '../../context/PreviewContext';
import styles from './Video.module.css';
import H3GenerationPanel from './H3GenerationPanel';

type Props = { fileRef?: ChatFileRef; conversationId?: string; tabId?: string; onAdded?: () => void };

/** Remount on identity changes so selection state cannot leak across files. */
export default function VideoViewer(props: Props) {
  const identity = props.fileRef ? chatFileRefKey(props.fileRef) : 'missing';
  const fileRef = useMemo(() => (props.fileRef ? { ...props.fileRef } : undefined), [identity]);
  return <VideoContent key={`${identity}:${props.conversationId ?? ''}`} {...props} fileRef={fileRef} />;
}

function VideoContent({ fileRef, conversationId, tabId, onAdded }: Props) {
  const { t } = useTranslation();
  const previewContext = usePreviewContextOptional();
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectionPlayback = useRef(false);
  const epoch = useRef(0);
  const [reload, setReload] = useState(0);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [snapshot, setSnapshot] = useState<{ lastModified: number; size: number } | null>(null);
  const [error, setError] = useState<'loadFailed' | 'sourceChanged' | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ id: string; status: string; progress: number; outputPath?: string } | null>(null);
  const [jobKind, setJobKind] = useState<'extract-frame' | 'transcode'>('extract-frame');
  const valid = Boolean(
    fileRef &&
    conversationId &&
    snapshot &&
    !error &&
    duration > 0 &&
    range[0] >= 0 &&
    range[0] < range[1] &&
    range[1] <= duration
  );

  useEffect(() => {
    const current = ++epoch.current;
    setSnapshot(null);
    setDuration(0);
    setRange([0, 0]);
    setError(null);
    setBusy(false);
    if (fileRef)
      void ipcBridge.fs.getContentMetadata
        .invoke({ file: fileRef })
        .then((metadata) => {
          if (current === epoch.current) setSnapshot({ lastModified: metadata.lastModified, size: metadata.size });
        })
        .catch(() => {
          if (current === epoch.current) setError('loadFailed');
        });
    return () => {
      epoch.current++;
    };
  }, [fileRef, reload]);

  useEffect(() => {
    if (!tabId) return;
    return registerTabReloader(tabId, () => setReload((value) => value + 1));
  }, [tabId]);

  const addSelection = async (): Promise<void> => {
    if (!valid || !fileRef || !conversationId || !snapshot || busy) return;
    const current = epoch.current;
    setBusy(true);
    try {
      const latest = await ipcBridge.fs.getContentMetadata.invoke({ file: fileRef });
      if (current !== epoch.current) return;
      if (latest.lastModified !== snapshot.lastModified || latest.size !== snapshot.size) {
        setError('sourceChanged');
        return;
      }
      const draft = buildVideoDraft(fileRef, {
        startSeconds: range[0],
        endSeconds: range[1],
        durationSeconds: duration,
        lastModified: snapshot.lastModified,
      });
      requestConversationSendBoxPrefill(conversationId, draft.prompt, draft.files);
      onAdded?.();
    } catch {
      if (current === epoch.current) setError('loadFailed');
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };

  const analyzeVideo = async (): Promise<void> => {
    if (!fileRef || busy) return;
    setBusy(true);
    try {
      const sourcePath = fileRef.kind === 'upload' || fileRef.kind === 'local' ? fileRef.path : fileRef.relative_path;
      const outputPath = `${sourcePath}.${jobKind === 'extract-frame' ? 'frame.jpg' : 'transcoded.mp4'}`;
      const created = await mediaJobApi.create({ kind: jobKind, sourcePath, outputPath, ...(jobKind === 'extract-frame' ? { startSeconds: range[0] } : {}) });
      setJob(created);
      if (created.status === 'succeeded') return;
      let settled = false;
      const finish = (next: typeof created): void => {
        setJob(next);
        if (next.status === 'succeeded') previewContext?.openPreview('', jobKind === 'extract-frame' ? 'image' : 'video', { fileRef: { kind: 'local', path: outputPath }, title: outputPath.split(/[\\/]/).pop() ?? outputPath, file_name: outputPath.split(/[\\/]/).pop() ?? outputPath, editable: false });
        settled = ['succeeded', 'failed', 'cancelled'].includes(next.status);
      };
      const source = mediaJobApi.events(created.id, finish);
      for (let attempt = 0; attempt < 120 && !settled; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        if (!settled) finish(await mediaJobApi.get(created.id));
      }
      source.close();
      if (!settled) setError('loadFailed');
    } catch {
      setError('loadFailed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.viewer} aria-label={t('preview.video.title')}>
      <div className={styles.stage}>
        {fileRef && (
          <video
            key={reload}
            ref={videoRef}
            src={`${buildFileStreamUrl(fileRef)}&v=${reload}`}
            controls
            preload='metadata'
            className={styles.video}
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration;
              if (!Number.isFinite(seconds) || seconds <= 0) {
                setError('loadFailed');
                return;
              }
              setDuration(seconds);
              setRange([0, seconds]);
            }}
            onPause={() => {
              selectionPlayback.current = false;
            }}
            onTimeUpdate={() => {
              if (
                selectionPlayback.current &&
                videoRef.current &&
                !videoRef.current.paused &&
                videoRef.current.currentTime >= range[1] &&
                range[1] > 0
              )
                videoRef.current.pause();
            }}
            onError={() => setError('loadFailed')}
          />
        )}
      </div>
      <div className={styles.controls}>
        <H3GenerationPanel />
        {error && (
          <div role='alert' className={styles.error}>
            {t(`preview.video.${error}`)}
          </div>
        )}
        <div className={styles.processingRow}>
          <Select value={jobKind} disabled={busy} onChange={(value) => setJobKind(value as 'extract-frame' | 'transcode')} aria-label={t('preview.video.processType', { defaultValue: '处理类型' })}>
            <Select.Option value='extract-frame'>{t('preview.video.extractFrame', { defaultValue: '抽取画面' })}</Select.Option>
            <Select.Option value='transcode'>{t('preview.video.transcode', { defaultValue: '转码副本' })}</Select.Option>
          </Select>
          <Button disabled={!fileRef || busy} onClick={() => void analyzeVideo()}>{t('preview.video.process', { defaultValue: '开始处理' })}</Button>
          {busy && job && <Button onClick={() => void mediaJobApi.cancel(job.id)}>{t('common.cancel')}</Button>}
          {!busy && job?.status === 'failed' && <Button onClick={() => void analyzeVideo()}>{t('common.retry', { defaultValue: '重试' })}</Button>}
        </div>
        <Slider
          range
          min={0}
          max={duration || 1}
          step={0.01}
          value={range}
          disabled={!snapshot || !duration || Boolean(error) || busy}
          aria-label={t('preview.video.range')}
          onChange={(value) => {
            if (Array.isArray(value)) setRange([value[0], value[1]]);
          }}
        />
        <div className={styles.fields}>
          <label>
            {t('preview.video.start')}
            <InputNumber
              aria-label={t('preview.video.start')}
              min={0}
              max={duration}
              step={0.01}
              precision={2}
              value={range[0]}
              disabled={!duration || busy}
              onChange={(value) => setRange([value ?? 0, range[1]])}
            />
          </label>
          <label>
            {t('preview.video.end')}
            <InputNumber
              aria-label={t('preview.video.end')}
              min={0}
              max={duration}
              step={0.01}
              precision={2}
              value={range[1]}
              disabled={!duration || busy}
              onChange={(value) => setRange([range[0], value ?? 0])}
            />
          </label>
        </div>
        <div className={styles.actions}>
          <Button
            disabled={!valid || busy}
            onClick={() => {
              const video = videoRef.current;
              if (video) {
                selectionPlayback.current = true;
                video.currentTime = range[0];
                void video.play().catch(() => setError('loadFailed'));
              }
            }}
          >
            {t('preview.video.playSelection')}
          </Button>
          <Tooltip content={t('preview.refresh.tooltip')}>
            <Button
              aria-label={t('preview.refresh.label')}
              icon={<Refresh />}
              onClick={() => setReload((value) => value + 1)}
            />
          </Tooltip>
          <Button type='primary' icon={<Add />} disabled={!valid} loading={busy} onClick={() => void addSelection()}>
            {t('preview.addToChat')}
          </Button>
        </div>
        {job && <div role='status' className={styles.jobStatus}>{`${job.status} ${Math.round(job.progress * 100)}%`}</div>}
      </div>
    </section>
  );
}
