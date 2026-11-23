import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { CloudAccountRequest, CloudAccountResponse, CloudSession } from '@/common/types/platform/cloudAccount';

const f = vi.hoisted(() => ({
  owner: 'owner-a',
  webUser: true,
  currentUser: vi.fn<() => Promise<{ id: string }>>(),
  request: vi.fn<(request: CloudAccountRequest) => Promise<CloudAccountResponse>>(),
  mutate: vi.fn(),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: f.webUser ? { id: f.owner } : null }),
}));
vi.mock('@/common', () => ({ ipcBridge: { auth: { currentUser: { invoke: f.currentUser } } } }));
vi.mock('@/renderer/components/settings/SettingsModal/CloudAccount/transport', () => ({
  requestCloudAccount: f.request,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { CloudAccountProvider } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import CloudAccount from '@/renderer/components/settings/SettingsModal/CloudAccount';
import { ProofForm } from '@/renderer/components/settings/SettingsModal/CloudAccount/ProofForm';
import userEvent from '@testing-library/user-event';
import { useCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import { resetCurrentUserIdCache } from '@/renderer/hooks/system/currentUserId';

const capabilities = {
  availability: 'available' as const,
  registration_enabled: true,
  password_login_enabled: true,
  password_reset_enabled: true,
  email_verification_required: true,
  anti_bot: 'not_required' as const,
  password_min_length: 8,
  password_max_length: 128,
};
function mount() {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), onError: () => {}, shouldRetryOnError: false, focusThrottleInterval: 0 }}
    >
      <CloudAccountProvider>
        <CloudAccount />
      </CloudAccountProvider>
    </SWRConfig>
  );
}
/** Connected accounts have no healthy refresh control; window focus re-reads the session. */
async function refocus() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
}
async function fill(name: string, value: string) {
  fireEvent.change(await screen.findByLabelText(`settings.cloudAccount.${name}`), { target: { value } });
}
async function click(name: string) {
  const buttons = await screen.findAllByRole('button', { name: `settings.cloudAccount.${name}`, exact: true });
  fireEvent.click(buttons.find((button) => button.getAttribute('type') === 'submit') ?? buttons[0]);
}
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })),
  });
  f.owner = 'owner-a';
  f.webUser = true;
  f.currentUser.mockReset();
  resetCurrentUserIdCache();
  f.request.mockReset();
  f.request.mockImplementation(async (request) => ({
    success: true,
    data: request.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
  }));
});
afterEach(() => {
  cleanup();
  delete window.electronAPI;
  vi.useRealTimers();
});

it('logs in with an existing short password and preserves connected success if catalog fails', async () => {
  f.request.mockImplementation(async (request) =>
    request.operation === 'login'
      ? {
          success: true,
          data: {
            state: 'connected',
            generation: '2',
            account: { id: '42', username: 'alice', display_name: 'Alice', email: null },
          },
        }
      : request.operation === 'models'
        ? { success: false, code: 'CLOUD_TRANSPORT', error: 'RAW SECRET' }
        : {
            success: true,
            data: request.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
          }
  );
  mount();
  await fill('username', 'alice');
  await fill('password', 'old');
  await click('login');
  expect(await screen.findByText('Alice')).toBeInTheDocument();
  expect(await screen.findByText('settings.cloudAccount.catalogFailed')).toBeInTheDocument();
  expect(screen.queryByText('RAW SECRET')).not.toBeInTheDocument();
  expect(f.request).toHaveBeenCalledWith({ operation: 'login', input: { username: 'alice', password: 'old' } });
});

