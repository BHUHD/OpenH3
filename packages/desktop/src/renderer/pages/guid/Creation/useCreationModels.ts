import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  MANAGED_H3_MODEL_ID,
  type CreationModel,
  type CreationSelection,
} from '@/common/chat/document/creation/creation';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { comfyApi, COMFY_INVENTORY_CACHE_KEY } from '@/common/chat/document/creation/comfyApi';
import { cloudCreationModels } from '@/common/chat/document/creation/cloudModels';
import { accountMediaId, accountMediaRef } from '@/common/chat/document/creation/accountMedia';
import { useAccountMedia } from './useAccountMedia';
import { cloudVideoApi } from '@/common/chat/document/creation/cloudVideoApi';
import { h3JobApi } from '@/common/chat/document/h3JobApi';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import useConfigModelListWithImage from '@/renderer/hooks/agent/useConfigModelListWithImage';
import { COMFY_FAMILIES } from './comfyDraft';
import { comfyModelFamilySchema, type ComfyFamily, type ComfyProfile } from '@/common/chat/document/creation/comfy';
import {
  comfyWorkflowStatus,
  getComfyModelSetId,
  groupComfyModels,
} from '@/common/chat/document/creation/workflows/identity';

let draftSelection: CreationSelection = { kind: 'video', source: 'local', modelIds: {} };

function savedProfileDetails(id: string | undefined): { name: string; family: ComfyFamily } | undefined {
  if (!id) return;
  try {
    const details = JSON.parse(localStorage.getItem('creation.profile-details') ?? '{}') as Record<
      string,
      { name: string; family: ComfyFamily }
    >;
    const saved = details[id];
    if (saved && typeof saved.name === 'string' && comfyModelFamilySchema.safeParse(saved.family).success) return saved;
  } catch {
    /* A damaged preference must not change the model family. */
  }
}

function storedSelection(): CreationSelection {
  try {
    const stored = JSON.parse(localStorage.getItem('creation.selection') ?? 'null') as CreationSelection | null;
    if (
      stored &&
      ['image', 'video'].includes(stored.kind) &&
      ['local', 'cloud'].includes(stored.source) &&
      stored.modelIds &&
      typeof stored.modelIds === 'object'
    ) {
      draftSelection = stored;
    }
  } catch {
    /* A damaged preference must not block the composer. */
  }
  return draftSelection;
}

