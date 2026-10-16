import React, { useState } from 'react';
import { Alert, Button, Form, Input, Message, Modal, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { CLOUD_IMAGE_PRESETS } from '@/common/chat/document/creation/cloudModels';
import type { CreationModel } from '@/common/chat/document/creation/creation';
import type { IProvider } from '@/common/config/storage';
import { isImageGenSupported } from '@/common/utils/imageModelAllowlist';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';

type Props = { model: CreationModel; onClose: () => void; onSaved: (id: string) => void };

export default function CloudModelSetup({ model, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, mutate } = useProvidersQuery();
  const initial = CLOUD_IMAGE_PRESETS.find((preset) => preset.id === model.presetId) ?? CLOUD_IMAGE_PRESETS[0];
  const [presetId, setPresetId] = useState<string>(model.provider ? 'custom' : initial.id);
  const [name, setName] = useState<string>(model.provider?.name ?? initial.name);
  const [platform, setPlatform] = useState<string>(model.provider?.platform ?? initial.platform);
  const [baseUrl, setBaseUrl] = useState<string>(model.provider?.base_url ?? initial.base_url);
  const [modelName, setModelName] = useState<string>(model.provider?.use_model ?? initial.model);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, contextHolder] = Message.useMessage();
  const choosePreset = (id: string) => {
    setPresetId(id);
    setApiKey('');
    const preset = CLOUD_IMAGE_PRESETS.find((item) => item.id === id);
    setName(preset?.name ?? '');
    setPlatform(preset?.platform ?? 'openai');
    setBaseUrl(preset?.base_url ?? '');
    setModelName(preset?.model ?? 'gpt-image-2.5-all');
  };
  const save = async () => {
    const existing =
      presetId === 'custom' && model.provider
        ? (data ?? []).find((provider) => provider.id === model.provider?.id)
        : (data ?? []).find(
            (provider) =>
              provider.platform === platform &&
              provider.base_url.replace(/\/+$/, '') === baseUrl.trim().replace(/\/+$/, '')
          );
    const sameEndpoint =
      existing?.platform === platform && existing.base_url.replace(/\/+$/, '') === baseUrl.trim().replace(/\/+$/, '');
    const key = apiKey.trim() || (sameEndpoint ? existing.api_key : '') || '';
    try {
      if (!name.trim() || !modelName.trim() || !key) throw new Error('invalid');
      if (baseUrl.trim() && !['http:', 'https:'].includes(new URL(baseUrl.trim()).protocol)) throw new Error('invalid');
      if (!baseUrl.trim() && platform !== 'gemini') throw new Error('invalid');
      if (!isImageGenSupported({ platform, base_url: baseUrl.trim(), name }, modelName.trim()))
        throw new Error('invalid');
    } catch {
      message.error(t('guid.creation.cloudSetup.invalid'));
      return;
    }
    setSaving(true);
    try {
      const values = {
        name: name.trim(),
        platform,
        base_url: baseUrl.trim().replace(/\/+$/, ''),
        api_key: key,
        models: [...new Set([...(existing?.models ?? []), modelName.trim()])],
        enabled: true,
        model_enabled: { ...existing?.model_enabled, [modelName.trim()]: true },
      };
      const saved: IProvider = existing
        ? await ipcBridge.mode.updateProvider.invoke({ id: existing.id, ...values })
        : await ipcBridge.mode.createProvider.invoke(values);
      await mutate((providers) => [...(providers ?? []).filter((provider) => provider.id !== saved.id), saved], false);
      setApiKey('');
      onSaved(`${saved.id}::${modelName.trim()}`);
    } catch {
      message.error(t('guid.creation.cloudSetup.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      visible
      title={t('guid.creation.configureCloud')}
      onCancel={onClose}
      onOk={() => void save()}
      okText={t('common.save')}
      confirmLoading={saving}
      style={{ width: 520, maxWidth: 'calc(100vw - 32px)' }}
    >
      {contextHolder}
      <Alert type='info' content={t('guid.creation.cloudSetup.hint')} className='mb-16px' />
      <Form layout='vertical'>
        <Form.Item label={t('guid.creation.cloudSetup.catalog')}>
          <Select
            aria-label={t('guid.creation.cloudSetup.catalog')}
            value={presetId}
            onChange={choosePreset}
            options={[
              ...CLOUD_IMAGE_PRESETS.map((preset) => ({ value: preset.id, label: `${preset.name} · ${preset.model}` })),
              { value: 'custom', label: t('guid.creation.cloudSetup.custom') },
            ]}
          />
        </Form.Item>
        <Form.Item label={t('guid.creation.cloudSetup.provider')}>
          <Input aria-label={t('guid.creation.cloudSetup.provider')} value={name} onChange={setName} />
        </Form.Item>
        <Form.Item label={t('guid.creation.cloudSetup.baseUrl')}>
          <Input aria-label={t('guid.creation.cloudSetup.baseUrl')} value={baseUrl} onChange={setBaseUrl} />
        </Form.Item>
        <Form.Item label={t('guid.creation.model')}>
          <Input aria-label={t('guid.creation.model')} value={modelName} onChange={setModelName} />
        </Form.Item>
        <Form.Item label={t('settings.apiKey')}>
          <Input.Password
            aria-label={t('settings.apiKey')}
            value={apiKey}
            onChange={setApiKey}
            autoComplete='new-password'
            placeholder={t('guid.creation.cloudSetup.keyHint')}
          />
        </Form.Item>
      </Form>
      <Button
        type='text'
        onClick={() => {
          onClose();
          navigate('/settings/model');
        }}
      >
        {t('guid.creation.cloudSetup.advanced')}
      </Button>
    </Modal>
  );
}