it('registers once, clears passwords, and retains created status when a later login fails', async () => {
  let generation = '1';
  f.request.mockImplementation(async (request) => {
    if (request.operation === 'login') {
      generation = '2';
      return { success: false, code: 'CLOUD_VERIFICATION_FAILED', error: 'RAW' };
    }
    return request.operation === 'register'
      ? { success: true, data: { status: 'registered' } }
      : {
          success: true,
          data: request.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation },
        };
  });
  mount();
  await click('register');
  await fill('username', 'alice');
  await fill('email', 'alice@example.com');
  await click('sendCode');
  expect(f.request).toHaveBeenCalledWith({
    operation: 'emailCode',
    input: { email: 'alice@example.com', purpose: 'registration' },
  });
  await fill('password', 'password123');
  await fill('confirmPassword', 'password123');
  await fill('emailCode', '123456');
  fireEvent.click(screen.getByLabelText('settings.cloudAccount.acknowledgement'));
  await click('createAccount');
  expect(await screen.findByText('settings.cloudAccount.registered')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('password123')).not.toBeInTheDocument();
  await fill('username', 'alice');
  await fill('password', 'bad');
  await click('login');
  await waitFor(() => expect(f.request.mock.calls.filter(([r]) => r.operation === 'session')).toHaveLength(2));
  expect(await screen.findByText('settings.cloudAccount.registered')).toBeInTheDocument();
  expect(f.request.mock.calls.filter(([r]) => r.operation === 'register')).toHaveLength(1);
});

it('clears a pending login and secrets on local owner change; delayed A cannot paint B', async () => {
  let resolve: (result: CloudAccountResponse) => void = vi.fn();
  f.request.mockImplementation(async (request) =>
    request.operation === 'login'
      ? new Promise((r) => {
          resolve = r;
        })
      : {
          success: true,
          data: request.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
        }
  );
  const view = mount();
  await fill('username', 'alice');
  await fill('password', 'private');
  await click('login');
  f.owner = 'owner-b';
  view.rerender(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CloudAccountProvider>
        <CloudAccount />
      </CloudAccountProvider>
    </SWRConfig>
  );
  await act(async () =>
    resolve({
      success: true,
      data: {
        state: 'connected',
        generation: '2',
        account: { id: '42', username: 'alice', display_name: 'Old Alice', email: null },
      },
    })
  );
  expect(screen.queryByText('Old Alice')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('private')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('settings.cloudAccount.username')).toHaveValue(''));
});

it('expires a purpose-bound proof and clears its secret without submitting', async () => {
  vi.useFakeTimers();
  const verify = vi.fn();
  render(
    <ProofForm
      challenge={{
        purpose: 'device_revocation',
        challenge_id: 'local-handle',
        expires_at: Math.floor(Date.now() / 1000) + 2,
        methods: ['password'],
      }}
      purpose='device_revocation'
      busy={false}
      onVerify={verify}
      onCancel={() => {}}
    />
  );
  fireEvent.change(screen.getByLabelText('settings.cloudAccount.password'), { target: { value: 'sensitive-proof' } });
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByDisplayValue('sensitive-proof')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'settings.cloudAccount.verify' })).toBeDisabled();
  expect(verify).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it('does not finish an old recovery delivery after a same-owner generation change', async () => {
  let generation = '1';
  let finish: (value: CloudAccountResponse) => void = vi.fn();
  f.request.mockImplementation(async (r) =>
    r.operation === 'emailCode'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { success: true, data: r.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation } }
  );
  mount();
  await click('recovery');
  await fill('email', 'alice@example.com');
  await click('sendCode');
  generation = '3';
  await click('refresh');
  await waitFor(() => expect(screen.queryByLabelText('settings.cloudAccount.email')).not.toBeInTheDocument());
  await act(async () => finish({ success: true, data: null }));
  expect(screen.queryByText('settings.cloudAccount.codeSent')).not.toBeInTheDocument();
});

