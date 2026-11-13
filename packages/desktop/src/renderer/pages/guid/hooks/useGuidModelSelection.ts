import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { getAvailableModels, hasAvailableModels } from '../utils/modelUtils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Build a unique key for a provider/model pair.
 */
const buildModelKey = (providerId?: string, modelName?: string) => {
  if (!providerId || !modelName) return null;
  return `${providerId}:${modelName}`;
};

/**
 * Check if a model key still exists in the provider list.
 */
const isModelKeyAvailable = (key: string | null, providers?: IProvider[]) => {
  if (!key || !providers || providers.length === 0) return false;
  return providers.some((provider) => {
    if (!provider.id || !provider.models?.length) return false;
    return provider.models.some((modelName) => buildModelKey(provider.id, modelName) === key);
  });
};

/** Provider-based agent keys that share the model list UI */
type ProviderAgentKey = 'aionrs';

export type GuidModelSelectionResult = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  formatGeminiModelLabel: (provider: { platform?: string } | undefined, modelName?: string) => string;
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (
    model_info: TProviderWithModel,
    options?: { persistPreference?: boolean; automatic?: boolean }
  ) => Promise<void>;
  resetCurrentModel: (options?: { persistPreference?: boolean }) => Promise<void>;
};

/**
 * Hook that manages the provider-backed model selection state for the Guid page.
 * Assistant-driven defaults are applied by the caller; this hook only owns the
 * transient in-page selection.
 * @param agentKey - current provider-based agent (currently only 'aionrs')
 */
export const useGuidModelSelection = (agentKey: ProviderAgentKey = 'aionrs'): GuidModelSelectionResult => {
  const cloud = useOptionalCloudAccount();
  const explicitRequired = useRef(false);
  const selectedProtocol = useRef<string | undefined>(undefined);
  const selectedScope = useRef<string | undefined>(undefined);
  const { isGoogleAuth } = useGoogleAuthModels();
  const { data: modelConfig } = useProvidersQuery();

  const modelList = useMemo(() => {
    const allProviders: IProvider[] = (modelConfig || []).filter(
      (platform) =>
        !!platform.models.length &&
        (platform.managed_by !== 'cloud_account' ||
          (platform.enabled !== false && cloud?.session?.state === 'connected'))
    );
    return allProviders.filter(hasAvailableModels);
  }, [modelConfig, cloud?.session?.state]);

  const formatGeminiModelLabel = useCallback((_provider: { platform?: string } | undefined, modelName?: string) => {
    if (!modelName) return '';
    return modelName;
  }, []);

  const [current_model, _setCurrentModel] = useState<TProviderWithModel>();
  const selectedModelKeyRef = useRef<string | null>(null);

  const setCurrentModel = useCallback(
    async (model_info: TProviderWithModel, options?: { persistPreference?: boolean; automatic?: boolean }) => {
      if (options?.automatic && (explicitRequired.current || model_info.managed_by === 'cloud_account')) return;
      if (
        model_info.managed_by === 'cloud_account' &&
        (cloud?.session?.state !== 'connected' ||
          !modelList.some((p) => p.id === model_info.id && getAvailableModels(p).includes(model_info.use_model)))
      )
        return;
      explicitRequired.current = false;
      selectedProtocol.current = model_info.model_settings?.[model_info.use_model]?.openai_api_mode;
      selectedScope.current = cloud?.scope;
      selectedModelKeyRef.current = buildModelKey(model_info.id, model_info.use_model);
      _setCurrentModel(model_info);
    },
    [cloud?.scope, cloud?.session?.state, modelList]
  );

  const resetCurrentModel = useCallback(
    async (options?: { persistPreference?: boolean }) => {
      if (!modelList || modelList.length === 0) {
        return;
      }

      selectedModelKeyRef.current = null;

      if (explicitRequired.current) return;
      const defaultModel = modelList.find((provider) => provider.managed_by !== 'cloud_account');
      const resolvedUseModel = defaultModel ? (getAvailableModels(defaultModel)[0] ?? '') : '';

      if (!defaultModel || !resolvedUseModel) return;

      await setCurrentModel(
        {
          ...defaultModel,
          use_model: resolvedUseModel,
        },
        options
      );
    },
    [modelList, setCurrentModel]
  );

  // Set default model when modelList or agent changes
  useEffect(() => {
    const setDefaultModel = async () => {
      if (
        current_model?.managed_by === 'cloud_account' &&
        (cloud?.scope !== selectedScope.current ||
          !modelList.some(
            (p) =>
              p.id === current_model.id &&
              getAvailableModels(p).includes(current_model.use_model) &&
              p.model_settings?.[current_model.use_model]?.openai_api_mode === selectedProtocol.current
          ))
      ) {
        explicitRequired.current = true;
        selectedModelKeyRef.current = null;
        _setCurrentModel(undefined);
        return;
      }
      if (explicitRequired.current || !modelList || modelList.length === 0) return;
      const currentKey = selectedModelKeyRef.current || buildModelKey(current_model?.id, current_model?.use_model);
      if (isModelKeyAvailable(currentKey, modelList)) {
        if (!selectedModelKeyRef.current && currentKey) {
          selectedModelKeyRef.current = currentKey;
        }
        return;
      }
      await resetCurrentModel();
    };

    setDefaultModel().catch((error) => {
      console.error('Failed to set default model:', error);
    });
  }, [agentKey, cloud?.scope, current_model, modelList, resetCurrentModel]);
  return {
    modelList,
    isGoogleAuth,
    formatGeminiModelLabel,
    current_model:
      current_model?.managed_by === 'cloud_account' &&
      (selectedScope.current !== cloud?.scope ||
        !modelList.some(
          (p) =>
            p.id === current_model.id &&
            getAvailableModels(p).includes(current_model.use_model) &&
            p.model_settings?.[current_model.use_model]?.openai_api_mode === selectedProtocol.current
        ))
        ? undefined
        : current_model,
    setCurrentModel,
    resetCurrentModel,
  };
};
