import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { SWRConfig, useSWRConfig } from 'swr';
import type { CloudAccountRequest } from '@/common/types/platform/cloudAccount';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import CloudAccount from '@/renderer/components/settings/SettingsModal/CloudAccount';
import { fromApiModel } from '@/common/adapter/apiModelMapper';
const f = vi.hoisted(() => ({ desktop: true, request: vi.fn(), tabs: [] as unknown[], providers: [] as IProvider[] }));
vi.mock('@/common', () => ({ ipcBridge: { mode: { listProviders: { invoke: async () => f.providers } } } }));
vi.mock('@/renderer/hooks/agent/useGoogleAuthModels', () => ({ useGoogleAuthModels: () => ({ isGoogleAuth: false }) }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'local-user' } }),
}));
vi.mock('@/renderer/hooks/system/useCrossSessionRateLimitNotice', () => ({ useCrossSessionRateLimitNotice: () => {} }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ fontScale: 1, theme: 'light' }) }));
vi.mock('@/renderer/pages/settings/AgentSettings', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({ useExtensionSettingsTabs: () => f.tabs }));
vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: () => ({ resolveExtTabName: (tab: { name: string }) => tab.name }),
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => f.desktop,
  resolveExtensionAssetUrl: (url: string) => url,
}));
vi.mock('@/renderer/components/settings/SettingsModal/CloudAccount/transport', () => ({
  requestCloudAccount: f.request,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ isOpen: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/ModelModalContent', () => ({
  default: () => <div>model-content</div>,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/AgentModalContent', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/ToolsModalContent', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/AboutModalContent', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/WebuiModalContent', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/ExtensionSettingsTabContent', () => ({
  default: () => null,
}));
import {
  useCloudAccount,
  CloudAccountProvider,
} from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import SettingsModal from '@/renderer/components/settings/SettingsModal';
import SettingsSider from '@/renderer/pages/settings/components/SettingsSider';
import { getBuiltinSettingsNavItems } from '@/renderer/pages/settings/components/SettingsPageWrapper';
import SiderFooter from '@/renderer/components/layout/Sider/SiderFooter';
import AionrsModelSelector from '@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector';
import Router from '@/renderer/components/layout/Router';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })),
  });
  f.desktop = true;
  f.providers = [];
  f.tabs = [];
  f.request.mockReset();
  f.request.mockImplementation(async (r: CloudAccountRequest) => ({
    success: true,
    data:
      r.operation === 'capabilities'
        ? {
            availability: 'available',
            registration_enabled: true,
            password_login_enabled: true,
            password_reset_enabled: true,
            email_verification_required: false,
            anti_bot: 'not_required',
            password_min_length: 8,
            password_max_length: 128,
          }
        : { state: 'disconnected', generation: '1' },
  }));
  window.location.hash = '#/settings/cloud-account';
});
afterEach(cleanup);
function host(children: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <CloudAccountProvider>{children}</CloudAccountProvider>
    </SWRConfig>
  );
}
it('opens the login modal from the sidebar footer and preserves the WebUI logout action', async () => {
  window.location.hash = '#/settings';
  const logout = vi.fn();
  const openLogin = vi.fn();
  render(
    host(
      <Router
        layout={
          <>
            <SiderFooter
              isMobile={false}
              isSettings={false}
              theme='light'
              siderTooltipProps={{}}
              onSettingsClick={() => {}}
              onThemeToggle={() => {}}
              showLogout
              onLogoutClick={logout}
              onOpenLogin={openLogin}
            />
            <Outlet />
          </>
        }
      />
    )
  );
  // WebUI auth logout still works independently of cloud session
  fireEvent.click(await screen.findByText('settings.googleLogout'));
  expect(logout).toHaveBeenCalledTimes(1);
  // Cloud account entry opens the login modal (not navigating to settings route)
  fireEvent.click(await screen.findByRole('button', { name: 'settings.cloudAccount.entry' }));
  expect(openLogin).toHaveBeenCalledTimes(1);
});
it('uses the same native feature in the modal and clears typed secrets on modal close/reopen', async () => {
  const view = render(
    host(
      <MemoryRouter>
        <SettingsModal visible defaultTab='model' onCancel={() => {}} />
      </MemoryRouter>
    )
  );
  fireEvent.click(await screen.findByRole('button', { name: 'settings.cloudAccount.title' }));
  const input = await screen.findByLabelText('settings.cloudAccount.password');
  fireEvent.change(input, { target: { value: 'modal-secret' } });
  view.rerender(
    host(
      <MemoryRouter>
        <SettingsModal visible={false} defaultTab='cloud-account' onCancel={() => {}} />
      </MemoryRouter>
    )
  );
  await waitFor(() => expect(screen.queryByDisplayValue('modal-secret')).not.toBeInTheDocument());
  view.rerender(
    host(
      <MemoryRouter>
        <SettingsModal visible defaultTab='cloud-account' onCancel={() => {}} />
      </MemoryRouter>
    )
  );
  expect(await screen.findByLabelText('settings.cloudAccount.password')).toHaveValue('');
});
it('keeps cloud account discoverable and extension anchors ordered in desktop and browser settings', () => {
  for (const desktop of [true, false]) {
    f.desktop = desktop;
    f.tabs = [
      { id: 'before-cloud', name: 'Before cloud', position: { relativeTo: 'cloud-account', placement: 'before' } },
    ];
    const view = render(
      host(
        <MemoryRouter>
          <SettingsSider />
        </MemoryRouter>
      )
    );
    expect(
      screen.getByText('Before cloud').compareDocumentPosition(screen.getByText('settings.cloudAccount.title')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(getBuiltinSettingsNavItems(desktop, (key) => key).find((item) => item.id === 'cloud-account')?.path).toBe(
      'cloud-account'
    );
    view.unmount();
  }
});
it('opens the actual account route from the disconnected official model menu without selecting a BYOK model', async () => {
  const select = vi.fn();
  window.location.hash = '#/settings';
  render(
    host(
      <Router
        layout={
          <>
            <AionrsModelSelector
              selection={{
                providers: [],
                current_model: undefined,
                getAvailableModels: () => [],
                handleSelectModel: select,
                getDisplayModelName: () => '',
              }}
            />
            <Outlet />
          </>
        }
      />
    )
  );
  fireEvent.click(await screen.findByTestId('aionrs-model-selector'));
  fireEvent.click(await screen.findByRole('button', { name: 'settings.cloudAccount.entry' }));
  expect(await screen.findByLabelText('settings.cloudAccount.username')).toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
});

it('retains a BYOK selection through native login without a model-selection mutation', async () => {
  const byok = {
    id: 'own-provider',
    name: 'BYOK',
    platform: 'openai',
    models: ['own-model'],
    use_model: 'own-model',
  } as TProviderWithModel;
  const select = vi.fn();
  const Current = () => {
    const selection = useAionrsModelSelection({ initialModel: byok, onSelectModel: select });
    return <span>{selection.current_model?.use_model}</span>;
  };
  f.request.mockImplementation(async (r: CloudAccountRequest) =>
    r.operation === 'login'
      ? {
          success: true,
          data: {
            state: 'connected',
            generation: '2',
            account: { id: '42', username: 'alice', display_name: 'Connected Alice', email: null },
          },
        }
      : r.operation === 'models'
        ? { success: false, code: 'CLOUD_TRANSPORT', error: 'safe' }
        : {
            success: true,
            data:
              r.operation === 'capabilities'
                ? {
                    availability: 'available',
                    registration_enabled: true,
                    password_login_enabled: true,
                    password_reset_enabled: false,
                    email_verification_required: false,
                    anti_bot: 'not_required',
                    password_min_length: 8,
                    password_max_length: 128,
                  }
                : { state: 'disconnected', generation: '1' },
          }
  );
  render(
    host(
      <MemoryRouter>
        <CloudAccount />
        <Current />
      </MemoryRouter>
    )
  );
  fireEvent.change(await screen.findByLabelText('settings.cloudAccount.username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('settings.cloudAccount.password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.login' }));
  expect(await screen.findByText('Connected Alice')).toBeInTheDocument();
  expect(screen.getByText('own-model')).toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
});

it('clears a rehydrated official selection using the existing disabled-provider metadata', async () => {
  f.providers = [
    {
      id: 'old-managed',
      managed_by: 'cloud_account',
      enabled: false,
      name: 'Cloud',
      models: ['official-model'],
    } as IProvider,
  ];
  const rehydrated = fromApiModel({ provider_id: 'old-managed', model: 'official-model' });
  expect(rehydrated.managed_by).toBeUndefined();
  const Current = () => {
    const selection = useAionrsModelSelection({ initialModel: rehydrated, onSelectModel: vi.fn() });
    return <span data-testid='current-selection'>{selection.current_model?.use_model ?? 'none'}</span>;
  };
  render(
    host(
      <MemoryRouter>
        <Current />
      </MemoryRouter>
    )
  );
  await waitFor(() => expect(screen.getByTestId('current-selection')).toHaveTextContent('none'));
});

it('includes persisted tool-less official models and requires explicit reselection after protocol replacement or withdrawal', async () => {
  const official = {
    id: 'official',
    name: 'Managed',
    platform: 'openai',
    base_url: '',
    api_key: '',
    managed_by: 'cloud_account',
    enabled: true,
    models: ['plain-text', 'tools-text'],
    model_settings: {
      'plain-text': { supports_tools: false, openai_api_mode: 'responses' },
      'tools-text': { supports_tools: true, openai_api_mode: 'chat_completions' },
    },
  } as IProvider;
  f.providers = [official];
  f.request.mockImplementation(async (r: CloudAccountRequest) => ({
    success: true,
    data:
      r.operation === 'capabilities'
        ? {
            availability: 'available',
            registration_enabled: true,
            password_login_enabled: true,
            password_reset_enabled: false,
            email_verification_required: false,
            anti_bot: 'not_required',
            password_min_length: 8,
            password_max_length: 128,
          }
        : {
            state: 'connected',
            generation: '1',
            account: { id: '42', username: 'alice', display_name: 'Alice', email: null },
          },
  }));
  const select = vi.fn().mockResolvedValue(true);
  const Current = () => {
    const { mutate } = useSWRConfig();
    const selection = useAionrsModelSelection({
      initialModel: fromApiModel({ provider_id: 'official', model: 'plain-text' }),
      onSelectModel: select,
    });
    return (
      <>
        <span data-testid='selected'>{selection.current_model?.use_model ?? 'none'}</span>
        <AionrsModelSelector selection={selection} />
        <button onClick={() => void mutate('providers')}>refresh persisted providers</button>
      </>
    );
  };
  const Ready = () => (useCloudAccount().session?.state === 'connected' ? <Current /> : null);
  render(
    host(
      <MemoryRouter>
        <Ready />
      </MemoryRouter>
    )
  );
  await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('plain-text'));
  fireEvent.click(screen.getByTestId('aionrs-model-selector'));
  expect(await screen.findByText('settings.cloudAccount.official · Managed')).toBeInTheDocument();
  expect((await screen.findAllByText('plain-text')).length).toBeGreaterThan(1);
  f.providers = [
    {
      ...official,
      model_settings: {
        ...official.model_settings,
        'plain-text': { supports_tools: false, openai_api_mode: 'chat_completions' },
      },
    },
  ];
  fireEvent.click(screen.getByText('refresh persisted providers'));
  await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('none'));
  f.providers = [official];
  fireEvent.click(screen.getByText('refresh persisted providers'));
  expect(screen.getByTestId('selected')).toHaveTextContent('none');
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('aionrs-model-selector'));
  const options = await screen.findAllByText('tools-text');
  fireEvent.click(options[0]);
  await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('tools-text'));
  f.providers = [{ ...official, models: ['plain-text'] }];
  fireEvent.click(screen.getByText('refresh persisted providers'));
  await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('none'));
  expect(select).toHaveBeenCalledTimes(1);
});
