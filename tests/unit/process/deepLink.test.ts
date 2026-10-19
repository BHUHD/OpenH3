import { describe, expect, it, vi } from 'vitest';
import { isDeepLinkUrl, parseDeepLinkUrl, PROTOCOL_SCHEME } from '@/process/utils/deepLink';

vi.mock('@/common', () => ({
  ipcBridge: { deepLink: { received: { emit: vi.fn() } } },
}));

describe('deep links', () => {
  it('uses the OpenH3 scheme as the primary protocol', () => {
    expect(PROTOCOL_SCHEME).toBe('openh3');
    expect(isDeepLinkUrl('openh3://add-provider?platform=openai')).toBe(true);
    expect(parseDeepLinkUrl('openh3://add-provider?platform=openai')).toEqual({
      action: 'add-provider',
      params: { platform: 'openai' },
    });
  });

  it('accepts existing legacy links but rejects unrelated protocols', () => {
    expect(isDeepLinkUrl('aionui://add-provider?platform=openai')).toBe(true);
    expect(parseDeepLinkUrl('aionui://add-provider?platform=openai')).toEqual({
      action: 'add-provider',
      params: { platform: 'openai' },
    });
    expect(isDeepLinkUrl('https://example.com/add-provider')).toBe(false);
    expect(parseDeepLinkUrl('https://example.com/add-provider')).toBeNull();
  });
});
