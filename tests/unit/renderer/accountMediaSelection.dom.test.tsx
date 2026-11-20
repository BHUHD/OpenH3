import React from 'react';
import { SWRConfig } from 'swr';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountMediaId } from '@/common/chat/document/creation/accountMedia';
import { useAccountMedia } from '@/renderer/pages/guid/Creation/useAccountMedia';

const api = vi.hoisted(() => ({
  read: vi.fn(),
  defaults: vi.fn(),
  setDefault: vi.fn(),
  accountId: 'u1',
}));
vi.mock('@/renderer/components/settings/SettingsModal/CloudAccount/Provider', () => ({
  useOptionalCloudAccount: () => ({
    session: { state: 'connected', account: { id: api.accountId } },
    scope: api.accountId,
    readOwned: api.read,
    captureScope: () => () => true,
  }),
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/common/chat/document/creation/cloudVideoApi', () => ({
  cloudVideoApi: { accountDefaults: api.defaults, setAccountDefault: api.setDefault },
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);
const fixture = {
  model_id: 'vendor/still',
  display_name: 'Illustration',
  kind: 'image',
  capabilities: ['text-to-image'],
};
const reply = (account_id: string, models: unknown[]) => ({
  success: true,
  data: { account_id, account_key: 'issuer-a-' + account_id, models },
});

describe('account media selection for ordinary chats', () => {
  beforeEach(() => {
    api.accountId = 'u1';
    api.read.mockReset();
    api.defaults.mockReset().mockResolvedValue({});
    api.setDefault.mockReset().mockResolvedValue({ ok: true });
  });
  it('shows an empty catalog without selecting a paid model or changing the Agent', async () => {
    api.read.mockResolvedValue(reply('u1', []));
    const { result } = renderHook(() => useAccountMedia(true, true, 'image'), { wrapper });
    await waitFor(() => expect(result.current.catalogState).toBe('empty'));
    expect(api.read).toHaveBeenCalledWith({ operation: 'mediaModels' });
    expect(api.setDefault).not.toHaveBeenCalled();
  });
  it('pins only the selected media kind; rejects mismatched capabilities and stale account choices', async () => {
    api.read.mockResolvedValue(reply('u1', [fixture]));
    const { result, rerender } = renderHook(() => useAccountMedia(true, true, 'image'), { wrapper });
    await waitFor(() => expect(result.current.catalogState).toBe('available'));
    const id = accountMediaId('issuer-a-u1', fixture.model_id);
    await act(() => result.current.setDefault('image', id));
    expect(api.setDefault).toHaveBeenCalledWith('image', { accountId: 'issuer-a-u1', modelId: fixture.model_id });
    await expect(result.current.setDefault('image', accountMediaId('issuer-b-u1', fixture.model_id))).rejects.toThrow();
    await expect(result.current.setDefault('video', id)).rejects.toThrow();
    api.accountId = 'u2';
    rerender();
    await waitFor(() => expect(result.current.catalogState).toBe('unavailable'));
    expect(result.current.catalog).toBeUndefined();
    await expect(result.current.setDefault('image', id)).rejects.toThrow();
    expect(api.setDefault).toHaveBeenCalledTimes(1);
  });
  it('clears an existing account default when an explicit local model is selected', async () => {
    api.defaults.mockResolvedValue({ image: { accountId: 'u1', modelId: fixture.model_id } });
    const { result } = renderHook(() => useAccountMedia(true, false, 'image'), { wrapper });
    await waitFor(() => expect(api.defaults).toHaveBeenCalled());
    await act(() => result.current.setDefault('image', 'local-image-profile'));
    expect(api.setDefault).toHaveBeenCalledWith('image', undefined);
    expect(api.read).not.toHaveBeenCalled();
  });
});
