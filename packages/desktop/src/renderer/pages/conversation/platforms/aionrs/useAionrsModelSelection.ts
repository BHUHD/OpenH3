/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useModelProviderList, useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AionrsModelSelection = {
  current_model?: TProviderWithModel;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
  getDisplayModelName: (modelName?: string) => string;
};

export type UseAionrsModelSelectionOptions = {
  initialModel: TProviderWithModel | undefined;
  onSelectModel: (provider: IProvider, modelName: string) => Promise<boolean>;
};

export const useAionrsModelSelection = ({
  initialModel,
  onSelectModel,
}: UseAionrsModelSelectionOptions): AionrsModelSelection => {
  const cloud = useOptionalCloudAccount();
  const [storedModel, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [initialModel?.id, initialModel?.use_model]);

  const { providers: allProviders, getAvailableModels, formatModelLabel } = useModelProviderList();
  const { data: configuredProviders } = useProvidersQuery();
  // Conversation rehydration deliberately contains only provider ID + model.
  // Resolve management from the same providers SWR key, including tombstones,
  // and retain that classification for this selection when logout clears cache.
  const managedSelection = useRef<string | undefined>(undefined);
  if (
    storedModel &&
    (storedModel.managed_by === 'cloud_account' ||
      configuredProviders?.some(
        (provider) => provider.id === storedModel.id && provider.managed_by === 'cloud_account'
      ))
  )
    managedSelection.current = storedModel.id;

  // AionCore does not support Google Auth — filter it out
  const providers = useMemo(
    () => allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth')),
    [allProviders]
  );

  const observedProtocol = useRef<{ key: string; protocol?: string } | undefined>(undefined);
  const selectedKey = storedModel ? `${storedModel.id}:${storedModel.use_model}` : '';
  const actualProvider = configuredProviders?.find((provider) => provider.id === storedModel?.id);
  const protocol = storedModel ? actualProvider?.model_settings?.[storedModel.use_model]?.openai_api_mode : undefined;
  if (observedProtocol.current?.key !== selectedKey)
    observedProtocol.current = {
      key: selectedKey,
      protocol: storedModel?.model_settings?.[storedModel.use_model]?.openai_api_mode ?? protocol,
    };
  if (!observedProtocol.current.protocol && protocol) observedProtocol.current.protocol = protocol;
  const protocolChanged =
    !!observedProtocol.current.protocol && !!protocol && observedProtocol.current.protocol !== protocol;
  const current_model =
    storedModel &&
    managedSelection.current === storedModel.id &&
    cloud &&
    (protocolChanged ||
      cloud.session?.state !== 'connected' ||
      !providers.some(
        (provider) => provider.id === storedModel.id && getAvailableModels(provider).includes(storedModel.use_model)
      ))
      ? undefined
      : storedModel;
  useEffect(() => {
    if (cloud?.session?.state === 'connected' && configuredProviders === undefined) return;
    if (storedModel && managedSelection.current === storedModel.id && cloud && !current_model)
      setCurrentModel(undefined);
  }, [cloud?.session, current_model, storedModel, configuredProviders]);

  const selectionAuthority = useRef({ scope: cloud?.scope, providers });
  selectionAuthority.current = { scope: cloud?.scope, providers };
  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      const scope = cloud?.scope;
      if (
        provider.managed_by === 'cloud_account' &&
        (cloud?.session?.state !== 'connected' ||
          !providers.some((p) => p.id === provider.id && getAvailableModels(p).includes(modelName)))
      )
        return;
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        use_model: modelName,
      } as TProviderWithModel;
      const ok = await onSelectModel(provider, modelName);
      if (
        ok &&
        (provider.managed_by !== 'cloud_account' ||
          (selectionAuthority.current.scope === scope &&
            selectionAuthority.current.providers.some(
              (p) => p.id === provider.id && getAvailableModels(p).includes(modelName)
            )))
      ) {
        observedProtocol.current = {
          key: `${provider.id}:${modelName}`,
          protocol: provider.model_settings?.[modelName]?.openai_api_mode,
        };
        setCurrentModel(selected);
      }
    },
    [onSelectModel, cloud?.scope, cloud?.session?.state, providers, getAvailableModels]
  );

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(current_model, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [current_model, formatModelLabel]
  );

  return {
    current_model,
    providers,
    getAvailableModels,
    handleSelectModel,
    getDisplayModelName,
  };
};