it('completes email recovery, backup proof, and a confirmed new password without retaining secrets', async () => {
  f.request.mockImplementation(async (r) => {
    if (r.operation === 'passwordReset')
      return {
        success: true,
        data: {
          status: 'verification_required',
          verification: {
            purpose: 'password_reset',
            challenge_id: 'recovery-handle',
            expires_at: Math.floor(Date.now() / 1000) + 90,
            methods: ['backup_code'],
          },
        },
      };
    if (r.operation === 'verify')
      return {
        success: true,
        data: {
          result: 'password_reset_ready',
          challenge_id: 'ready-handle',
          expires_at: Math.floor(Date.now() / 1000) + 90,
        },
      };
    if (r.operation === 'passwordResetComplete') return { success: true, data: { session_cleanup_pending: true } };
    return {
      success: true,
      data:
        r.operation === 'capabilities'
          ? capabilities
          : r.operation === 'emailCode'
            ? null
            : { state: 'disconnected', generation: '1' },
    };
  });
  mount();
  await click('recovery');
  await fill('email', 'alice@example.com');
  await click('sendCode');
  expect(await screen.findByText('settings.cloudAccount.codeSent')).toBeInTheDocument();
  await fill('emailCode', '123456');
  await click('verifyEmail');
  await fill('proofCode', 'backup-secret');
  await click('verify');
  expect(f.request).toHaveBeenCalledWith({
    operation: 'verify',
    input: { challenge_id: 'recovery-handle', method: 'backup_code', code: 'backup-secret' },
  });
  await fill('password', 'new-password');
  await fill('confirmPassword', 'new-password');
  await click('savePassword');
  expect(await screen.findByText('settings.cloudAccount.resetCleanupPending')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('new-password')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('backup-secret')).not.toBeInTheDocument();
});

it('uses login TOTP challenges and drops the password before verification', async () => {
  f.request.mockImplementation(async (r) =>
    r.operation === 'login'
      ? {
          success: true,
          data: {
            state: 'verification_required',
            generation: '2',
            verification: {
              purpose: 'login',
              challenge_id: 'login-handle',
              expires_at: Math.floor(Date.now() / 1000) + 60,
              methods: ['totp'],
            },
          },
        }
      : r.operation === 'verify'
        ? {
            success: true,
            data: {
              result: 'login',
              session: {
                state: 'connected',
                generation: '2',
                account: { id: '42', username: 'alice', display_name: 'Alice MFA', email: null },
              },
            },
          }
        : {
            success: true,
            data:
              r.operation === 'capabilities'
                ? capabilities
                : r.operation === 'models'
                  ? { status: 'available', models: [], quote_semantics: 'observed_rules_not_frozen_final_charge' }
                  : { state: 'disconnected', generation: '1' },
          }
  );
  mount();
  await fill('username', 'alice');
  await fill('password', 'never-retain');
  await click('login');
  await fill('proofCode', '123456');
  expect(screen.queryByDisplayValue('never-retain')).not.toBeInTheDocument();
  await click('verify');
  expect(await screen.findByText('Alice MFA')).toBeInTheDocument();
});

it.each(['disabled', 'unconfigured'] as const)('shows %s independently of usable forms', async (state) => {
  f.request.mockImplementation(async (r) => ({
    success: true,
    data: r.operation === 'capabilities' ? { ...capabilities, availability: state } : { state },
  }));
  mount();
  expect(await screen.findByText(`settings.cloudAccount.${state}`)).toBeInTheDocument();
  expect(screen.queryByLabelText('settings.cloudAccount.password')).not.toBeInTheDocument();
});

it('clears the local connected view immediately and reports unconfirmed offline revocation', async () => {
  let disconnected = false;
  let finish: (value: CloudAccountResponse) => void = vi.fn();
  f.request.mockImplementation(async (r) =>
    r.operation === 'logout'
      ? new Promise((resolve) => {
          disconnected = true;
          finish = resolve;
        })
      : {
          success: true,
          data:
            r.operation === 'capabilities'
              ? capabilities
              : disconnected
                ? { state: 'disconnected', generation: '3' }
                : {
                    state: 'connected',
                    generation: '2',
                    account: { id: '42', username: 'alice', display_name: 'Alice Online', email: null },
                  },
        }
  );
  mount();
  expect(await screen.findByText('Alice Online')).toBeInTheDocument();
  await click('logout');
  expect(screen.queryByText('Alice Online')).not.toBeInTheDocument();
  await act(async () => finish({ success: true, data: { remote_revocation: 'unconfirmed' } }));
  expect(await screen.findByText('settings.cloudAccount.logoutUnconfirmed')).toBeInTheDocument();
});

