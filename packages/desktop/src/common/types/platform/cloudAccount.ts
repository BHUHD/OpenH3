/** Renderer-safe native account operations; no URL, headers or owner inputs. */
export type CloudAccountRequest =
  | { operation: 'capabilities' | 'session' | 'me' | 'devices' | 'logout' }
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
