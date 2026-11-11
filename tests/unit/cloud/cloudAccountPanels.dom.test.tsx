import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type {
  CloudAccountRequest,
  CloudAccountResponse,
  CloudModels,
  CloudWallet,
} from '@/common/types/platform/cloudAccount';
const f = vi.hoisted(() => ({
  owner: 'a',
  request: vi.fn<(r: CloudAccountRequest) => Promise<CloudAccountResponse>>(),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: f.owner } }),
}));
vi.mock('@/renderer/components/settings/SettingsModal/CloudAccount/transport', () => ({
  requestCloudAccount: f.request,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
import { CloudAccountProvider } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import CloudAccount from '@/renderer/components/settings/SettingsModal/CloudAccount';
const wallet: CloudWallet = {
  read_started_at: 1700000000,
  as_of: 1700000001,
  wallet_balance: { status: 'available', amount: { amount: '-99999999999999999999', unit: 'new_api_quota' } },
  device_limit: { status: 'limited', amount: { amount: '999', unit: 'new_api_quota' } },
  billing_preference: 'subscription_first',
  subscriptions: {
    status: 'available',
    items: [
      {
        id: 'sub-1',
        allowance_state: 'committed_snapshot',
        remaining: { amount: '42', unit: 'new_api_quota' },
        used: { amount: '2', unit: 'new_api_quota' },
        unlimited: false,
        expires_at: 1700000100,
        next_reset_at: 1700000050,
        allow_wallet_overflow: true,
      },
    ],
  },
};
const session = {
  state: 'connected' as const,
  generation: '1',
  account: { id: '42', username: 'alice', display_name: 'Alice', email: null },
};
const catalogModel: CloudModels['models'][number] = {
  model_id: 'duplicate',
  display_name: 'Duplicate',
  provider: 'official',
  purpose: 'text',
  protocol: 'Responses',
  input_capabilities: ['text'],
  supports_tools: false,
  context_limit: 4000,
  max_output_tokens: 100,
  compatibility_version: 'v1',
  evidence: 'gateway',
  selection_unavailable_reason: 'ambiguous_model_protocol',
  quotes: [
    {
      group: 'default',
      kind: 'token',
      unit: 'USD_per_million_tokens',
      group_ratio: '1',
      input: '0.012345',
      output: '0.5',
      cache_read: '0.001',
      cache_write: '0.002',
      cache_write_1h: '0.003',
      cache_write_12h: '0.004',
      cache_write_mode: 'claude_ttl',
      version: 'rules-v1',
      quota_per_usd: '500000',
    },
    {
      group: 'request',
      kind: 'request',
      unit: 'USD_per_request',
      group_ratio: '1',
      cache_write_mode: 'none',
      per_request: '0.004',
      version: 'rules-v1',
      quota_per_usd: '500000',
    },
    {
      group: 'expression',
      kind: 'dynamic_expression',
      unit: 'USD_by_effective_expression',
      group_ratio: '1',
      cache_write_mode: 'none',
      version: 'rules-v1',
      quota_per_usd: '500000',
      function_surcharges_usd_per_1000_calls: { web_search: '10.25' },
      expression: 'tokens * 0.00001',
      expression_semantics: 'mature_billing_engine_versioned_expression_then_group_ratio_and_quota_conversion',
      conditional_violation_surcharge: {
        usd: '2.75',
        condition: 'existing_violation_fee_signal_after_normal_refund_quota_rounding_applies',
      },
    },
  ],
};
function response(r: CloudAccountRequest): CloudAccountResponse {
  if (r.operation === 'session') return { success: true, data: session };
  if (r.operation === 'capabilities')
    return {
      success: true,
      data: {
        availability: 'available',
        registration_enabled: true,
        email_verification_required: false,
        password_login_enabled: true,
        password_reset_enabled: true,
        anti_bot: 'not_required',
        password_min_length: 8,
        password_max_length: 128,
      },
    };
  if (r.operation === 'wallet') return { success: true, data: wallet };
  if (r.operation === 'devices')
    return {
      success: true,
      data: {
        items: [
          {
            id: 'current',
            label: 'This desktop',
            current: true,
            status: 'active',
            created_at: 1,
            last_active_at: 2,
            expires_at: 3,
          },
          {
            id: 'other',
            label: 'Laptop',
            current: false,
            status: 'active',
            created_at: 1,
            last_active_at: 2,
            expires_at: 3,
          },
        ],
      },
    };
  if (r.operation === 'models')
    return {
      success: true,
      data: {
        status: 'available',
        quote_semantics: 'observed_rules_not_frozen_final_charge',
        models: [catalogModel, { ...catalogModel, protocol: 'ChatCompletions' }],
      },
    };
  if (r.operation === 'usage')
    return {
      success: true,
      data: {
        read_started_at: 1700000000,
        as_of: 1700000001,
        status: 'available',
        completeness: 'not_reconciled',
        page: r.input.page ?? 1,
        page_size: r.input.page_size ?? 20,
        has_more: true,
        items: [
          {
            id: 'refund',
            created_at: 1700000001,
            kind: 'refund',
            direction: 'credit',
            quota: { amount: '123400', unit: 'new_api_quota' },
            model: 'actual-model',
            prompt_tokens: '999',
            completion_tokens: '1',
            request_id: 'req-actual',
            device_id: 'other',
            funding: { billing_source: 'wallet', wallet_quota_deducted: '123400' },
          },
        ],
      },
    };
  return { success: true, data: { status: 'revoked' } };
}
function mount() {
  const cache = new Map();
  const tree = () => (
    <SWRConfig value={{ provider: () => cache, shouldRetryOnError: false, onError: () => {} }}>
      <CloudAccountProvider>
        <CloudAccount />
      </CloudAccountProvider>
    </SWRConfig>
  );
  return { ...render(tree()), tree };
}
async function click(key: string) {
  fireEvent.click(await screen.findByRole('button', { name: `settings.cloudAccount.${key}`, exact: true }));
}
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })),
  });
  f.owner = 'a';
  f.request.mockReset().mockImplementation(async (r) => response(r));
});
afterEach(() => cleanup());
it('shows exact signed wallet and separate subscription and device limits with original timestamps', async () => {
  mount();
  expect(await screen.findByText('-99999999999999999999 new_api_quota')).toBeInTheDocument();
  expect(screen.getByText('999 new_api_quota')).toBeInTheDocument();
  expect(screen.getByText('42 new_api_quota')).toBeInTheDocument();
  expect(screen.getAllByText('1700000001').length).toBeGreaterThan(0);
});
it('retains failed same-session wallet as visibly stale and clears on owner replacement before late result', async () => {
  const view = mount();
  await screen.findByText('-99999999999999999999 new_api_quota');
  f.request.mockImplementation(async (r) =>
    r.operation === 'wallet' ? { success: false, code: 'CLOUD_TRANSPORT', error: 'RAW SECRET' } : response(r)
  );
  await click('refreshWallet');
  expect(await screen.findByText('settings.cloudAccount.stale')).toBeInTheDocument();
  expect(screen.getByText('-99999999999999999999 new_api_quota')).toBeInTheDocument();
  f.owner = 'b';
  f.request.mockImplementation((r) =>
    r.operation === 'wallet' ? new Promise(() => {}) : Promise.resolve(response(r))
  );
  view.rerender(view.tree());
  expect(screen.queryByText('-99999999999999999999 new_api_quota')).not.toBeInTheDocument();
  expect(screen.queryByText('RAW SECRET')).not.toBeInTheDocument();
});
it('uses validated filters, resets page, and displays refund/request association without task totals', async () => {
  mount();
  await screen.findByText('req-actual');
  expect(screen.getByText('123400 new_api_quota')).toBeInTheDocument();
  expect(screen.getByText('settings.cloudAccount.credit')).toBeInTheDocument();
  expect(screen.getByText('settings.cloudAccount.not_reconciled')).toBeInTheDocument();
  await click('nextPage');
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith({ operation: 'usage', input: { page: 2, page_size: 20 } })
  );
  fireEvent.change(screen.getByLabelText('settings.cloudAccount.filterModel'), { target: { value: 'new-model' } });
  await click('applyFilters');
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith({
      operation: 'usage',
      input: { page: 1, page_size: 20, model: 'new-model' },
    })
  );
  expect(screen.getByText('settings.cloudAccount.noTaskAccounting')).toBeInTheDocument();
});
it('requires deliberate revoke and purpose-bound proof; cancellation clears proof and target', async () => {
  f.request.mockImplementation(async (r) =>
    r.operation === 'revokeDevice'
      ? {
          success: true,
          data: {
            status: 'verification_required',
            verification: {
              purpose: 'device_revocation',
              challenge_id: 'revoke-proof',
              expires_at: Date.now() / 1000 + 60,
              methods: ['password'],
            },
          },
        }
      : response(r)
  );
  mount();
  await screen.findByText('Laptop');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
  expect(f.request.mock.calls.some(([r]) => r.operation === 'revokeDevice')).toBe(false);
  await click('confirmRevoke');
  const secret = await screen.findByLabelText('settings.cloudAccount.password');
  fireEvent.change(secret, { target: { value: 'transient' } });
  await click('cancel');
  expect(screen.queryByDisplayValue('transient')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'settings.cloudAccount.confirmRevoke' })).not.toBeInTheDocument();
});
it('explains ambiguous protocol catalog without offering a callable selection', async () => {
  mount();
  expect((await screen.findAllByText('settings.cloudAccount.ambiguous_model_protocol')).length).toBe(2);
  expect(screen.getByText('Responses')).toBeInTheDocument();
  expect(screen.getByText('ChatCompletions')).toBeInTheDocument();
  expect(screen.getAllByText('0.012345')).toHaveLength(2);
  expect(screen.getAllByText('tokens * 0.00001')).toHaveLength(2);
  expect(screen.getAllByText('web_search: 10.25')).toHaveLength(2);
  expect(screen.getAllByText('settings.cloudAccount.conditionNotice')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /duplicate/ })).not.toBeInTheDocument();
  expect(screen.getByText('settings.cloudAccount.quoteNotice')).toBeInTheDocument();
});
function deferred() {
  let resolve: (r: CloudAccountResponse) => void = vi.fn();
  const promise = new Promise<CloudAccountResponse>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it('rejects stale usage filter/page results and validates UTF8 and ordered times', async () => {
  const late = deferred();
  f.request.mockImplementation((r) =>
    r.operation === 'usage' && r.input.page === 2 ? late.promise : Promise.resolve(response(r))
  );
  mount();
  await screen.findByText('req-actual');
  await click('nextPage');
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith({ operation: 'usage', input: { page: 2, page_size: 20 } })
  );
  fireEvent.change(screen.getByLabelText('settings.cloudAccount.filterModel'), { target: { value: '界'.repeat(86) } });
  expect(screen.getByRole('button', { name: 'settings.cloudAccount.applyFilters' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('settings.cloudAccount.filterModel'), { target: { value: 'fresh' } });
  await click('applyFilters');
  await screen.findByText('req-actual');
  await act(async () =>
    late.resolve({
      success: true,
      data: {
        read_started_at: 1,
        as_of: 2,
        status: 'available',
        completeness: 'not_reconciled',
        page: 2,
        page_size: 20,
        has_more: false,
        items: [
          {
            id: 'old',
            created_at: 1,
            kind: 'consume',
            direction: 'debit',
            quota: null,
            model: 'old-filter',
            prompt_tokens: '0',
            completion_tokens: '0',
            request_id: 'old-request',
          },
        ],
      },
    })
  );
  expect(screen.queryByText('old-request')).not.toBeInTheDocument();
});
it('rejects a delayed old grant wallet after same-account generation replacement', async () => {
  const late = deferred();
  let current = session;
  let walletCalls = 0;
  f.request.mockImplementation((r) =>
    r.operation === 'session'
      ? Promise.resolve({ success: true, data: current })
      : r.operation === 'wallet' && ++walletCalls === 1
        ? late.promise
        : Promise.resolve(response(r))
  );
  mount();
  await screen.findByText('Alice');
  current = { ...session, generation: '2', account: { ...session.account, display_name: 'Relogged Alice' } };
  await click('refresh');
  await screen.findByText('Relogged Alice');
  await act(async () =>
    late.resolve({
      success: true,
      data: { ...wallet, wallet_balance: { status: 'available', amount: { amount: '111111', unit: 'new_api_quota' } } },
    })
  );
  expect(screen.queryByText('111111 new_api_quota')).not.toBeInTheDocument();
});
it('keeps unconfirmed current revoke connected, then confirmed removal clears official identity without retry', async () => {
  let confirmed = false;
  f.request.mockImplementation(async (r) =>
    r.operation === 'revokeDevice'
      ? confirmed
        ? { success: true, data: { status: 'revoked' } }
        : { success: false, code: 'CLOUD_TRANSPORT', error: 'SECRET' }
      : response(r)
  );
  mount();
  await screen.findByText('This desktop');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke This desktop' }));
  await click('confirmRevoke');
  await screen.findByText('settings.cloudAccount.requestFailed');
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(f.request.mock.calls.filter(([r]) => r.operation === 'revokeDevice')).toHaveLength(1);
  confirmed = true;
  await click('confirmRevoke');
  await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
  expect(await screen.findByText('settings.cloudAccount.deviceRevoked')).toBeInTheDocument();
});
it('cannot authorize a different-purpose challenge', async () => {
  f.request.mockImplementation(async (r) =>
    r.operation === 'revokeDevice'
      ? {
          success: true,
          data: {
            status: 'verification_required',
            verification: {
              purpose: 'login',
              challenge_id: 'wrong',
              expires_at: Date.now() / 1000 + 60,
              methods: ['totp'],
            },
          },
        }
      : r.operation === 'verify'
        ? { success: true, data: { result: 'device_revoked' } }
        : response(r)
  );
  mount();
  await screen.findByText('Laptop');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
  await click('confirmRevoke');
  expect(await screen.findByText('settings.cloudAccount.unsupported')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'settings.cloudAccount.verify' })).toBeDisabled();
});
it('clears target and proof on owner switch; delayed revoke A cannot clear connected B', async () => {
  const late = deferred();
  f.request.mockImplementation((r) => (r.operation === 'revokeDevice' ? late.promise : Promise.resolve(response(r))));
  const view = mount();
  await screen.findByText('This desktop');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke This desktop' }));
  await click('confirmRevoke');
  f.owner = 'b';
  view.rerender(view.tree());
  await screen.findByText('Alice');
  await act(async () => late.resolve({ success: true, data: { status: 'revoked' } }));
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'settings.cloudAccount.confirmRevoke' })).not.toBeInTheDocument();
});
it('shows unavailable wallet/usage and empty log pages as unknown accounting, without raw reasons', async () => {
  f.request.mockImplementation(async (r) =>
    r.operation === 'wallet'
      ? {
          success: true,
          data: {
            ...wallet,
            wallet_balance: { status: 'unavailable', reason: 'batch_updates_enabled' },
            device_limit: { status: 'unlimited' },
            subscriptions: { status: 'unavailable', items: [] },
          },
        }
      : r.operation === 'usage'
        ? {
            success: true,
            data: {
              read_started_at: 1,
              as_of: 2,
              status: 'unavailable',
              reason: 'SECRET_RAW_REASON',
              completeness: 'not_reconciled',
              page: 1,
              page_size: 20,
              has_more: false,
              items: [],
            },
          }
        : response(r)
  );
  mount();
  expect(await screen.findByText('settings.cloudAccount.batch_updates_enabled')).toBeInTheDocument();
  expect(screen.getByText('settings.cloudAccount.unlimited')).toBeInTheDocument();
  expect(screen.getByText('settings.cloudAccount.emptyUsage')).toBeInTheDocument();
  expect(screen.queryByText('SECRET_RAW_REASON')).not.toBeInTheDocument();
});
it('finishes other-device proof once and renders the refreshed authoritative device list', async () => {
  let confirmed = false;
  f.request.mockImplementation(async (r) => {
    if (r.operation === 'revokeDevice')
      return {
        success: true,
        data: {
          status: 'verification_required',
          verification: {
            purpose: 'device_revocation',
            challenge_id: 'proof-other',
            expires_at: Date.now() / 1000 + 60,
            methods: ['password'],
          },
        },
      };
    if (r.operation === 'verify') {
      confirmed = true;
      return { success: true, data: { result: 'device_revoked' } };
    }
    if (r.operation === 'devices' && confirmed)
      return {
        success: true,
        data: {
          items: [
            {
              id: 'other',
              label: 'Laptop confirmed',
              current: false,
              status: 'revoked',
              created_at: 1,
              last_active_at: 2,
              expires_at: 3,
            },
          ],
        },
      };
    return response(r);
  });
  mount();
  await screen.findByText('Laptop');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
  await click('confirmRevoke');
  fireEvent.change(await screen.findByLabelText('settings.cloudAccount.password'), {
    target: { value: 'proof-secret' },
  });
  await click('verify');
  expect(await screen.findByText('Laptop confirmed')).toBeInTheDocument();
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('proof-secret')).not.toBeInTheDocument();
  expect(f.request.mock.calls.filter(([r]) => r.operation === 'verify')).toHaveLength(1);
});
it('settles a login catalog interrupted by opening and cancelling a device dialog, then permits explicit refresh', async () => {
  const original = deferred();
  let loggedIn = false;
  let catalogs = 0;
  f.request.mockImplementation((r) => {
    if (r.operation === 'session' && !loggedIn)
      return Promise.resolve({ success: true, data: { state: 'disconnected', generation: '0' } });
    if (r.operation === 'login') {
      loggedIn = true;
      return Promise.resolve({ success: true, data: session });
    }
    if (r.operation === 'models' && ++catalogs === 1) return original.promise;
    return Promise.resolve(response(r));
  });
  mount();
  fireEvent.change(await screen.findByLabelText('settings.cloudAccount.username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('settings.cloudAccount.password'), { target: { value: 'password' } });
  await click('login');
  await screen.findByText('Laptop');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
  await click('cancel');
  await act(async () => original.resolve({ success: false, code: 'CLOUD_TRANSPORT', error: 'OLD SECRET' }));
  await screen.findByText('Responses');
  const before = catalogs;
  await click('refreshCatalog');
  await waitFor(() => expect(catalogs).toBe(before + 1));
  expect(screen.queryByText('settings.cloudAccount.catalogFailed')).not.toBeInTheDocument();
  expect(screen.queryByText('OLD SECRET')).not.toBeInTheDocument();
});
it('permits a new catalog refresh when a same-session device action supersedes a pending refresh', async () => {
  const original = deferred();
  let catalogs = 0;
  f.request.mockImplementation((r) =>
    r.operation === 'models' && ++catalogs === 2 ? original.promise : Promise.resolve(response(r))
  );
  mount();
  await screen.findByText('Responses');
  await click('refreshCatalog');
  fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
  await click('cancel');
  await act(async () => original.resolve({ success: false, code: 'CLOUD_TRANSPORT', error: 'OLD SECRET' }));
  await click('refreshCatalog');
  await waitFor(() => expect(catalogs).toBe(3));
  expect(screen.getByText('Responses')).toBeInTheDocument();
  expect(screen.queryByText('settings.cloudAccount.catalogFailed')).not.toBeInTheDocument();
});