it('preserves logout revocation outcome through a read of its immediate local disconnect', async () => {
  let disconnected = false;
  let finish: (value: CloudAccountResponse) => void = vi.fn();
  f.request.mockImplementation(async (r) =>
    r.operation === 'logout'
      ? new Promise((resolve) => {
          disconnected = true;
          finish = resolve;
        })
      : {
          success: true,
          data:
            r.operation === 'capabilities'
              ? capabilities
              : disconnected
                ? { state: 'disconnected', generation: '3' }
                : {
                    state: 'connected',
                    generation: '2',
                    account: { id: '42', username: 'alice', display_name: 'Alice Online', email: null },
                  },
        }
  );
  mount();
  await screen.findByText('Alice Online');
  await click('logout');
  await click('refresh');
  await waitFor(() => expect(f.request.mock.calls.filter(([r]) => r.operation === 'session')).toHaveLength(2));
  await act(async () => finish({ success: true, data: { remote_revocation: 'unconfirmed' } }));
  expect(await screen.findByText('settings.cloudAccount.logoutUnconfirmed')).toBeInTheDocument();
});

it('preserves an existing long Unicode password exactly', async () => {
  const user = userEvent.setup();
  mount();
  await fill('username', 'alice');
  const password = '🚀'.repeat(100);
  await user.type(await screen.findByLabelText('settings.cloudAccount.password'), password);
  await click('login');
  expect(f.request).toHaveBeenCalledWith({ operation: 'login', input: { username: 'alice', password } });
});

it('does not repaint an old connected read delivered after logout completes', async () => {
  let reads = 0;
  let finishRead: (value: CloudAccountResponse) => void = vi.fn();
  let finishLogout: (value: CloudAccountResponse) => void = vi.fn();
  const old = {
    state: 'connected' as const,
    generation: '2',
    account: { id: '42', username: 'alice', display_name: 'Old Alice Snapshot', email: null },
  };
  f.request.mockImplementation(async (r) => {
    if (r.operation === 'capabilities') return { success: true, data: capabilities };
    if (r.operation === 'logout')
      return new Promise((resolve) => {
        finishLogout = resolve;
      });
    if (r.operation === 'session' && ++reads === 2)
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    return { success: true, data: reads > 2 ? { state: 'disconnected', generation: '3' } : old };
  });
  mount();
  await screen.findByText('Old Alice Snapshot');
  await click('logout');
  await click('refresh');
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => finishLogout({ success: true, data: { remote_revocation: 'confirmed' } }));
  expect(await screen.findByText('settings.cloudAccount.logoutConfirmed')).toBeInTheDocument();
  await act(async () => finishRead({ success: true, data: old }));
  expect(screen.queryByText('Old Alice Snapshot')).not.toBeInTheDocument();
});

it('honors rate-limit retry deadlines and keeps fixed errors', async () => {
  f.request.mockImplementation(async (r) =>
    r.operation === 'emailCode'
      ? { success: false, code: 'CLOUD_RATE_LIMITED', error: 'PRIVATE RAW', details: { retry_after: 5 } }
      : {
          success: true,
          data: r.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
        }
  );
  mount();
  await click('recovery');
  await fill('email', 'alice@example.com');
  await click('sendCode');
  expect(await screen.findByText('settings.cloudAccount.rateLimited')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'settings.cloudAccount.sendCode' })).toBeDisabled();
  expect(screen.queryByText('PRIVATE RAW')).not.toBeInTheDocument();
});

it('honors a rate-limited proof deadline without submitting or clearing newly typed proof on clock ticks', async () => {
  f.request.mockImplementation(async (r) =>
    r.operation === 'login'
      ? {
          success: true,
          data: {
            state: 'verification_required',
            generation: '2',
            verification: {
              purpose: 'login',
              challenge_id: 'rate-limited-proof',
              expires_at: Math.floor(Date.now() / 1000) + 90,
              methods: ['totp'],
            },
          },
        }
      : r.operation === 'verify'
        ? { success: false, code: 'CLOUD_RATE_LIMITED', error: 'PRIVATE RAW', details: { retry_after: 2 } }
        : {
            success: true,
            data: r.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
          }
  );
  mount();
  await fill('username', 'alice');
  await fill('password', 'private');
  await click('login');
  await fill('proofCode', '123456');
  await click('verify');
  expect(await screen.findByText('settings.cloudAccount.rateLimited')).toBeInTheDocument();
  await fill('proofCode', '654321');
  expect(screen.getByRole('button', { name: 'settings.cloudAccount.verify' })).toBeDisabled();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  expect(screen.getByLabelText('settings.cloudAccount.proofCode')).toHaveValue('654321');
  expect(f.request.mock.calls.filter(([r]) => r.operation === 'verify')).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('button', { name: 'settings.cloudAccount.verify' })).toBeEnabled(), {
    timeout: 3000,
  });
});

