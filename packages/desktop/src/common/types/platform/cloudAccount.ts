export type CloudCapabilities = {
  availability: 'disabled' | 'unconfigured' | 'available';
  registration_enabled: boolean;
  email_verification_required: boolean;
  password_login_enabled: boolean;
  password_reset_enabled: boolean;
  anti_bot: 'not_required' | 'unsupported_required';
  password_min_length: number | null;
  password_max_length: number | null;
};

/** Renderer-safe native account operations; no URL, headers or owner inputs. */
export type CloudAccountRequest =
  | { operation: 'capabilities' | 'session' | 'me' | 'devices' | 'logout' | 'wallet' | 'models' | 'topupOptions' }
  | {
      operation: 'usage';
      input: {
        page?: number;
        page_size?: number;
        start_time?: number;
        end_time?: number;
        model?: string;
        device_id?: string;
      };
    }
  | { operation: 'topupQuote'; input: { amount: number; payment_method: string } }
  | { operation: 'topupCreate' | 'topupCreateAndOpen'; input: CloudTopupCreateInput }
  | {
      operation: 'topupOrders';
      input: {
        order_id?: string;
        before_id?: number;
        page_size?: number;
        status?: '' | 'pending' | 'paid' | 'failed' | 'expired';
      };
    }
  | { operation: 'emailCode'; input: { email: string; purpose: 'registration' | 'password_reset' } }
  | { operation: 'register'; input: { username: string; email: string; password: string; verification_code?: string } }
  | { operation: 'login'; input: { username: string; password: string } }
  | {
      operation: 'verify';
      input: { challenge_id: string } & (
        | { method: 'totp' | 'backup_code'; code: string }
        | { method: 'password'; password: string }
      );
    }
  | { operation: 'passwordReset'; input: { email: string; code: string } }
  | { operation: 'passwordResetComplete'; input: { challenge_id: string; new_password: string } }
  | { operation: 'revokeDevice'; input: { device_id: string } };

export type CloudProfile = { id: string; username: string; display_name: string; email: string | null };
export type CloudVerification = {
  purpose: 'login' | 'password_reset' | 'device_revocation';
  challenge_id: string;
  expires_at: number;
  methods: ('totp' | 'backup_code' | 'password')[];
};
export type CloudSession =
  | { state: 'disabled' | 'unconfigured' }
  | { state: 'disconnected' | 'reauth_required'; generation: string }
  | { state: 'connected'; generation: string; account: CloudProfile }
  | { state: 'verification_required'; generation: string; verification: CloudVerification };
export type CloudAccountData =
  | CloudTopupQuote
  | CloudTopupOrder
  | CloudTopupOptions
  | CloudTopupOrders
  | CloudSession
  | CloudWallet
  | CloudModels
  | CloudUsage
  | CloudCapabilities
  | { status: 'registered' | 'revoked' }
  | { status: 'ready'; challenge_id: string; expires_at: number }
  | { status: 'verification_required'; verification: CloudVerification }
  | { result: 'login'; session: CloudSession }
  | { result: 'password_reset_ready'; challenge_id: string; expires_at: number }
  | { result: 'device_revoked' }
  | { session_cleanup_pending: boolean }
  | { remote_revocation: 'confirmed' | 'unconfirmed' | 'not_needed' }
  | {
      items: {
        id: string;
        label: string;
        current: boolean;
        status: 'active' | 'revoked' | 'expired';
        created_at: number;
        last_active_at: number;
        expires_at: number;
      }[];
    }
  | null;
/** Sanitized result shared by preload and the main-process bridge. */
export type CloudAccountResponse =
  | { success: true; data: CloudAccountData }
  | {
      success: false;
      error: string;
      code: string;
      retry_after?: number;
      details?: { retry_after: number };
      order?: Omit<CloudTopupOrder, 'checkout_url'>;
    };

export type CloudQuota = {
  amount: string;
  unit: string;
  display_amount?: { amount: string; currency: 'USD' };
};
export type CloudQuotaView = { status: string; amount?: CloudQuota; reason?: string };
export type CloudWallet = {
  read_started_at: number;
  as_of: number;
  wallet_balance: CloudQuotaView;
  device_limit: CloudQuotaView;
  billing_preference: string;
  subscriptions: {
    status: string;
    items: {
      allowance_state: string;
      id: string;
      remaining?: CloudQuota;
      unlimited: boolean;
      used: CloudQuota;
      expires_at: number;
      next_reset_at: number;
      allow_wallet_overflow: boolean;
    }[];
  };
};
export type CloudPriceQuote = {
  group: string;
  kind: string;
  unit: string;
  group_ratio: string;
  input?: string;
  output?: string;
  cache_read?: string;
  cache_write?: string;
  cache_write_1h?: string;
  cache_write_12h?: string;
  cache_write_mode: string;
  per_request?: string;
  version: string;
  quota_per_usd: string;
  function_surcharges_usd_per_1000_calls?: Record<string, string>;
  implied_search_usd_per_request?: string;
  expression?: string;
  expression_semantics?: string;
  conditional_violation_surcharge?: { usd: string; condition: string };
};
export type CloudModel = {
  model_id: string;
  display_name: string;
  provider: string;
  purpose: string;
  protocol: string;
  input_capabilities: string[];
  supports_tools: boolean;
  context_limit: number;
  max_output_tokens: number;
  compatibility_version: string;
  evidence: string;
  quotes: CloudPriceQuote[];
  selection_unavailable_reason?: string;
};
export type CloudModels = { status: string; reason?: string; quote_semantics: string; models: CloudModel[] };
export type CloudUsage = {
  read_started_at: number;
  as_of: number;
  status: string;
  reason?: string;
  completeness: string;
  page: number;
  page_size: number;
  has_more: boolean;
  items:
    | {
        id: string;
        created_at: number;
        kind: string;
        quota: CloudQuota | null;
        direction: string;
        model: string;
        prompt_tokens: string;
        completion_tokens: string;
        request_id: string;
        token_id?: string;
        device_id?: string;
        funding?: Partial<
          Record<
            | 'billing_source'
            | 'billing_preference'
            | 'subscription_id'
            | 'subscription_plan_id'
            | 'subscription_pre_consumed'
            | 'subscription_post_delta'
            | 'subscription_total'
            | 'subscription_used'
            | 'subscription_remain'
            | 'subscription_consumed'
            | 'wallet_quota_deducted',
            string
          >
        >;
      }[]
    | null;
};

export type CloudTopupCreateInput = {
  amount: number;
  payment_method: string;
  quote_version: string;
  idempotency_key: string;
};
export type CloudTopupQuote = {
  amount: number;
  amount_unit: 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM';
  payment_method: string;
  provider: 'epay_v1';
  payable_money: string;
  currency: 'CNY';
  credited_quota: string;
  quota_unit: 'new_api_quota';
  conversion_version: string;
  quote_version: string;
  fee_scope: 'gateway_payable_total';
};
export type CloudTopupOptions = {
  options: CloudTopupQuote[];
  status: 'available' | 'unavailable';
  unsupported_providers: string[];
};
/** Transient handoff only: never persist, log, copy or send through generic shell IPC. */
export type CloudTopupOrder = CloudTopupQuote & {
  order_id: string;
  owner_id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  created_at: number;
  completed_at: number;
  handoff_expires_at: number;
  handoff_status: 'available' | 'unavailable' | 'expired';
  expiry_scope: 'local_handoff_only';
  checkout_url?: string;
};
export type CloudTopupOrders = { items: CloudTopupOrder[]; has_more: boolean; next_before_id: number };
