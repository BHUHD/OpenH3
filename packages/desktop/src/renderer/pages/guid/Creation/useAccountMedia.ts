import useSWR from 'swr';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { cloudVideoApi } from '@/common/chat/document/creation/cloudVideoApi';
import { accountMediaCatalog, accountMediaRef } from '@/common/chat/document/creation/accountMedia';
import type { CreationKind } from '@/common/chat/document/creation/creation';

/** Keep account creation choices separate from the Agent's text catalog and manual API connections. */
export function useAccountMedia(enabled: boolean, cloudMenu: boolean, kind: CreationKind) {
  const account = useOptionalCloudAccount();
  const accountId = account?.session?.state === 'connected' ? account.session.account.id : undefined;
  const desktop = enabled && isElectronDesktop();
  const active = desktop && !!accountId;
  const models = useSWR(
    active && cloudMenu ? ['creation.account-media', account.scope] : null,
    async () => {
      const result = await account?.readOwned({ operation: 'mediaModels' });
      const parsed = result?.success && accountMediaCatalog.safeParse(result.data);
      if (!parsed || !parsed.success || parsed.data.account_id !== accountId)
        throw new Error('CLOUD_MEDIA_CATALOG_UNAVAILABLE');
      return parsed.data;
    },
    { shouldRetryOnError: false, keepPreviousData: false }
  );
  const defaults = useSWR(
    desktop ? ['creation.account-media-defaults', account?.scope] : null,
    cloudVideoApi.accountDefaults,
    {
      shouldRetryOnError: false,
      keepPreviousData: false,
    }
  );
  const catalog = active && !models.error && models.data?.account_id === accountId ? models.data : undefined;
  const catalogState =
    !active || !cloudMenu
      ? undefined
      : models.error
        ? 'unavailable'
        : !catalog
          ? 'checking'
          : catalog.models.some((model) => model.kind === kind)
            ? 'available'
            : 'empty';
  const setDefault = async (selectedKind: CreationKind, id: string): Promise<void> => {
    if (!desktop) return;
    const reference = accountMediaRef(id);
    if (
      reference &&
      (reference.accountId !== catalog?.account_key ||
        !catalog?.models.some((model) => model.kind === selectedKind && model.model_id === reference.modelId))
    ) {
      throw new Error('CLOUD_MEDIA_SELECTION_UNAVAILABLE');
    }
    if (!reference && !defaults.data?.[selectedKind] && (!active || defaults.data)) return;
    const stillCurrent = account?.captureScope();
    const result = await cloudVideoApi.setAccountDefault(selectedKind, reference);
    if (!result.ok || (stillCurrent && !stillCurrent())) throw new Error('CLOUD_MEDIA_SELECTION_CHANGED');
    void defaults.mutate();
  };
  return {
    accountId: catalog?.account_key,
    catalog,
    catalogState,
    setDefault,
    defaultModel: defaults.data?.[kind]?.accountId === catalog?.account_key ? defaults.data?.[kind] : undefined,
    refresh: (): void => {
      void models.mutate();
    },
  };
}