const Probe = () => {
  const c = useCloudAccount();
  return <span>{c.session?.state === 'connected' ? c.session.account.display_name : 'no-account'}</span>;
};
const VisibleHost = ({ visible }: { visible: boolean }) => (
  <SWRConfig value={{ provider: () => new Map() }}>
    <CloudAccountProvider>
      {visible && <CloudAccount />}
      <Probe />
    </CloudAccountProvider>
  </SWRConfig>
);
it('does not restore secrets after switching forms or unmounting a pending form', async () => {
  let finish: (value: CloudAccountResponse) => void = vi.fn();
  let onLoginStarted: () => void = () => {};
  const loginStarted = new Promise<void>((resolve) => {
    onLoginStarted = resolve;
  });
  f.request.mockImplementation(async (r) =>
    r.operation === 'login'
      ? new Promise((resolve) => {
          finish = resolve;
          onLoginStarted();
        })
      : {
          success: true,
          data: r.operation === 'capabilities' ? capabilities : { state: 'disconnected', generation: '1' },
        }
  );
  const view = render(<VisibleHost visible />);
  await fill('password', 'form-secret');
  await click('register');
  expect(screen.queryByDisplayValue('form-secret')).not.toBeInTheDocument();
  await click('login');
  await fill('username', 'alice');
  await fill('password', 'pending-secret');
  const submit = screen
    .getAllByRole('button', { name: 'settings.cloudAccount.login', exact: true })
    .find((button) => button.getAttribute('type') === 'submit')!;
  await act(async () => {
    fireEvent.click(submit);
    await loginStarted;
    view.rerender(<VisibleHost visible={false} />);
  });
  await act(async () =>
    finish({
      success: true,
      data: {
        state: 'connected',
        generation: '2',
        account: { id: '42', username: 'alice', display_name: 'Late connected', email: null },
      },
    })
  );
  expect(screen.queryByText('Late connected')).not.toBeInTheDocument();
  view.rerender(<VisibleHost visible />);
  expect(await screen.findByLabelText('settings.cloudAccount.password')).toHaveValue('');
});

it('clears ephemeral secrets in overlapping hosts when either host requests an email code', async () => {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CloudAccountProvider>
        <CloudAccount />
        <CloudAccount />
      </CloudAccountProvider>
    </SWRConfig>
  );
  await waitFor(() => expect(screen.getAllByLabelText('settings.cloudAccount.username')).toHaveLength(2));
  fireEvent.click(screen.getAllByRole('button', { name: 'settings.cloudAccount.register', exact: true })[0]);
  const emails = await screen.findAllByLabelText('settings.cloudAccount.email');
  const passwords = screen.getAllByLabelText('settings.cloudAccount.password');
  fireEvent.change(emails[0], { target: { value: 'alice@example.com' } });
  fireEvent.change(passwords[0], { target: { value: 'first-secret' } });
  fireEvent.change(passwords[1], { target: { value: 'other-secret' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'settings.cloudAccount.sendCode', exact: true })[0]);
  await waitFor(() => expect(f.request.mock.calls.some(([r]) => r.operation === 'emailCode')).toBe(true));
  expect(screen.queryByDisplayValue('other-secret')).not.toBeInTheDocument();
});

