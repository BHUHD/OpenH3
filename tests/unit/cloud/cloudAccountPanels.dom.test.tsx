import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import userEvent from '@testing-library/user-event';
import type {
  CloudAccountRequest,
  CloudAccountResponse,
  CloudModels,
  CloudWallet,
  CloudTopupOrder,
  CloudTopupQuote,
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
  if (r.operation === 'topupOptions')
    return { success: true, data: { status: 'unavailable', options: [], unsupported_providers: [] } };
  if (r.operation === 'topupOrders') return { success: true, data: { items: [], has_more: false, next_before_id: 0 } };
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
  const options = { name: `settings.cloudAccount.${key}`, exact: true };
  const target = screen.queryByRole('button', options) ?? (await screen.findByRole('button', options));
  await act(async () => {
    fireEvent.click(target);
  });
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

const purchaseQuote: CloudTopupQuote = {
  amount: 10,
  amount_unit: 'USD',
  payment_method: 'alipay',
  provider: 'epay_v1',
  payable_money: '71.23',
  currency: 'CNY',
  credited_quota: '5000001',
  quota_unit: 'new_api_quota',
  conversion_version: 'a'.repeat(64),
  quote_version: 'b'.repeat(64),
  fee_scope: 'gateway_payable_total',
};
function purchaseOrder(change: Partial<CloudTopupOrder> = {}): CloudTopupOrder {
  return {
    ...purchaseQuote,
    order_id: 'original-order',
    owner_id: session.account.id,
    status: 'pending',
    created_at: 123,
    completed_at: 0,
    handoff_status: 'available',
    handoff_expires_at: Math.floor(Date.now() / 1000) + 3600,
    expiry_scope: 'local_handoff_only',
    ...change,
  };
}
const purchaseRegion = () => within(screen.getByRole('region', { name: 'settings.cloudAccount.purchase' }));
const ownedRegion = () => within(screen.getByRole('region', { name: 'settings.cloudAccount.ownedOrders' }));
function purchaseResponse(r: CloudAccountRequest): CloudAccountResponse {
  if (r.operation === 'topupOptions')
    return {
      success: true,
      data: { status: 'available', options: [purchaseQuote], unsupported_providers: ['stripe'] },
    };
  if (r.operation === 'topupCreateAndOpen') return { success: true, data: purchaseOrder() };
  if (r.operation === 'topupOrders' && r.input.order_id)
    return { success: true, data: { items: [purchaseOrder()], has_more: false, next_before_id: 17 } };
  return response(r);
}
async function buy() {
  const options = { name: '10 USD / alipay' };
  const target = screen.queryByRole('radio', options) ?? (await screen.findByRole('radio', options));
  await act(async () => {
    fireEvent.click(target);
  });
  await click('confirmPurchase');
}
const creates = () => f.request.mock.calls.map(([r]) => r).filter((r) => r.operation === 'topupCreateAndOpen');
const orderReads = () =>
  f.request.mock.calls
    .map(([r]) => r)
    .filter((r) => r.operation === 'topupOrders' && r.input.order_id === 'original-order');
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('native purchase and owned orders', () => {
  let desktop: Window['electronAPI'];
  beforeEach(() => {
    desktop = window.electronAPI;
    f.request.mockImplementation(async (r) => purchaseResponse(r));
    vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: desktop, writable: true });
  });
  it('displays actual unavailable options and unsupported providers without a buy path', async () => {
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupOptions'
        ? { success: true, data: { status: 'unavailable', options: [], unsupported_providers: ['stripe', 'creem'] } }
        : response(r)
    );
    mount();
    expect(await screen.findByText('settings.cloudAccount.purchaseUnavailable')).toBeInTheDocument();
    expect(screen.getByText(/stripe, creem/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.cloudAccount.confirmPurchase' })).toBeDisabled();
    expect(creates()).toHaveLength(0);
  });
  it('renders exact amount, payment total, quota/unit, versions and fee scope from options', async () => {
    mount();
    await screen.findByRole('radio', { name: '10 USD / alipay' });
    const panel = purchaseRegion();
    for (const value of [
      '10 USD',
      '71.23 CNY',
      '5000001 new_api_quota',
      'alipay',
      'epay_v1',
      'gateway_payable_total',
      'a'.repeat(64),
      'b'.repeat(64),
    ])
      expect(panel.getByText(value, { exact: true })).toBeInTheDocument();
    expect(creates()).toHaveLength(0);
    await buy();
    expect(await panel.findByText('original-order')).toBeInTheDocument();
    expect(creates()).toHaveLength(1);
    expect(creates()[0].input.idempotency_key).toMatch(/^[a-f0-9-]{36}$/);
    expect(window.open).not.toHaveBeenCalled();
  });
  it.each(['CLOUD_TRANSPORT', 'CLOUD_AUTH_REQUIRED'])(
    'keeps ambiguous %s original key/terms, no auto retry, and deliberate new intent warning',
    async (code) => {
      f.request.mockImplementation(async (r) =>
        r.operation === 'topupCreateAndOpen'
          ? { success: false, code, error: 'RAW_PAYMENT_SECRET' }
          : purchaseResponse(r)
      );
      mount();
      await buy();
      await screen.findByText('settings.cloudAccount.purchaseAmbiguous');
      expect(creates()).toHaveLength(1);
      await click('retryPurchase');
      await waitFor(() => expect(creates()).toHaveLength(2));
      expect(creates()[1].input).toEqual(creates()[0].input);
      expect(screen.queryByText('RAW_PAYMENT_SECRET')).not.toBeInTheDocument();
      await click('refreshOrders');
      await click('changePurchase');
      expect(screen.getByText('settings.cloudAccount.newPurchaseWarning')).toBeInTheDocument();
      expect(creates()).toHaveLength(2);
      await click('startNewPurchase');
      await buy();
      expect(creates()[2].input.idempotency_key).not.toBe(creates()[0].input.idempotency_key);
    }
  );
  it('shows fresh conflict terms and requires explicit reconfirm with a new key', async () => {
    const revised = {
      ...purchaseQuote,
      payable_money: '80.45',
      credited_quota: '5000022',
      quote_version: 'c'.repeat(64),
    };
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupCreateAndOpen'
        ? { success: false, code: 'CLOUD_TOPUP_CONFLICT', error: 'SECRET' }
        : r.operation === 'topupQuote'
          ? { success: true, data: revised }
          : purchaseResponse(r)
    );
    mount();
    await buy();
    expect(await screen.findByText('80.45 CNY')).toBeInTheDocument();
    expect(creates()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'settings.cloudAccount.retryPurchase' })).toBeDisabled();
    await click('reconfirmPurchase');
    expect(creates()).toHaveLength(2);
    expect(creates()[1].input).toMatchObject({
      amount: 10,
      payment_method: 'alipay',
      quote_version: revised.quote_version,
    });
    expect(creates()[1].input.idempotency_key).not.toBe(creates()[0].input.idempotency_key);
  });
  it('retains known original order after injected native opener failure; reopens the same intent without URL exposure', async () => {
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupCreateAndOpen'
        ? { success: false, code: 'CLOUD_CHECKOUT_OPEN_FAILED', error: 'SIGNED_SECRET', order: purchaseOrder() }
        : purchaseResponse(r)
    );
    mount();
    await buy();
    expect(await purchaseRegion().findByText('original-order')).toBeInTheDocument();
    expect(screen.getByText('settings.cloudAccount.checkoutFailed')).toBeInTheDocument();
    await click('reopenCheckout');
    expect(creates()[1].input).toEqual(creates()[0].input);
    expect(document.body.innerHTML).not.toContain('SIGNED_SECRET');
    expect(window.open).not.toHaveBeenCalled();
  });
  it('requires a browser-local second click, and return/focus cannot mark paid', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupCreateAndOpen'
        ? { success: true, data: purchaseOrder({ checkout_url: 'https://pay.example/?sign=SIGNED_SECRET' }) }
        : purchaseResponse(r)
    );
    mount();
    await buy();
    await screen.findByRole('button', { name: 'settings.cloudAccount.openCheckout' });
    expect(window.open).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('SIGNED_SECRET');
    await click('openCheckout');
    expect(window.open).toHaveBeenCalledWith(
      'https://pay.example/?sign=SIGNED_SECRET',
      '_blank',
      'noopener,noreferrer'
    );
    fireEvent.focus(window);
    await waitFor(() => expect(orderReads()).toHaveLength(1));
    expect(purchaseRegion().getByText('settings.cloudAccount.order_pending')).toBeInTheDocument();
  });
  it('polls at 2/5/10 seconds, stops at 60, then manually observes late paid without local credit or task resume', async () => {
    let paid = false;
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupOrders' && r.input.order_id
        ? {
            success: true,
            data: {
              items: [purchaseOrder({ status: paid ? 'paid' : 'pending' })],
              has_more: false,
              next_before_id: 17,
            },
          }
        : purchaseResponse(r)
    );
    mount();
    await screen.findByRole('radio');
    vi.useFakeTimers();
    await buy();
    await advance(1999);
    expect(orderReads()).toHaveLength(0);
    await advance(1);
    expect(orderReads()).toHaveLength(1);
    await advance(4999);
    expect(orderReads()).toHaveLength(1);
    await advance(1);
    expect(orderReads()).toHaveLength(2);
    await advance(10000);
    expect(orderReads()).toHaveLength(3);
    await advance(43000);
    expect(orderReads()).toHaveLength(7);
    expect(screen.getByText('settings.cloudAccount.orderProcessing')).toBeInTheDocument();
    await advance(30000);
    expect(orderReads()).toHaveLength(7);
    const walletBefore = f.request.mock.calls.filter(([r]) => r.operation === 'wallet').length;
    const usageBefore = f.request.mock.calls.filter(([r]) => r.operation === 'usage').length;
    paid = true;
    await click('refreshOrder');
    await advance(0);
    expect(purchaseRegion().getByText('settings.cloudAccount.order_paid')).toBeInTheDocument();
    expect(f.request.mock.calls.filter(([r]) => r.operation === 'wallet')).toHaveLength(walletBefore + 1);
    expect(f.request.mock.calls.filter(([r]) => r.operation === 'usage')).toHaveLength(usageBefore + 1);
    expect(screen.getByText('-99999999999999999999 new_api_quota')).toBeInTheDocument();
    expect(
      f.request.mock.calls.every(([r]) =>
        [
          'wallet',
          'usage',
          'models',
          'devices',
          'session',
          'capabilities',
          'topupOptions',
          'topupCreateAndOpen',
          'topupOrders',
        ].includes(r.operation)
      )
    ).toBe(true);
    await advance(60000);
    expect(orderReads()).toHaveLength(8);
  });
  it.each(['failed', 'expired'] as const)(
    'stops for authoritative %s while manual late paid remains observable',
    async (status) => {
      let current: CloudTopupOrder['status'] = status;
      f.request.mockImplementation(async (r) =>
        r.operation === 'topupOrders' && r.input.order_id
          ? {
              success: true,
              data: {
                items: [purchaseOrder({ status: current, handoff_status: 'expired' })],
                has_more: false,
                next_before_id: 17,
              },
            }
          : purchaseResponse(r)
      );
      mount();
      await screen.findByRole('radio');
      vi.useFakeTimers();
      await buy();
      await advance(2000);
      expect(purchaseRegion().getByText(`settings.cloudAccount.order_${status}`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'settings.cloudAccount.reopenCheckout' })).toBeDisabled();
      await advance(60000);
      expect(orderReads()).toHaveLength(1);
      current = 'paid';
      await click('refreshOrder');
      await advance(0);
      expect(purchaseRegion().getByText('settings.cloudAccount.order_paid')).toBeInTheDocument();
    }
  );
  it('expires only the local handoff without cancel/refund, retains pending and permits a late paid read', async () => {
    let paid = false;
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupCreateAndOpen'
        ? { success: true, data: purchaseOrder({ handoff_expires_at: Math.floor(Date.now() / 1000) + 1 }) }
        : r.operation === 'topupOrders' && r.input.order_id && paid
          ? { success: true, data: { items: [purchaseOrder({ status: 'paid' })], has_more: false, next_before_id: 17 } }
          : purchaseResponse(r)
    );
    mount();
    await screen.findByRole('radio');
    vi.useFakeTimers();
    await buy();
    await advance(1000);
    expect(screen.getByText('settings.cloudAccount.handoffUnavailable')).toBeInTheDocument();
    expect(purchaseRegion().getByText('settings.cloudAccount.order_pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.cloudAccount.reopenCheckout' })).toBeDisabled();
    expect(creates()).toHaveLength(1);
    paid = true;
    await click('refreshOrder');
    expect(purchaseRegion().getByText('settings.cloudAccount.order_paid')).toBeInTheDocument();
  });
  it('keeps original ambiguous intent across same-generation device choose/cancel and rejects its delayed response', async () => {
    const late = deferred();
    f.request.mockImplementation((r) =>
      r.operation === 'topupCreateAndOpen' ? late.promise : Promise.resolve(purchaseResponse(r))
    );
    mount();
    await buy();
    fireEvent.click(await screen.findByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
    await click('cancel');
    await act(async () =>
      late.resolve({ success: true, data: purchaseOrder({ checkout_url: 'https://pay.example/?sign=SIGNED_SECRET' }) })
    );
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.queryByText('original-order')).not.toBeInTheDocument();
    await click('retryPurchase');
    expect(creates()[1].input).toEqual(creates()[0].input);
  });
  it('discards browser handoff on same-generation scope changes and restores it only by deliberate same-intent replay', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupCreateAndOpen'
        ? { success: true, data: purchaseOrder({ checkout_url: 'https://pay.example/?sign=SIGNED_SECRET' }) }
        : purchaseResponse(r)
    );
    mount();
    await buy();
    await screen.findByRole('button', { name: 'settings.cloudAccount.openCheckout' });
    fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
    await click('cancel');
    expect(screen.queryByRole('button', { name: 'settings.cloudAccount.openCheckout' })).not.toBeInTheDocument();
    expect(purchaseRegion().getByText('original-order')).toBeInTheDocument();
    await click('reopenCheckout');
    expect(creates()[1].input).toEqual(creates()[0].input);
    await click('openCheckout');
    expect(window.open).toHaveBeenCalledTimes(1);
  });
  it('cleans timers/inflight publication on unmount and owner replacement', async () => {
    const late = deferred();
    f.request.mockImplementation((r) =>
      r.operation === 'topupOrders' && r.input.order_id ? late.promise : Promise.resolve(purchaseResponse(r))
    );
    const view = mount();
    await screen.findByRole('radio');
    vi.useFakeTimers();
    await buy();
    await advance(2000);
    f.owner = 'b';
    view.rerender(view.tree());
    await advance(0);
    expect(screen.queryByText('original-order')).not.toBeInTheDocument();
    await act(async () =>
      late.resolve({
        success: true,
        data: { items: [purchaseOrder({ status: 'paid' })], has_more: false, next_before_id: 17 },
      })
    );
    expect(screen.queryByText('original-order')).not.toBeInTheDocument();
    view.unmount();
    const before = f.request.mock.calls.length;
    await advance(120000);
    expect(f.request).toHaveBeenCalledTimes(before);
  });
  it('rejects delayed A create after browser owner or same-owner generation replacement', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
    const late = deferred();
    let current = session;
    f.request.mockImplementation((r) =>
      r.operation === 'topupCreateAndOpen'
        ? late.promise
        : r.operation === 'session'
          ? Promise.resolve({ success: true, data: current })
          : Promise.resolve(purchaseResponse(r))
    );
    mount();
    await buy();
    current = { ...session, generation: '2', account: { ...session.account, display_name: 'Relogged Alice' } };
    await click('refresh');
    await screen.findByText('Relogged Alice');
    await act(async () =>
      late.resolve({ success: true, data: purchaseOrder({ checkout_url: 'https://pay.example/?sign=SIGNED_SECRET' }) })
    );
    expect(screen.queryByRole('button', { name: 'settings.cloudAccount.openCheckout' })).not.toBeInTheDocument();
    expect(screen.queryByText('original-order')).not.toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });
  it('uses actual owned cursor/filter semantics, resets cursor and rejects stale pages', async () => {
    const late = deferred();
    f.request.mockImplementation((r) =>
      r.operation === 'topupOrders'
        ? r.input.before_id
          ? late.promise
          : Promise.resolve({
              success: true,
              data: {
                items: [purchaseOrder({ order_id: r.input.order_id || 'first-order' })],
                has_more: true,
                next_before_id: 93,
              },
            })
        : Promise.resolve(purchaseResponse(r))
    );
    mount();
    await screen.findByText('first-order');
    await click('moreOrders');
    expect(f.request).toHaveBeenCalledWith({ operation: 'topupOrders', input: { page_size: 20, before_id: 93 } });
    fireEvent.change(ownedRegion().getByLabelText('settings.cloudAccount.orderId'), {
      target: { value: 'filtered-order' },
    });
    await click('applyOrderFilters');
    await ownedRegion().findByText('filtered-order');
    expect(f.request).toHaveBeenCalledWith({
      operation: 'topupOrders',
      input: { order_id: 'filtered-order', page_size: 20 },
    });
    await act(async () =>
      late.resolve({
        success: true,
        data: { items: [purchaseOrder({ order_id: 'stale-order' })], has_more: false, next_before_id: 17 },
      })
    );
    expect(screen.queryByText('stale-order')).not.toBeInTheDocument();
    expect(ownedRegion().getByText('filtered-order')).toBeInTheDocument();
    fireEvent.change(ownedRegion().getByLabelText('settings.cloudAccount.orderPageSize'), { target: { value: '51' } });
    await click('applyOrderFilters');
    const requests = f.request.mock.calls.map(([r]) => r).filter((r) => r.operation === 'topupOrders');
    expect(requests.every((r) => (r.input.page_size ?? 20) <= 50)).toBe(true);
  });
  it('applies status filters with no old cursor and renders empty, stale, and unavailable history truthfully', async () => {
    let unavailable = false;
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupOrders'
        ? unavailable
          ? { success: false, code: 'CLOUD_TRANSPORT', error: 'RAW_ORDER_SECRET' }
          : { success: true, data: { items: [], has_more: false, next_before_id: 0 } }
        : purchaseResponse(r)
    );
    mount();
    await screen.findByText('settings.cloudAccount.emptyOrders');
    fireEvent.click(ownedRegion().getByRole('combobox'));
    fireEvent.click(await screen.findByText('settings.cloudAccount.order_paid', { selector: '.arco-select-option' }));
    await click('applyOrderFilters');
    expect(f.request).toHaveBeenCalledWith({ operation: 'topupOrders', input: { page_size: 20, status: 'paid' } });
    unavailable = true;
    await click('refreshOrders');
    await waitFor(() => expect(ownedRegion().getByText('settings.cloudAccount.stale')).toBeInTheDocument());
    fireEvent.change(ownedRegion().getByLabelText('settings.cloudAccount.orderId'), {
      target: { value: 'unknown-order' },
    });
    await click('applyOrderFilters');
    await waitFor(() => expect(ownedRegion().getByText('settings.cloudAccount.readFailed')).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain('RAW_ORDER_SECRET');
  });
  it('permits keyboard selection and confirmation without launching checkout', async () => {
    const user = userEvent.setup();
    mount();
    const radio = await screen.findByRole('radio', { name: '10 USD / alipay' });
    radio.focus();
    await user.keyboard(' ');
    const confirm = screen.getByRole('button', { name: 'settings.cloudAccount.confirmPurchase' });
    expect(confirm).toBeEnabled();
    confirm.focus();
    await user.keyboard('{Enter}');
    await purchaseRegion().findByText('original-order');
    expect(creates()).toHaveLength(1);
    expect(window.open).not.toHaveBeenCalled();
  });
  it('does not create without secure key generation', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable');
    });
    mount();
    await buy();
    expect(creates()).toHaveLength(0);
    expect(screen.getByText('settings.cloudAccount.purchaseUnavailable')).toBeInTheDocument();
  });
  it('cleans polling on logout and same-owner generation replacement', async () => {
    let current: CloudAccountResponse = { success: true, data: session };
    f.request.mockImplementation(async (r) => {
      if (r.operation === 'session') return current;
      if (r.operation === 'logout') {
        current = { success: true, data: { state: 'disconnected', generation: '3' } };
        return { success: true, data: { remote_revocation: 'confirmed' } };
      }
      return purchaseResponse(r);
    });
    mount();
    await screen.findByRole('radio');
    vi.useFakeTimers();
    await buy();
    current = { success: true, data: { ...session, generation: '2' } };
    await click('refresh');
    await advance(0);
    expect(screen.queryByText('original-order')).not.toBeInTheDocument();
    await advance(10000);
    expect(orderReads()).toHaveLength(0);
    await buy();
    await click('logout');
    await advance(0);
    expect(screen.queryByRole('region', { name: 'settings.cloudAccount.purchase' })).not.toBeInTheDocument();
    const before = orderReads().length;
    await advance(60000);
    expect(orderReads()).toHaveLength(before);
  });
  it('never lets a stale pending read replace observed paid', async () => {
    const pending = deferred();
    let reads = 0;
    f.request.mockImplementation((r) =>
      r.operation === 'topupOrders' && r.input.order_id
        ? ++reads === 1
          ? pending.promise
          : Promise.resolve({
              success: true,
              data: { items: [purchaseOrder({ status: 'paid' })], has_more: false, next_before_id: 17 },
            })
        : Promise.resolve(purchaseResponse(r))
    );
    mount();
    await buy();
    await screen.findByText('original-order');
    await click('refreshOrder');
    await click('refreshOrder');
    await purchaseRegion().findByText('settings.cloudAccount.order_paid');
    await act(async () =>
      pending.resolve({ success: true, data: { items: [purchaseOrder()], has_more: false, next_before_id: 17 } })
    );
    expect(purchaseRegion().getByText('settings.cloudAccount.order_paid')).toBeInTheDocument();
  });
  it('refreshes authoritative billing when a deliberate same-intent reopen discovers paid', async () => {
    let reopened = false;
    f.request.mockImplementation(async (r) =>
      r.operation === 'topupCreateAndOpen'
        ? { success: true, data: purchaseOrder({ status: reopened ? 'paid' : 'pending' }) }
        : purchaseResponse(r)
    );
    mount();
    await buy();
    const wallets = f.request.mock.calls.filter(([r]) => r.operation === 'wallet').length;
    reopened = true;
    await click('reopenCheckout');
    await purchaseRegion().findByText('settings.cloudAccount.order_paid');
    await waitFor(() =>
      expect(f.request.mock.calls.filter(([r]) => r.operation === 'wallet')).toHaveLength(wallets + 1)
    );
    expect(creates()[1].input).toEqual(creates()[0].input);
  });
  it('stops continuous checks at 60 seconds even while the owned read is unresolved', async () => {
    const late = deferred();
    f.request.mockImplementation((r) =>
      r.operation === 'topupOrders' && r.input.order_id ? late.promise : Promise.resolve(purchaseResponse(r))
    );
    mount();
    await screen.findByRole('radio');
    vi.useFakeTimers();
    await buy();
    await advance(60000);
    expect(orderReads()).toHaveLength(1);
    expect(screen.getByText('settings.cloudAccount.orderProcessing')).toBeInTheDocument();
    await act(async () =>
      late.resolve({ success: true, data: { items: [purchaseOrder()], has_more: false, next_before_id: 17 } })
    );
    await advance(60000);
    expect(orderReads()).toHaveLength(1);
  });
  it('offers no browser second-click handoff if no validated checkout URL was returned', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
    mount();
    await buy();
    expect(await screen.findByText('settings.cloudAccount.checkoutFailed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.cloudAccount.openCheckout' })).not.toBeInTheDocument();
    expect(purchaseRegion().getByText('original-order')).toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });
  it('cannot transfer delayed browser purchase A into local owner B', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
    const late = deferred();
    f.request.mockImplementation((r) =>
      r.operation === 'topupCreateAndOpen' ? late.promise : Promise.resolve(purchaseResponse(r))
    );
    const view = mount();
    await buy();
    f.owner = 'b';
    view.rerender(view.tree());
    await act(async () =>
      late.resolve({
        success: true,
        data: purchaseOrder({
          owner_id: 'original-cloud-owner',
          checkout_url: 'https://pay.example/?sign=SIGNED_SECRET',
        }),
      })
    );
    expect(screen.queryByText('original-cloud-owner')).not.toBeInTheDocument();
    expect(screen.queryByText('original-order')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.cloudAccount.openCheckout' })).not.toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(1);
  });
  it('retains paid when a delayed same-intent create snapshot returns pending', async () => {
    const late = deferred();
    let attempts = 0;
    f.request.mockImplementation((r) =>
      r.operation === 'topupCreateAndOpen'
        ? ++attempts === 2
          ? late.promise
          : Promise.resolve(purchaseResponse(r))
        : r.operation === 'topupOrders' && r.input.order_id
          ? Promise.resolve({
              success: true,
              data: { items: [purchaseOrder({ status: 'paid' })], has_more: false, next_before_id: 17 },
            })
          : Promise.resolve(purchaseResponse(r))
    );
    mount();
    await buy();
    await click('reopenCheckout');
    await click('refreshOrder');
    await purchaseRegion().findByText('settings.cloudAccount.order_paid');
    await act(async () => late.resolve({ success: true, data: purchaseOrder() }));
    expect(purchaseRegion().getByText('settings.cloudAccount.order_paid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.cloudAccount.reopenCheckout' })).toBeDisabled();
  });
  it('does not restart the 60 second polling window after same-generation dialog scope changes', async () => {
    mount();
    await screen.findByRole('radio');
    vi.useFakeTimers();
    await buy();
    await advance(60000);
    const reads = orderReads().length;
    fireEvent.click(screen.getByRole('button', { name: 'settings.cloudAccount.revoke Laptop' }));
    await click('cancel');
    await advance(30000);
    expect(orderReads()).toHaveLength(reads);
    expect(screen.getByText('settings.cloudAccount.orderProcessing')).toBeInTheDocument();
    await click('refreshOrder');
    expect(orderReads()).toHaveLength(reads + 1);
  });
});
