/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  chatModelChoice,
  parseChatModelChoice,
  rememberChatModel,
  useRememberedChatModel,
  type ChatModelChoice,
} from '../utils/chatModelPreference';
import { getAvailableModels, hasAvailableModels } from '../utils/modelUtils';

type SelectOptions = { persistPreference?: boolean; automatic?: boolean; fixed?: boolean };
export type GuidModelSelectionResult = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  formatGeminiModelLabel: (provider: { platform?: string } | undefined, modelName?: string) => string;
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model: TProviderWithModel, options?: SelectOptions) => Promise<void>;
  resetCurrentModel: (options?: { persistPreference?: boolean }) => Promise<void>;
};

/** Resolve choices against live provider records so sends always receive the current provider and model. */
export const useGuidModelSelection = (_agentKey: 'aionrs' = 'aionrs'): GuidModelSelectionResult => {
  const cloud = useOptionalCloudAccount();
  const owner = cloud?.ownerId;
  const accountKey = cloud?.accountKey ?? cloud?.scope;
  const { isGoogleAuth } = useGoogleAuthModels();
  const { data: providers } = useProvidersQuery();
  const modelList = useMemo(
    () =>
      (providers ?? []).filter(
        (p) =>
          p.enabled !== false &&
          !p.platform?.toLowerCase().includes('gemini-with-google-auth') &&
          (p.managed_by !== 'cloud_account' || cloud?.session?.state === 'connected') &&
          hasAvailableModels(p)
      ),
    [providers, cloud?.session?.state]
  );
  const raw = useRememberedChatModel(owner);
  const remembered = useMemo(() => parseChatModelChoice(raw), [raw]);
  const [override, setOverride] = useState<{
    owner?: string;
    choice: ChatModelChoice | 'unavailable';
    kind: 'manual' | 'fixed' | 'automatic';
  }>();
  const local = override?.owner === owner ? override : undefined;
  const resolve = useCallback(
    (choice?: ChatModelChoice | 'unavailable'): TProviderWithModel | undefined => {
      if (!choice || choice === 'unavailable') return;
      const provider = modelList.find((p) => p.id === choice.providerId);
      if (!provider || !getAvailableModels(provider).includes(choice.modelName)) return;
      if ((provider.managed_by === 'cloud_account') !== (choice.source === 'cloud_account')) return;
      if (
        choice.source === 'cloud_account' &&
        (choice.accountKey !== accountKey ||
          choice.protocol !== provider.model_settings?.[choice.modelName]?.openai_api_mode)
      )
        return;
      return { ...provider, use_model: choice.modelName };
    },
    [modelList, accountKey]
  );

  const rememberedModel = useMemo(() => resolve(remembered), [remembered, resolve]);
  // A fixed assistant can use a different configured default. For a matching model name,
  // preserve the explicit provider instead of resolving it to the first same-named model.
  const useLocal =
    local &&
    (local.kind === 'manual' ||
      !remembered ||
      (local.kind === 'fixed' &&
        rememberedModel &&
        local.choice !== 'unavailable' &&
        local.choice.modelName !== rememberedModel.use_model));
  const choice = useLocal ? local.choice : remembered;
  const resolved = useMemo(() => resolve(choice), [resolve, choice]);
  const waitingForOwner = cloud && 'ownerId' in cloud && !owner;
  const fallback = useMemo(() => {
    const provider = modelList.find((p) => p.managed_by !== 'cloud_account');
    return provider ? { ...provider, use_model: getAvailableModels(provider)[0] } : undefined;
  }, [modelList]);

  useEffect(() => {
    if (!choice || choice === 'unavailable' || resolved || providers === undefined) return;
    if (choice.source === 'cloud_account' && (!cloud?.session || cloud.catalogPending)) return;
    // Wait for provider/session hydration; an authoritative withdrawal must not silently
    // select another provider or reactivate a withdrawn billing source on the next chat.
    if (useLocal) setOverride({ owner, choice: 'unavailable', kind: 'manual' });
    else if (owner) rememberChatModel(owner, 'unavailable');
  }, [choice, cloud?.session, cloud?.catalogPending, resolved, providers, owner, useLocal]);

  const setCurrentModel = useCallback(
    async (model: TProviderWithModel, options?: SelectOptions) => {
      const selected = chatModelChoice(model, model.use_model, accountKey);
      if (!resolve(selected)) return;
      if (options?.automatic) {
        if (selected.source === 'cloud_account' || choice === 'unavailable' || (choice && !resolved)) return;
        setOverride({ owner, choice: selected, kind: options.fixed ? 'fixed' : 'automatic' });
      } else if (owner && options?.persistPreference !== false) {
        rememberChatModel(owner, selected);
        setOverride(undefined);
      } else {
        setOverride({ owner, choice: selected, kind: 'manual' });
      }
    },
    [accountKey, choice, owner, resolve, resolved]
  );
  const resetCurrentModel = useCallback(async () => {
    setOverride((current) => (current?.kind === 'manual' ? current : undefined));
  }, []);
  const formatGeminiModelLabel = useCallback(
    (_provider: { platform?: string } | undefined, model?: string) => model ?? '',
    []
  );
  return {
    modelList,
    isGoogleAuth,
    formatGeminiModelLabel,
    current_model: choice ? resolved : waitingForOwner ? undefined : fallback,
    setCurrentModel,
    resetCurrentModel,
  };
};