it('fences unresolved desktop identity and prefers the real WebUI owner over a late fallback', async () => {
  f.webUser = false;
  let finish: (value: { id: string }) => void = vi.fn();
  f.currentUser.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  window.electronAPI = {} as Window['electronAPI'];
  const view = mount();
  expect(await screen.findByText('settings.cloudAccount.localOwnerPending')).toBeInTheDocument();
  expect(f.request).not.toHaveBeenCalled();
  f.webUser = true;
  f.owner = 'web-owner-b';
  view.rerender(
    <SWRConfig value={{ provider: () => new Map(), onError: () => {}, shouldRetryOnError: false }}>
      <CloudAccountProvider>
        <CloudAccount />
      </CloudAccountProvider>
    </SWRConfig>
  );
  await screen.findByLabelText('settings.cloudAccount.username');
  await act(async () => finish({ id: 'desktop-owner-a' }));
  await fill('username', 'alice');
  await fill('password', 'owner-b-password');
  await click('login');
  await waitFor(() => expect(f.request.mock.calls.some(([r]) => r.operation === 'login')).toBe(true));
  expect(screen.queryByText('settings.cloudAccount.localOwnerPending')).not.toBeInTheDocument();
});

it('fails closed for unsupported anti-bot policy and omits unverified email registration', async () => {
  f.request.mockImplementation(async (r) => ({
    success: true,
    data:
      r.operation === 'capabilities'
        ? { ...capabilities, email_verification_required: false }
        : { state: 'disconnected', generation: '1' },
  }));
  mount();
  await click('register');
  expect(screen.queryByLabelText('settings.cloudAccount.email')).not.toBeInTheDocument();
  expect(screen.getByText('settings.cloudAccount.registrationEmailNote')).toBeInTheDocument();
  cleanup();
  f.request.mockImplementation(async (r) => ({
    success: true,
    data:
      r.operation === 'capabilities'
        ? {
            ...capabilities,
            anti_bot: 'unsupported_required',
            registration_enabled: false,
            password_login_enabled: false,
            password_reset_enabled: false,
            password_min_length: null,
            password_max_length: null,
          }
        : { state: 'disconnected', generation: '1' },
  }));
  mount();
  expect(await screen.findByText('settings.cloudAccount.antiBotRequired')).toBeInTheDocument();
  expect(
    screen
      .getAllByRole('button', { name: 'settings.cloudAccount.login' })
      .find((button) => button.matches('[type="submit"]'))
  ).toBeDisabled();
});

it.each(['login', 'verify'] as const)(
  'keeps completed %s ahead of older equal-generation reads while accepting later reads',
  async (operation) => {
    let reads = 0;
    let finishRead: (value: CloudAccountResponse) => void = vi.fn();
    let finishOperation: (value: CloudAccountResponse) => void = vi.fn();
    let finishCatalog: (value: CloudAccountResponse) => void = vi.fn();
    const pending: CloudSession = {
      state: 'verification_required',
      generation: '2',
      verification: {
        purpose: 'login',
        challenge_id: 'login-handle',
        expires_at: Math.floor(Date.now() / 1000) + 60,
        methods: ['totp'],
      },
    };
    let current: CloudSession = { state: 'disconnected', generation: '1' };
    f.request.mockImplementation(async (request) => {
      if (request.operation === 'capabilities') return { success: true, data: capabilities };
      if (request.operation === 'login' && operation === 'verify') return { success: true, data: pending };
      if (request.operation === operation)
        return new Promise((resolve) => {
          finishOperation = resolve;
        });
      if (request.operation === 'session' && ++reads === 2)
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      if (request.operation === 'models')
        return new Promise((resolve) => {
          finishCatalog = resolve;
        });
      return { success: true, data: current };
    });
    mount();
    await fill('username', 'alice');
    await fill('password', 'password');
    await click('login');
    if (operation === 'verify') {
      await fill('proofCode', '123456');
      await click('verify');
    }
    await waitFor(() => expect(f.request.mock.calls.some(([request]) => request.operation === operation)).toBe(true));
    await click('refresh');
    await waitFor(() => expect(reads).toBe(2));
    current = {
      state: 'connected',
      generation: '2',
      account: { id: '42', username: 'alice', display_name: 'Current Alice', email: null },
    };
    await act(async () =>
      finishOperation({ success: true, data: operation === 'login' ? current : { result: 'login', session: current } })
    );
    expect(await screen.findByText('Current Alice')).toBeInTheDocument();
    await waitFor(() => expect(f.request.mock.calls.some(([request]) => request.operation === 'models')).toBe(true));
    await act(async () =>
      finishRead({
        success: true,
        data: operation === 'login' ? { state: 'disconnected', generation: '2' } : pending,
      })
    );
    expect(screen.getByText('Current Alice')).toBeInTheDocument();
    expect(screen.queryByLabelText('settings.cloudAccount.proofCode')).not.toBeInTheDocument();
    // The catalog continuation still belongs to this operation after publication.
    await act(async () => finishCatalog({ success: false, code: 'CLOUD_TRANSPORT', error: 'PRIVATE RAW' }));
    expect(await screen.findByText('settings.cloudAccount.catalogFailed')).toBeInTheDocument();
    // A later read of this same grant is authoritative and may update the profile.
    current = { ...current, account: { ...current.account, display_name: 'Refreshed Alice' } };
    await refocus();
    expect(await screen.findByText('Refreshed Alice')).toBeInTheDocument();
    expect(reads).toBe(3);
  }
);

