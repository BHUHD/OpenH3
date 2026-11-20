import { useCallback } from 'react';
import useSWR from 'swr';
import type { CloudAccountData, CloudAccountRequest } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from '../Provider';

/** Cache publications retain their original authority and filter key. */
export function useCloudRead<T extends CloudAccountData>(
  request: CloudAccountRequest,
  accept: (data: CloudAccountData) => data is T
) {
  const cloud = useCloudAccount();
  const scope = cloud.scope;
  const fetcher = useCallback(async () => {
    const result = await cloud.readOwned(request);
    if (!result?.success || !accept(result.data)) throw Object.assign(new Error('CLOUD_TRANSPORT'), { scope });
    return { scope, data: result.data };
  }, [cloud.readOwned, JSON.stringify(request), scope, accept]);
  const query = useSWR<{ scope: string; data: T }, Error & { scope: string }>(
    cloud.session?.state === 'connected' ? ['cloud-read', scope, request] : null,
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      keepPreviousData: false,
    }
  );
  return {
    data: query.data?.scope === scope ? query.data.data : undefined,
    failed: query.error?.scope === scope,
    loading: query.isValidating,
    refresh: () => {
      void query.mutate();
    },
  };
}
