import React from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { CloudAccountRequest } from '@/common/types/platform/cloudAccount';

const f = vi.hoisted(() => ({
  request: vi.fn(),
  lsGetItem: vi.fn(() => null as string | null),
  lsSetItem: vi.fn(),
}));

vi.mock('@/renderer/components/settings/SettingsModal/CloudAccount/transport', () => ({
  requestCloudAccount: f.request,
}));
vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'local-user' } }),
}));

import { CloudAccountProvider } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import { useLoginModal } from '@/renderer/components/layout/LoginModal/useLoginModal';

const capabilities = {
  availability: 'available',
  registration_enabled: true,
  password_login_enabled: true,
  password_reset_enabled: true,
  email_verification_required: false,
  anti_bot: 'not_required',
  password_min_length: 8,
  password_max_length: 128,
};

function wrapper({ children }: { children?: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <CloudAccountProvider>{children}</CloudAccountProvider>
    </SWRConfig>
  );
}

beforeEach(() => {
  f.request.mockReset();
  f.request.mockImplementation(async (r: CloudAccountRequest) => ({
    success: true,
    data: r.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
  }));
  f.lsGetItem.mockReturnValue(null);
  f.lsSetItem.mockReset();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(f.lsGetItem);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(f.lsSetItem);
});
afterEach(cleanup);

it('auto-opens once when available and not connected and no skip flag', async () => {
  const { result } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(result.current.open).toBe(true));
  expect(f.lsGetItem).toHaveBeenCalledWith('login-modal-skipped');
});

it('does not auto-open when skip flag is set in localStorage', async () => {
  f.lsGetItem.mockReturnValue('1');
  const { result } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(f.request).toHaveBeenCalled());
  expect(result.current.open).toBe(false);
});

it('handleClose sets skip flag and closes modal', async () => {
  const { result } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(result.current.open).toBe(true));
  result.current.handleClose();
  await waitFor(() => expect(result.current.open).toBe(false));
  expect(f.lsSetItem).toHaveBeenCalledWith('login-modal-skipped', '1');
});

it('openManual opens regardless of skip flag', async () => {
  f.lsGetItem.mockReturnValue('1');
  const { result } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(f.request).toHaveBeenCalled());
  expect(result.current.open).toBe(false);
  result.current.openManual();
  await waitFor(() => expect(result.current.open).toBe(true));
});

it('does not auto-close while catalogPending is true after connecting', async () => {
  let cancelModels: (() => void) | undefined;
  f.request.mockImplementation(async (r: CloudAccountRequest) => {
    if (r.operation === 'capabilities') return { success: true, data: capabilities };
    if (r.operation === 'models')
      return new Promise<never>((_, reject) => {
        cancelModels = () => reject(new Error('cancelled'));
      });
    return {
      success: true,
      data: {
        state: 'connected',
        generation: '1',
        account: { id: '1', username: 'alice', display_name: 'Alice', email: null },
      },
    };
  });
  const { result, unmount } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(result.current.connected).toBe(true), { timeout: 2000 });
  // Modal should still be open — catalog is pending
  expect(result.current.open).toBe(false);
  cancelModels?.();
  unmount();
});

it('auto-closes once connected and catalogPending resolves to false', async () => {
  f.request.mockImplementation(async (r: CloudAccountRequest) => {
    if (r.operation === 'capabilities') return { success: true, data: capabilities };
    if (r.operation === 'models') return { success: true, data: { models: [], status: 'available' } };
    return {
      success: true,
      data: {
        state: 'connected',
        generation: '1',
        account: { id: '1', username: 'alice', display_name: 'Alice', email: null },
      },
    };
  });
  const { result } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(result.current.connected).toBe(true), { timeout: 2000 });
  await waitFor(() => expect(result.current.open).toBe(false), { timeout: 2000 });
});
