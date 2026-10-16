import React, { useState } from 'react';
import useSWR from 'swr';
import { Button, Collapse, Progress } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { comfyApi } from '@/common/chat/document/creation/comfyApi';
import type { ComfyGenerationJob } from '@/common/chat/document/creation/comfy';
import { toolResultRecords } from '@/common/chat/document/creation/toolResults';

const isActive = (job: ComfyGenerationJob) => ['queued', 'running'].includes(job.status);

export function comfyJobIds(messages: Array<{ type: string; content: unknown }>): string[] {
  return [
    ...new Set(
      messages
        .flatMap(toolResultRecords)
        .map((record) => record.comfyJobId)
        .filter(
          (id): id is string =>
            typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
        )
    ),
  ];
}

export default function ComfyGenerationResult({ id, conversationId }: { id: string; conversationId: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const {
    data: job,
    error: unavailable,
    mutate,
  } = useSWR<ComfyGenerationJob>(['comfy.job', conversationId, id], () => comfyApi.job(id, conversationId), {
    refreshInterval: (data) => (data && !isActive(data) ? 0 : 1500),
    errorRetryInterval: 1500,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      await mutate(await comfyApi.cancelJob(id, conversationId), { revalidate: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const active = job && isActive(job);
  const diagnosticLogPath = (job as (ComfyGenerationJob & { diagnosticLogPath?: string }) | undefined)
    ?.diagnosticLogPath;
  return (
    <div className='mt-12px p-12px rd-12px border border-3 space-y-8px' data-testid='comfy-generation-result'>
      <div className='flex items-center justify-between gap-12px'>
        <span role='status'>
          {t('guid.comfy.generation.title')} ·{' '}
          {unavailable
            ? t('guid.comfy.generation.unavailable')
            : job
              ? t(`guid.comfy.generation.states.${job.status}`)
              : t('conversation.h3Activity.loading')}
        </span>
        {active && (
          <Button size='small' loading={busy} onClick={() => void cancel()}>
            {t('guid.comfy.generation.cancel')}
          </Button>
        )}
      </div>
      {active && <Progress percent={job.progress} />}
      {job?.error && <p role='alert'>{job.error}</p>}
      {job?.diagnosis && (
        <p className='text-12px text-t-secondary break-words'>
          {job.diagnosis.category}
          {job.diagnosis.nodeId ? ` · ${job.diagnosis.nodeId}` : ''} · {job.diagnosis.action}
        </p>
      )}
      {job?.submissionUncertain && <p role='alert'>{t('guid.comfy.generation.submissionUncertain')}</p>}
      {diagnosticLogPath && (
        <Collapse bordered={false} className='bg-transparent'>
          <Collapse.Item name='diagnostic-log' header={t('guid.comfy.diagnosticLog')}>
            <code className='break-all'>{diagnosticLogPath}</code>
          </Collapse.Item>
        </Collapse>
      )}
      {job?.adjustments?.map((adjustment, index) => (
        <div key={index} className='text-12px text-t-secondary'>
          <p>{t('guid.comfy.generation.adjusted')}</p>
          <p>{adjustment.reason}</p>
          <Collapse bordered={false} className='bg-transparent'>
            <Collapse.Item name='actual-input' header={t('guid.comfy.generation.actualInput')}>
              <pre className='whitespace-pre-wrap break-words'>{JSON.stringify(adjustment.input, null, 2)}</pre>
            </Collapse.Item>
          </Collapse>
        </div>
      ))}
      {(error || unavailable) && <p role='alert'>{error || t('guid.comfy.generation.unavailable')}</p>}
      {job?.artifacts.map((artifact, index) => {
        const src = comfyApi.jobArtifactUrl(id, index, conversationId);
        if (artifact.mimeType.startsWith('image/'))
          return (
            <img
              key={`${id}-${index}`}
              src={src}
              alt={t('guid.comfy.generation.artifact', { index: index + 1 })}
              className='block max-w-full max-h-500px rounded'
            />
          );
        if (artifact.mimeType.startsWith('video/'))
          return (
            <video
              key={`${id}-${index}`}
              controls
              preload='metadata'
              src={src}
              aria-label={t('guid.comfy.generation.artifact', { index: index + 1 })}
              className='block max-w-full max-h-500px rounded'
            />
          );
        return null;
      })}
    </div>
  );
}

export function comfyGenerationTurnResults(
  items: Array<{ id: string; type: string; position?: string; messages?: Array<{ type: string; content: unknown }> }>
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  let ids: string[] = [];
  let anchor: string | undefined;
  const flush = () => {
    if (anchor && ids.length) groups.set(anchor, ids);
    ids = [];
    anchor = undefined;
  };
  for (const item of items) {
    if (item.position === 'right') {
      flush();
      continue;
    }
    anchor = item.id;
    for (const id of comfyJobIds(item.messages ?? []))
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
  }
  flush();
  return groups;
}
