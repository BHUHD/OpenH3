import type { CloudAccountRequest, CloudAccountResponse } from '@/common/types/platform/cloudAccount';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import { safeCloudError } from '@/common/adapter/httpBridge/cloudAccount';

// Browser requests use the existing same-origin Core adapter. Desktop uses only
// the sender-checked preload operation, never renderer loopback HTTP.
const paths: Record<CloudAccountRequest['operation'], string> = {
  capabilities: 'capabilities',
  session: 'session',
  me: 'me',
  devices: 'devices',
  logout: 'logout',
  wallet: 'wallet',
  models: 'models',
  mediaModels: 'media-models',
  usage: 'usage',
  emailCode: 'email-code',
  register: 'register',
  login: 'login',
  verify: 'auth/verify',
  passwordReset: 'password/reset',
  passwordResetComplete: 'password/reset/complete',
  revokeDevice: 'devices/revoke',
  topupOptions: 'topup/options',
  topupQuote: 'topup/quote',
  topupCreate: 'topup/create',
  topupCreateAndOpen: 'topup/create',
  topupOrders: 'topup/orders',
};
export async function requestCloudAccount(request: CloudAccountRequest): Promise<CloudAccountResponse> {
  try {
    if (window.electronAPI) {
      return window.electronAPI.cloudAccount
        ? await window.electronAPI.cloudAccount(request)
        : safeCloudError({ code: 'LOCAL_AUTH_REQUIRED' });
    }
    const get = ['capabilities', 'session', 'me', 'devices', 'wallet', 'models', 'mediaModels'].includes(
      request.operation
    );
    const data = await httpRequest<Extract<CloudAccountResponse, { success: true }>['data']>(
      get ? 'GET' : 'POST',
      `/api/cloud-account/${paths[request.operation]}`,
      'input' in request ? request.input : get ? undefined : {}
    );
    return { success: true, data };
  } catch (error) {
    return isBackendHttpError(error)
      ? safeCloudError({ code: error.code, details: error.details })
      : safeCloudError(null);
  }
}
