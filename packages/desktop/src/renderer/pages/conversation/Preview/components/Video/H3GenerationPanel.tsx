import { H3LiveProgress } from '@renderer/pages/conversation/Messages/components/H3ToolResults';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Select } from '@arco-design/web-react';
import { CloseSmall } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  inferH3Mode,
  type H3Job,
  type H3Reference,
  type H3RequestedMode,
  type H3Version,
} from '@/common/chat/document/h3Job';
import { ipcBridge } from '@/common';
import { H3ServiceError, h3JobApi } from '@/common/chat/document/h3JobApi';
import styles from './Video.module.css';

export default function H3GenerationPanel() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [megapixels, setMegapixels] = useState(0.2);
  const [job, setJob] = useState<H3Job | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<Awaited<ReturnType<typeof h3JobApi.status>> | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<H3RequestedMode>('auto');
  const [references, setReferences] = useState<H3Reference[]>([]);
  const [versions, setVersions] = useState<H3Version[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => () => sourceRef.current?.close(), []);

  useEffect(() => {
    let active = true;
    void h3JobApi
      .status()
      .then((next) => {
        if (active) setRuntimeStatus(next);
      })
      .catch(() => {
        if (active) setRuntimeStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshVersions = (): void => {
    void h3JobApi
      .versions()
      .then(setVersions)
      .catch(() => setVersions([]));
  };
  useEffect(refreshVersions, []);

  const finish = (next: H3Job): void => {
    setJob(next);
    if (next.diagnosis)
      setError(
        `${next.diagnosis.category}: ${next.diagnosis.action}${next.diagnosis.nodeId ? ` (node ${next.diagnosis.nodeId})` : ''}`
      );
    if (next.status === 'succeeded' && next.artifacts[0]?.resourcePath)
      setOutputUrl(h3JobApi.resourceUrl(next.artifacts[0].resourcePath));
    if (['succeeded', 'failed', 'cancelled'].includes(next.status)) sourceRef.current?.close();
  };

  const generate = async (): Promise<void> => {
    if (!prompt.trim()) return;
    setError(null);
    setOutputUrl(null);
    sourceRef.current?.close();
    try {
      const created = await h3JobApi.create({ prompt: prompt.trim(), durationSeconds, megapixels, mode, references });
      setJob(created);
      if (['succeeded', 'failed', 'cancelled'].includes(created.status)) {
        finish(created);
        return;
      }
      sourceRef.current = h3JobApi.events(created.id, finish);
    } catch (cause) {
      if (cause instanceof H3ServiceError && cause.diagnosis)
        setError(
          `${cause.diagnosis.category}: ${cause.diagnosis.action}${cause.diagnosis.nodeId ? ` (node ${cause.diagnosis.nodeId})` : ''}`
        );
      else setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chooseReferences = async (): Promise<void> => {
    const files = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images, videos, and audio',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'webp',
            'mp4',
            'mov',
            'webm',
            'mkv',
            'wav',
            'mp3',
            'flac',
            'm4a',
            'aac',
            'ogg',
          ],
        },
      ],
    });
    if (!files?.length) return;
    const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);
    const videoExtensions = new Set(['mp4', 'mov', 'webm', 'mkv']);
    const next = files.flatMap((file): H3Reference[] => {
      const extension = file.split('.').pop()?.toLowerCase() ?? '';
      const type = imageExtensions.has(extension) ? 'image' : videoExtensions.has(extension) ? 'video' : 'audio';
      return [{ type, path: file }];
    });
    setReferences((current) => [
      ...current,
      ...next.filter((item) => !current.some((value) => value.path === item.path)),
    ]);
  };

  const derive = async (version: H3Version): Promise<void> => {
    setError(null);
    setOutputUrl(null);
    sourceRef.current?.close();
    try {
      const created = await h3JobApi.deriveVersion(version.id, { prompt: prompt.trim() || undefined });
      setJob(created);
      refreshVersions();
      if (!['succeeded', 'failed', 'cancelled'].includes(created.status))
        sourceRef.current = h3JobApi.events(created.id, finish);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const selectVersion = async (version: H3Version): Promise<void> => {
    try {
      setVersions(await h3JobApi.selectVersion(version.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cancel = async (): Promise<void> => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    try {
      finish(await h3JobApi.cancel(job.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const busy = Boolean(job && ['queued', 'running'].includes(job.status));
  let inferredMode: H3Job['resolvedMode'] | null = null;
  try {
    inferredMode = inferH3Mode({ mode, references });
  } catch {
    inferredMode = null;
  }
  return (
    <section className={styles.h3Panel} aria-label={t('preview.video.h3Title', { defaultValue: 'MiniMax H3' })}>
      <div className={styles.h3Heading}>{t('preview.video.h3Title', { defaultValue: 'MiniMax H3 生成' })}</div>
      {runtimeStatus && (
        <div
          data-testid='h3-runtime-status'
          className={runtimeStatus.ready ? styles.runtimeReady : styles.runtimeMissing}
          aria-live='polite'
        >
          {runtimeStatus.ready
            ? t('preview.video.h3RuntimeReady', { defaultValue: 'H3 本地运行时已就绪' })
            : `${t('preview.video.h3RuntimeMissing', { defaultValue: 'H3 运行时未就绪' })}: ${[...runtimeStatus.install.missingAssets, ...runtimeStatus.install.missingCustomNodes].join(', ') || runtimeStatus.error || runtimeStatus.install.bundleRoot}`}
        </div>
      )}
      {runtimeStatus?.acceleration && (
        <div
          data-testid='h3-acceleration-status'
          className={runtimeStatus.acceleration.backend === 'sla' ? styles.runtimeReady : styles.runtimeMissing}
          aria-live='polite'
        >
          {`Attention: ${runtimeStatus.acceleration.backend}${runtimeStatus.acceleration.backend === 'dense' ? ` (${runtimeStatus.acceleration.reason})` : ''}`}
        </div>
      )}
      <Input.TextArea
        value={prompt}
        onChange={setPrompt}
        autoSize={{ minRows: 2, maxRows: 5 }}
        disabled={busy}
        aria-label={t('preview.video.h3Prompt', { defaultValue: 'H3 prompt' })}
        placeholder={t('preview.video.h3PromptPlaceholder', { defaultValue: '描述你要生成的视频' })}
      />
      <div className={styles.h3Options}>
        <label>
          {t('preview.video.h3Mode', { defaultValue: '生成模式' })}
          <Select value={mode} disabled={busy} onChange={(value) => setMode(value as H3RequestedMode)}>
            <Select.Option value='auto'>{t('preview.video.h3ModeAuto', { defaultValue: '自动识别' })}</Select.Option>
            <Select.Option value='t2v'>{t('preview.video.h3ModeT2v', { defaultValue: '文生视频' })}</Select.Option>
            <Select.Option value='fl2v'>{t('preview.video.h3ModeFl2v', { defaultValue: '图生视频' })}</Select.Option>
            <Select.Option value='ref2va'>
              {t('preview.video.h3ModeRef2va', { defaultValue: '多模态参考' })}
            </Select.Option>
          </Select>
        </label>
        <div className={styles.h3Route} data-testid='h3-resolved-mode'>
          {t('preview.video.h3ResolvedMode', { defaultValue: '当前路由' })}:{' '}
          {job?.resolvedMode ?? inferredMode ?? t('preview.video.h3RouteInvalid', { defaultValue: '素材不符合模式' })}
        </div>
      </div>
      <div className={styles.h3ReferenceRow}>
        <Button onClick={() => void chooseReferences()} disabled={busy}>
          {t('preview.video.h3ChooseReferences', { defaultValue: '添加参考素材' })}
        </Button>
        <span>
          {t('preview.video.h3ReferenceCount', { defaultValue: '{{count}} 个素材', count: references.length })}
        </span>
      </div>
      {references.length > 0 && (
        <div className={styles.h3ReferenceList}>
          {references.map((reference) => (
            <div className={styles.h3ReferenceItem} key={`${reference.type}:${reference.path}`}>
              <span title={reference.path}>
                {reference.type} · {reference.path.split(/[\\/]/).pop()}
              </span>
              <Button
                type='text'
                size='mini'
                icon={<CloseSmall />}
                disabled={busy}
                aria-label={t('preview.video.h3RemoveReference', { defaultValue: '移除参考素材' })}
                onClick={() => setReferences((current) => current.filter((item) => item.path !== reference.path))}
              />
            </div>
          ))}
        </div>
      )}
      <div className={styles.h3Options}>
        <label>
          {t('preview.video.h3Duration', { defaultValue: '时长' })}
          <InputNumber
            min={4}
            max={15}
            step={0.2}
            value={durationSeconds}
            disabled={busy}
            onChange={(value) => setDurationSeconds(value ?? 5)}
          />
        </label>
        <label>
          {t('preview.video.h3Quality', { defaultValue: '尺寸' })}
          <Select value={megapixels} disabled={busy} onChange={(value) => setMegapixels(Number(value))}>
            <Select.Option value={0.2}>{t('preview.video.h3QualityLow', { defaultValue: '低显存' })}</Select.Option>
            <Select.Option value={0.7}>{t('preview.video.h3QualityStandard', { defaultValue: '标准' })}</Select.Option>
          </Select>
        </label>
      </div>
      <div className={styles.processingRow}>
        <Button type='primary' disabled={!prompt.trim() || busy || !inferredMode} onClick={() => void generate()}>
          {t('preview.video.h3Generate', { defaultValue: '生成视频' })}
        </Button>
        {busy && <Button onClick={() => void cancel()}>{t('common.cancel')}</Button>}
      </div>
      {job && (
        <div className={styles.jobStatus}>
          <span role='status'>{t(`conversation.h3Activity.${job.status}`)}</span>
          {busy && <H3LiveProgress job={job} unavailable={false} />}
        </div>
      )}
      {versions.length > 0 && (
        <div className={styles.h3Versions} data-testid='h3-versions'>
          <div className={styles.h3Heading}>{t('preview.video.h3Versions', { defaultValue: '候选版本' })}</div>
          {versions.map((version) => (
            <div className={styles.h3Version} key={version.id}>
              <span>
                {version.label}
                {version.selected ? ` · ${t('preview.video.h3CurrentVersion', { defaultValue: '当前' })}` : ''}
              </span>
              <span className={styles.h3VersionActions}>
                <Button size='small' onClick={() => void selectVersion(version)} disabled={version.selected}>
                  {t('preview.video.h3SelectVersion', { defaultValue: '选择' })}
                </Button>
                <Button size='small' onClick={() => void derive(version)} disabled={busy}>
                  {t('preview.video.h3DeriveVersion', { defaultValue: '基于此版本迭代' })}
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div role='alert' className={styles.error}>
          {error}
        </div>
      )}
      {outputUrl && (
        <video data-testid='h3-output-video' className={styles.h3Output} src={outputUrl} controls preload='metadata' />
      )}
    </section>
  );
}