it.each(['login', 'verify'] as const)(
  'ignores precompletion %s read failures and reports later read failures',
  async (operation) => {
    let reads = 0;
    let finishRead: (value: CloudAccountResponse) => void = vi.fn();
    let finishOperation: (value: CloudAccountResponse) => void = vi.fn();
    const pending: CloudSession = {
      state: 'verification_required',
      generation: '2',
      verification: {
        purpose: 'login',
        challenge_id: 'login-handle',
        expires_at: Math.floor(Date.now() / 1000) + 60,
        methods: ['totp'],
      },
    };
    f.request.mockImplementation(async (request) => {
      if (request.operation === 'capabilities') return { success: true, data: capabilities };
      if (request.operation === 'login' && operation === 'verify') return { success: true, data: pending };
      if (request.operation === operation)
        return new Promise((resolve) => {
          finishOperation = resolve;
        });
      if (request.operation === 'session' && ++reads === 2)
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      if (request.operation === 'models')
        return {
          success: true,
          data: { status: 'available', models: [], quote_semantics: 'observed_rules_not_frozen_final_charge' },
        };
      if (request.operation === 'session' && reads > 2)
        return { success: false, code: 'CLOUD_TRANSPORT', error: 'later read failure' };
      return { success: true, data: { state: 'disconnected', generation: '1' } };
    });
    mount();
    await fill('username', 'alice');
    await fill('password', 'fixture-password');
    await click('login');
    if (operation === 'verify') {
      await fill('proofCode', '123456');
      await click('verify');
    }
    await waitFor(() => expect(f.request.mock.calls.some(([request]) => request.operation === operation)).toBe(true));
    await click('refresh');
    await waitFor(() => expect(reads).toBe(2));
    const connected: CloudSession = {
      state: 'connected',
      generation: '2',
      account: { id: '42', username: 'alice', display_name: 'Current Alice', email: null },
    };
    await act(async () =>
      finishOperation({
        success: true,
        data: operation === 'login' ? connected : { result: 'login', session: connected },
      })
    );
    expect(await screen.findByText('Current Alice')).toBeInTheDocument();
    await waitFor(() => expect(f.request.mock.calls.some(([request]) => request.operation === 'models')).toBe(true));
    expect(screen.queryByText('settings.cloudAccount.requestFailed')).not.toBeInTheDocument();
    await act(async () => finishRead({ success: false, code: 'CLOUD_TRANSPORT', error: 'obsolete read failure' }));
    expect(screen.getByText('Current Alice')).toBeInTheDocument();
    expect(screen.queryByText('settings.cloudAccount.requestFailed')).not.toBeInTheDocument();
    await refocus();
    expect(await screen.findByText('settings.cloudAccount.requestFailed')).toBeInTheDocument();
    expect(screen.getByText('Current Alice')).toBeInTheDocument();
    expect(reads).toBe(3);
  }
);
