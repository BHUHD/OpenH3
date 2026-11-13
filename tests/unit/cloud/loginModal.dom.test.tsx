import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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

import {
  CloudAccountProvider,
  useCloudAccount,
} from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
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

it('keeps an open login modal through the catalog read and closes after the read completes', async () => {
  let resolveModels: ((value: unknown) => void) | undefined;
  const models = new Promise((resolve) => {
    resolveModels = resolve;
  });
  const connected = {
    state: 'connected',
    generation: '2',
    account: { id: '1', username: 'alice', display_name: 'Alice', email: null },
  };
  f.request.mockImplementation(async (r: CloudAccountRequest) => {
    if (r.operation === 'capabilities') return { success: true, data: capabilities };
    if (r.operation === 'login') return { success: true, data: connected };
    if (r.operation === 'models') return models;
    if (r.operation === 'wallet') return { success: false, code: 'CLOUD_TRANSPORT', error: 'fixture' };
    return { success: true, data: { state: 'disconnected', generation: '1' } };
  });
  const { result } = renderHook(() => ({ modal: useLoginModal(), cloud: useCloudAccount() }), { wrapper });
  await waitFor(() => expect(result.current.modal.open).toBe(true));
  let login: Promise<void> | undefined;
  act(() => {
    login = result.current.cloud.run({
      operation: 'login',
      input: { username: 'alice', password: 'fixture-password' },
    });
  });
  await waitFor(() => {
    expect(result.current.cloud.catalogPending).toBe(true);
    expect(result.current.modal.connected).toBe(true);
  });
  expect(result.current.modal.open).toBe(true);
  await act(async () => {
    resolveModels?.({ success: true, data: { models: [], status: 'available' } });
    await login;
  });
  await waitFor(() => expect(result.current.modal.open).toBe(false));
  expect(result.current.cloud.catalogPending).toBe(false);
  expect(result.current.cloud.catalogRead).toBe(true);
});

it('waits for a known session and never auto-prompts an unavailable service', async () => {
  let resolveSession: ((value: unknown) => void) | undefined;
  const session = new Promise((resolve) => {
    resolveSession = resolve;
  });
  f.request.mockImplementation(async (r: CloudAccountRequest) =>
    r.operation === 'capabilities' ? { success: true, data: capabilities } : session
  );
  const { result } = renderHook(() => useLoginModal(), { wrapper });
  await waitFor(() => expect(f.request).toHaveBeenCalledWith({ operation: 'session' }));
  expect(result.current.open).toBe(false);
  await act(async () => {
    resolveSession?.({ success: true, data: { state: 'disabled' } });
  });
  expect(result.current.open).toBe(false);
  expect(f.lsSetItem).not.toHaveBeenCalled();
});

it('records the first prompt before login and does not auto-open after logout', async () => {
  const stored = new Map<string, string>();
  f.lsGetItem.mockImplementation((key?: string) => stored.get(key ?? '') ?? null);
  f.lsSetItem.mockImplementation((key: string, value: string) => {
    stored.set(key, value);
  });
  let loggedIn = false;
  f.request.mockImplementation(async (r: CloudAccountRequest) => {
    if (r.operation === 'capabilities') return { success: true, data: capabilities };
    if (r.operation === 'login') loggedIn = true;
    if (r.operation === 'logout') {
      loggedIn = false;
      return { success: true, data: { remote_revocation: 'confirmed' } };
    }
    if (r.operation === 'models') return { success: true, data: { models: [], status: 'available' } };
    if (r.operation === 'wallet') return { success: false, code: 'CLOUD_TRANSPORT', error: 'fixture' };
    return {
      success: true,
      data: loggedIn
        ? {
            state: 'connected',
            generation: '2',
            account: { id: '1', username: 'alice', display_name: 'Alice', email: null },
          }
        : { state: 'disconnected', generation: '3' },
    };
  });
  const { result } = renderHook(() => ({ modal: useLoginModal(), cloud: useCloudAccount() }), { wrapper });
  await waitFor(() => expect(result.current.modal.open).toBe(true));
  expect(stored.get('login-modal-skipped')).toBe('1');
  await act(async () => {
    await result.current.cloud.run({ operation: 'login', input: { username: 'alice', password: 'fixture-password' } });
  });
  await waitFor(() => expect(result.current.modal.open).toBe(false));
  await act(async () => {
    await result.current.cloud.run({ operation: 'logout' });
  });
  await waitFor(() => expect(result.current.cloud.session?.state).toBe('disconnected'));
  expect(result.current.modal.open).toBe(false);
});

it('does not auto-prompt an existing connected session at startup', async () => {
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
  expect(f.lsSetItem).not.toHaveBeenCalled();
});