/** Keep creation preferences with the unsent draft, including repeated new-chat navigation. */
export function useCreationModels(enabled: boolean) {
  const { modelListWithImage: providers } = useConfigModelListWithImage();
  const [selection, setState] = useState(storedSelection);
  const accountMedia = useAccountMedia(enabled, selection.source === 'cloud', selection.kind);
  const currentProfiles = useRef<ComfyProfile[]>([]);
  const setSelection = useCallback((update: React.SetStateAction<CreationSelection>) => {
    const next = { ...(typeof update === 'function' ? update(draftSelection) : update) };
    const selectedProfile =
      next.source === 'local'
        ? currentProfiles.current.find((profile) => profile.id === next.modelIds[`local-${next.kind}`])
        : undefined;
    if (selectedProfile) {
      const modelSetId = getComfyModelSetId(selectedProfile);
      const priorId = draftSelection.modelIds[`local-${draftSelection.kind}`];
      const priorProfile = currentProfiles.current.find((profile) => profile.id === priorId);
      const priorModelSetId =
        draftSelection.modelConstraint?.modelSetId ?? (priorProfile && getComfyModelSetId(priorProfile));
      next.modelConstraint =
        modelSetId === priorModelSetId && draftSelection.modelConstraint
          ? draftSelection.modelConstraint
          : {
              modelSetId,
              selectionRevision:
                (draftSelection.modelConstraint?.selectionRevision ?? 0) + (modelSetId === priorModelSetId ? 0 : 1),
              workflowMode: 'auto',
            };
    }
    draftSelection = next;
    try {
      localStorage.setItem('creation.selection', JSON.stringify(draftSelection));
    } catch {
      /* Keep an in-memory draft when storage is unavailable. */
    }
    setState(draftSelection);
  }, []);
  const {
    data: inventory,
    error,
    isLoading,
    mutate,
  } = useSWR(enabled ? COMFY_INVENTORY_CACHE_KEY : null, () => comfyApi.inventory(), {
    refreshInterval: 30_000,
    shouldRetryOnError: false,
  });
  const profiles = inventory?.profiles ?? [];
  const { data: managedInventory } = useSWR(
    enabled && selection.kind === 'video' && selection.source === 'local' && isElectronDesktop()
      ? 'creation.managed-h3-inventory'
      : null,
    () => h3JobApi.managedStatus(),
    { refreshInterval: 30_000, shouldRetryOnError: false }
  );
  currentProfiles.current = profiles;
  const inventoryError =
    error instanceof Error
      ? error.message
      : (inventory?.diagnostics.map((issue) => [issue.code, issue.path].filter(Boolean).join(': ')).join('\n') ?? '');
  const { data: configuredImage } = useSWR(
    enabled && selection.source === 'cloud' ? 'creation.cloud-image-default' : null,
    () => getClientBusinessSetting('tools.imageGenerationModel')
  );
  const { data: videoConnections } = useSWR(
    enabled && selection.source === 'cloud' && selection.kind === 'video' ? 'creation.cloud-video-connections' : null,
    () => cloudVideoApi.connections(),
    { shouldRetryOnError: false }
  );
  useEffect(() => {
    if (!Array.isArray(profiles)) return;
    const slot = `${selection.source}-${selection.kind}` as const;
    const profile = profiles.find((item) => item.id === selection.modelIds[slot]);
    if (!profile) return;
    try {
      const details = JSON.parse(localStorage.getItem('creation.profile-details') ?? '{}') as Record<string, unknown>;
      details[profile.id] = { name: profile.name, family: profile.family };
      localStorage.setItem('creation.profile-details', JSON.stringify(details));
    } catch {
      /* Keep the current inventory when storage is unavailable. */
    }
  }, [profiles, selection]);
  const models = useMemo<CreationModel[]>(() => {
    const { kind, source } = selection;
    if (source === 'local') {
      const matching = (Array.isArray(profiles) ? profiles : []).filter((profile) => profile.kind === kind);
      const preferredId = selection.modelIds[`local-${kind}`];
      const choices = groupComfyModels(matching).map(({ modelSetId, profiles: routes }): CreationModel => {
        const profile =
          routes.find((route) => route.id === preferredId) ??
          routes.find((route) => comfyWorkflowStatus(route) === 'verified') ??
          routes[0];
        return {
          id: profile.id,
          name: profile.name,
          profileId: profile.id,
          modelSetId,
          workflowMode: 'auto',
          family: profile.family,
          kind,
          source,
          state: profile.state,
          available: routes.some((route) => comfyWorkflowStatus(route) === 'verified'),
          intent: 'generate',
        };
      });
      if (
        kind === 'video' &&
        managedInventory &&
        (preferredId === MANAGED_H3_MODEL_ID || !choices.some((choice) => choice.family === 'h3' && choice.available))
      ) {
        const managed: CreationModel = {
          id: MANAGED_H3_MODEL_ID,
          name: 'MiniMax H3',
          kind,
          source,
          state: managedInventory.installed ? 'installed' : 'not-installed',
          available: true,
          intent: 'generate',
        };
        if (choices.some((choice) => choice.available)) choices.push(managed);
        else choices.unshift(managed);
      }
      return choices;
    }
    return cloudCreationModels(providers, kind, videoConnections, accountMedia.catalog);
  }, [
    selection.kind,
    selection.source,
    selection.modelIds,
    providers,
    profiles,
    videoConnections,
    managedInventory,
    accountMedia.catalog,
  ]);
  const slot = `${selection.source}-${selection.kind}` as const;
  const savedModelId = selection.modelIds[slot];
  const savedAccount = accountMediaRef(savedModelId);
  const defaultRef = accountMedia.defaultModel;
  const defaultId = defaultRef && accountMediaId(defaultRef.accountId, defaultRef.modelId);
  const unavailableSelection: CreationModel | undefined =
    savedModelId &&
    !models.some((item) => item.id === savedModelId) &&
    !(selection.source === 'local' && COMFY_FAMILIES.some((item) => item.family === savedModelId))
      ? {
          id: savedModelId,
          name: savedAccount
            ? savedAccount.accountId === accountMedia.accountId
              ? savedAccount.modelId
              : ''
            : savedModelId,
          kind: selection.kind,
          source: selection.source,
          state: 'unavailable',
          available: false,
          ...(selection.source === 'local' ? { profileId: savedModelId, ...savedProfileDetails(savedModelId) } : {}),
        }
      : undefined;
  const model =
    models.find((item) => item.id === savedModelId) ??
    unavailableSelection ??
    (selection.source === 'cloud' && defaultId ? models.find((item) => item.id === defaultId) : undefined) ??
    models.find(
      (item) =>
        !!item.provider &&
        item.provider.id === configuredImage?.id &&
        item.provider.use_model === configuredImage?.use_model
    ) ??
    models.find((item) => !item.id.startsWith('account-media:')) ??
    ({
      id: `empty:${slot}`,
      name: '',
      kind: selection.kind,
      source: selection.source,
      state: isLoading ? 'checking' : inventoryError ? 'unavailable' : 'not-installed',
      available: false,
    } satisfies CreationModel);
  return {
    selection,
    setSelection,
    models: unavailableSelection ? [...models, unavailableSelection] : models,
    model,
    profiles: Array.isArray(profiles) ? profiles : [],
    workflowPreparations: inventory?.workflowPreparations,
    isLoading,
    error,
    inventoryError,
    accountMedia,
    refresh: mutate,
  };
}
