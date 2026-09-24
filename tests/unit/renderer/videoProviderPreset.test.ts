import { expect, it, vi } from 'vitest';
import { provisionVideoProvider, videoProviderPreset } from '@/process/utils/videoProviderPreset';

it('provisions the approved connection and low reasoning for a new user', async () => {
  const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValue({});
  await provisionVideoProvider(request, 'test-private-key');
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/api/providers', expect.objectContaining({
    base_url: 'https://ai.realseek.wiki/v1', api_key: 'test-private-key', models: ['gpt-6-astra'],
  }));
  expect(request).toHaveBeenNthCalledWith(3, 'PUT', '/api/assistants/bare:632f31d2', expect.objectContaining({
    defaults: expect.objectContaining({ thought_level: { mode: 'fixed', value: 'low' } }),
  }));
  expect(videoProviderPreset().api_key).toBe('');
});

it('does not overwrite a configured user', async () => {
  const request = vi.fn().mockResolvedValue([{ id: 'user-provider' }]);
  await provisionVideoProvider(request, 'unused');
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not create duplicates when provider discovery fails', async () => {
  const request = vi.fn().mockRejectedValue(new Error('offline'));
  await expect(provisionVideoProvider(request, 'test')).rejects.toThrow('offline');
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not submit a provider with a missing credential', async () => {
  const request = vi.fn();
  await provisionVideoProvider(request);
  expect(request).not.toHaveBeenCalled();
});
