/** Renderer-safe native account operations; no URL, headers or owner inputs. */
export type CloudAccountRequest =
  | { operation: 'capabilities' | 'session' | 'me' | 'devices' | 'logout' | 'wallet' | 'models' }
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
  | { state: 'disabled' | 'unconfigured' | 'disconnected' | 'reauth_required' }
  | { state: 'connected'; account: CloudProfile }
  | { state: 'verification_required'; verification: CloudVerification };
export type CloudAccountData =
  | CloudSession
  | CloudWallet
  | CloudModels
  | CloudUsage
  | {
      availability: 'disabled' | 'unconfigured' | 'available';
      registration_enabled: boolean;
      email_verification_required: boolean;
      password_login_enabled: boolean;
      password_reset_enabled: boolean;
      anti_bot: 'not_required' | 'unsupported_required';
    }
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
  | { success: false; error: string; code: string; retry_after?: number };

export type CloudQuota = { amount: string; unit: string };
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
