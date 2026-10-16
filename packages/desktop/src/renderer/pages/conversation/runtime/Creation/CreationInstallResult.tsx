import React, { useState } from 'react';
import useSWR from 'swr';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { h3JobApi } from '@/common/chat/document/h3JobApi';
import type { CreationInstallConsent } from '@/common/chat/document/creation/operation';
import H3EnvironmentContent from '@/renderer/components/settings/SettingsModal/contents/H3EnvironmentContent';
import { H3ToolResult } from '../../Messages/components/H3ToolResults';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';

export default function CreationInstallResult({ id, conversationId }: { id: string; conversationId: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const runtime = useConversationRuntimeView(conversationId);
  const { isProcessing } = runtime;
  const {
    data: operation,
    error: unavailable,
    mutate,
  } = useSWR(['creation.operation', id], () => h3JobApi.creationOperation(id), {
    refreshInterval: (data) => (data && ['submitted', 'cancelled'].includes(data.state) ? 0 : 1500),
  });
  const { data: setup } = useSWR(
    operation?.state === 'installing' ? 'creation.install-progress' : null,
    () => h3JobApi.setup(),
    { refreshInterval: 1500 }
  );
  // Copied tool output cannot authorize a request belonging to another conversation.
  if (operation && operation.conversationId !== conversationId) return null;
  if (operation?.state === 'submitted' && operation.jobId) return <H3ToolResult id={operation.jobId} />;
  const continueWithLlm = async () => {
    runtime.markSendStarted();
    try {
      const result = await ipcBridge.conversation.sendMessage.invoke({
        conversation_id: conversationId,
        input: t('guid.creation.install.continueRequest', { id }),
      });
      runtime.markSendAccepted(result.turn_id, result.runtime, result.msg_id);
    } catch (cause) {
      runtime.markSendFailed({ kind: 'ordinary', reason: cause instanceof Error ? cause.message : String(cause) });
      throw cause;
    }
    setVisible(false);
    await mutate();
  };
  const authorize = async (consent: CreationInstallConsent) => {
    await h3JobApi.authorizeCreation(id, conversationId, consent);
    await continueWithLlm();
  };
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const canAuthorize = operation && ['awaiting-consent', 'paused', 'failed'].includes(operation.state);
  return (
    <div className='mt-12px p-12px rd-12px border border-3 space-y-8px' data-testid='creation-install-result'>
      <div className='flex items-center justify-between gap-12px'>
        <span role='status'>
          {t('guid.creation.install.title')} ·{' '}
          {operation ? t(`guid.creation.install.states.${operation.state}`) : t('conversation.h3Activity.loading')}
        </span>
        {operation && operation.state !== 'cancelled' && (
          <Button size='small' loading={busy} onClick={() => void perform(() => h3JobApi.cancelCreation(id))}>
            {t('guid.creation.install.cancelRequest')}
          </Button>
        )}
      </div>
      {operation && <p className='m-0 text-t-secondary break-words'>{operation.spec.prompt}</p>}
      {setup && setup.phase !== 'idle' && (
        <p role='status'>
          {t(`settings.h3Setup.${setup.phase === 'installing-acceleration' ? 'installingAcceleration' : setup.phase}`)}
          {setup.filename ? ` · ${setup.filename}` : ''}
        </p>
      )}
      {setup?.totalBytes && (
        <progress
          className='w-full'
          max={setup.totalBytes}
          value={setup.bytes ?? 0}
          aria-label={t('settings.h3Setup.progress')}
        />
      )}
      {(error || operation?.error || unavailable) && (
        <p role='alert'>{error || operation?.error || t('settings.h3Setup.serviceUnavailable')}</p>
      )}
      {canAuthorize && (
        <Button type='primary' disabled={isProcessing || busy} onClick={() => setVisible(true)}>
          {t('guid.creation.install.open')}
        </Button>
      )}
      {operation?.state === 'authorized' && (
        <Button type='primary' disabled={isProcessing} loading={busy} onClick={() => void perform(continueWithLlm)}>
          {t('guid.creation.install.continue')}
        </Button>
      )}
      <Modal
        visible={visible}
        title={t('guid.creation.install.title')}
        footer={null}
        onCancel={() => setVisible(false)}
        unmountOnExit
      >
        <H3EnvironmentContent onInstall={authorize} />
      </Modal>
    </div>
  );
}
