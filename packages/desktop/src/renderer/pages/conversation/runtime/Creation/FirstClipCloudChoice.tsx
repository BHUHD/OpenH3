/**
 * @license
 * Copyright 2026 OpenH3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cold-start cloud alternative for a first-clip request whose managed local
 * runtime is not ready yet. Presentational only: the owning install card wires
 * `onChoose`, backend state and the resulting job.
 *
 * Compatibility is decided by the shared `firstClipCloudInput` contract (no
 * local references, no explicit megapixels, text-to-video mode, cloud-safe
 * seed). Incompatible requests show the reason and the manual path; nothing is
 * silently dropped. Only `vllm-h3` connections are offered because that adapter
 * is the one verified for prompt, duration and seed. The user must explicitly
 * submit, and the note names the endpoint that will receive the prompt.
 */

import { Button, Radio, Spin } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { firstClipCloudInput, type PublicVideoConnection } from '@/common/chat/document/creation/cloudVideo';
import { cloudVideoApi } from '@/common/chat/document/creation/cloudVideoApi';
import type { CreationOperation } from '@/common/chat/document/creation/operation';

export type FirstClipCloudChoiceProps = {
  operation: CreationOperation;
  /** Receives the chosen connection and the endpoint the user saw, so the
   * backend can reject a connection whose endpoint changed since display. */
  onChoose: (connectionId: string, endpoint: string) => Promise<void>;
  disabled?: boolean;
};

const KEY = 'conversation.firstClipCloud';

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; connections: PublicVideoConnection[] };

const FirstClipCloudChoice: React.FC<FirstClipCloudChoiceProps> = ({ operation, onChoose, disabled = false }) => {
  const { t } = useTranslation();
  const cloudInput = useMemo(() => firstClipCloudInput(operation.spec), [operation.spec]);
  const hasReferences = Boolean(operation.spec.references?.length || operation.spec.referenceImagePath);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

  useEffect(() => {
    // An incompatible request never needs the connection list.
    if (!cloudInput) return;
    let active = true;
    setLoad({ status: 'loading' });
    cloudVideoApi
      .connections()
      .then((list) => {
        if (!active) return;
        const compatible = list.filter((connection) => connection.protocol === 'vllm-h3');
        setLoad({ status: 'ready', connections: compatible });
        setSelectedId((current) =>
          current && compatible.some((connection) => connection.id === current) ? current : compatible[0]?.id
        );
      })
      .catch(() => {
        if (active) setLoad({ status: 'failed' });
      });
    return () => {
      active = false;
    };
  }, [cloudInput]);

  if (!cloudInput) {
    return (
      <div className='flex flex-col gap-4px py-8px' data-testid='first-clip-cloud-incompatible'>
        <p className='m-0 text-13px text-t-secondary'>
          {t(hasReferences ? `${KEY}.incompatibleRefs` : `${KEY}.incompatibleSettings`)}
        </p>
        <p className='m-0 text-12px text-t-tertiary'>{t(`${KEY}.manualPath`)}</p>
      </div>
    );
  }

  if (load.status === 'loading') {
    return (
      <div className='flex items-center gap-8px py-8px text-13px text-t-secondary' role='status'>
        <Spin size={14} />
        <span>{t(`${KEY}.loading`)}</span>
      </div>
    );
  }

  if (load.status === 'failed') {
    return (
      <p className='m-0 py-8px text-13px text-danger' role='alert'>
        {t(`${KEY}.loadError`)}
      </p>
    );
  }

  if (!load.connections.length) {
    return (
      <div className='flex flex-col gap-4px py-8px' data-testid='first-clip-cloud-incompatible'>
        <p className='m-0 text-13px text-t-secondary'>{t(`${KEY}.noCompatibleConnections`)}</p>
        <p className='m-0 text-12px text-t-tertiary'>{t(`${KEY}.manualPath`)}</p>
      </div>
    );
  }

  const selected = load.connections.find((connection) => connection.id === selectedId);
  const locked = disabled || submitting;

  const submit = async (): Promise<void> => {
    if (!selected) return;
    setSubmitFailed(false);
    setSubmitting(true);
    try {
      await onChoose(selected.id, selected.baseUrl);
    } catch {
      setSubmitFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className='flex flex-col gap-8px py-8px'
      data-testid='first-clip-cloud-choice'
      aria-label={t(`${KEY}.title`)}
    >
      <div className='flex flex-col gap-2px'>
        <p className='m-0 text-13px font-500 text-t-primary'>{t(`${KEY}.title`)}</p>
        <p className='m-0 text-12px text-t-secondary'>{t(`${KEY}.subtitle`)}</p>
      </div>
      <Radio.Group
        direction='vertical'
        value={selectedId}
        disabled={locked}
        onChange={(value: string) => setSelectedId(value)}
        aria-label={t(`${KEY}.title`)}
      >
        {load.connections.map((connection) => (
          <Radio key={connection.id} value={connection.id} data-testid={`first-clip-cloud-option-${connection.id}`}>
            <span className='inline-flex flex-col min-w-0 align-top'>
              <span className='text-13px text-t-primary truncate'>{connection.name}</span>
              <span className='text-12px text-t-secondary truncate'>
                {connection.model ? `${connection.model} · ${connection.baseUrl}` : connection.baseUrl}
              </span>
            </span>
          </Radio>
        ))}
      </Radio.Group>
      {selected && (
        <p className='m-0 text-12px text-t-secondary' data-testid='first-clip-cloud-destination'>
          {t(`${KEY}.destination`, { name: selected.name, endpoint: selected.baseUrl })}
        </p>
      )}
      {submitFailed && (
        <p className='m-0 text-12px text-danger' role='alert'>
          {t(`${KEY}.submitError`)}
        </p>
      )}
      <Button
        type='primary'
        size='small'
        className='self-start'
        disabled={!selected || disabled}
        loading={submitting}
        onClick={() => void submit()}
      >
        {t(`${KEY}.submit`)}
      </Button>
    </section>
  );
};

export default FirstClipCloudChoice;
