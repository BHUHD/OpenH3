import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { CloudAccountRequest } from '@/common/types/platform/cloudAccount';

const f = vi.hoisted(() => ({ request: vi.fn(), onOpenLogin: vi.fn(), onLogout: vi.fn() }));

vi.mock('@/renderer/components/settings/SettingsModal/CloudAccount/transport', () => ({
  requestCloudAccount: f.request,
}));
vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'local-user' } }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn() }),
}));
vi.mock('@/renderer/services/feedback/resolveFeedbackModule', () => ({
  resolveFeedbackModule: () => 'test',
}));

import { CloudAccountProvider } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import AccountMenu from '@/renderer/components/layout/Sider/AccountMenu';

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

function host(ui: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <CloudAccountProvider>{ui}</CloudAccountProvider>
    </SWRConfig>
  );
}

beforeEach(() => {
  f.request.mockReset();
  f.request.mockImplementation(async (r: CloudAccountRequest) => ({
    success: true,
    data: r.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
  }));
  f.onOpenLogin.mockReset();
  f.onLogout.mockReset();
});
afterEach(cleanup);

const baseProps = {
  collapsed: false,
  isMobile: false,
  theme: 'light' as const,
  siderTooltipProps: {} as never,
  onThemeToggle: vi.fn(),
  onOpenLogin: f.onOpenLogin,
  onLogout: f.onLogout,
};

it('not-connected: renders login button with correct label', async () => {
  render(host(<AccountMenu {...baseProps} />));
  await waitFor(() => expect(screen.getByRole('button', { name: 'settings.cloudAccount.entry' })).toBeInTheDocument());
});

it('not-connected: clicking login button calls onOpenLogin', async () => {
  render(host(<AccountMenu {...baseProps} />));
  fireEvent.click(await screen.findByRole('button', { name: 'settings.cloudAccount.entry' }));
  expect(f.onOpenLogin).toHaveBeenCalledTimes(1);
});

it('connected: renders display name and no login button', async () => {
  f.request.mockImplementation(async (r: CloudAccountRequest) => {
    if (r.operation === 'capabilities') return { success: true, data: capabilities };
    return {
      success: true,
      data: {
        state: 'connected',
        generation: '1',
        account: { id: '1', username: 'alice', display_name: 'Alice', email: null },
      },
    };
  });
  render(host(<AccountMenu {...baseProps} />));
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'settings.cloudAccount.entry' })).not.toBeInTheDocument();
});

it('collapsed + not-connected: renders icon button without visible label text', async () => {
  render(host(<AccountMenu {...baseProps} collapsed />));
  await waitFor(() => expect(f.request).toHaveBeenCalled());
  expect(screen.queryByText('settings.cloudAccount.entry')).not.toBeInTheDocument();
});

it('logs out the cloud account without invoking WebUI logout', async () => {
  let connected = true;
  f.request.mockImplementation(async (request: CloudAccountRequest) => {
    if (request.operation === 'capabilities') return { success: true, data: capabilities };
    if (request.operation === 'logout') {
      connected = false;
      return { success: true, data: { remote_revocation: 'confirmed' } };
    }
    return {
      success: true,
      data: connected
        ? {
            state: 'connected',
            generation: '1',
            account: { id: '1', username: 'alice', display_name: 'Alice', email: null },
          }
        : { state: 'disconnected', generation: '2' },
    };
  });
  render(host(<AccountMenu {...baseProps} />));
  fireEvent.click(await screen.findByRole('button', { name: 'Alice' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'settings.cloudAccount.logout' }));
  await waitFor(() => expect(f.request).toHaveBeenCalledWith({ operation: 'logout' }));
  expect(f.onLogout).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'settings.cloudAccount.entry' })).toBeInTheDocument();
});
