import type { CreateProviderRequest } from '@/common/types/provider/providerApi';
import fs from 'node:fs';
import path from 'node:path';

export const VIDEO_PROVIDER_ID = 'realseek-video-default';

export function readVideoProviderKey(): string {
  if (process.env.AIONUI_INITIAL_PROVIDER_KEY) return process.env.AIONUI_INITIAL_PROVIDER_KEY;
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resources) return '';
  const file = path.join(resources, 'video-provider-bootstrap.json');
  if (!fs.existsSync(file)) return '';
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  return value && typeof value === 'object' && 'apiKey' in value && typeof value.apiKey === 'string' ? value.apiKey : '';
}

/** Public connection defaults contain no shared credential. */
export function videoProviderPreset(apiKey = ''): CreateProviderRequest {
  return {
    id: VIDEO_PROVIDER_ID,
    platform: 'openai',
    name: 'RealSeek GPT-6 Astra',
    base_url: 'https://ai.realseek.wiki/v1',
    api_key: apiKey,
    models: ['gpt-6-astra'],
    model_protocols: { 'gpt-6-astra': 'chat_completions' },
    enabled: true,
  };
}

export async function provisionVideoProvider(
  request: <T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<T>,
  apiKey = ''
): Promise<void> {
  if (!apiKey.trim()) return;
  const providers = await request<Array<{ id: string }>>('GET', '/api/providers');
  // Never replace an existing user's provider or model selection.
  if (providers.length) return;
  await request('POST', '/api/providers', videoProviderPreset(apiKey));
  await request('PUT', '/api/assistants/bare:632f31d2', {
    defaults: {
      model: { mode: 'fixed', value: `${VIDEO_PROVIDER_ID}:gpt-6-astra` },
      thought_level: { mode: 'fixed', value: 'low' },
    },
  });
}
