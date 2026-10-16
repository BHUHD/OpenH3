import type { IProvider } from '@/common/config/storage';
import { isImageGenSupported } from '@/common/utils/imageModelAllowlist';
import type { CreationKind, CreationModel } from './creation';

/** Public connection presets. Credentials are supplied by the user. */
export const CLOUD_IMAGE_PRESETS = [
  { id: 'apiyi', name: 'APIYi', platform: 'openai', base_url: 'https://api.apiyi.com/v1', model: 'gpt-image-2.5-all' },
  { id: 'gemini', name: 'Google Gemini', platform: 'gemini', base_url: '', model: 'gemini-2.5-flash-image' },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    platform: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash-image',
  },
] as const;

/** Merge the author's public directory with enabled user providers. */
export function cloudCreationModels(providers: IProvider[], kind: CreationKind): CreationModel[] {
  if (kind === 'video')
    return [{ id: 'cloud-video', name: '', kind, source: 'cloud', state: 'unsupported', available: false }];
  const configured = providers
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) =>
      provider.models
        .filter((model) => provider.model_enabled?.[model] !== false && isImageGenSupported(provider, model))
        .map(
          (model): CreationModel => ({
            id: `${provider.id}::${model}`,
            name: model,
            kind,
            source: 'cloud',
            state: provider.api_key?.trim() ? 'configured' : 'not-configured',
            available: Boolean(provider.api_key?.trim()),
            provider: { ...provider, use_model: model },
          })
        )
    );
  return [
    ...configured,
    ...CLOUD_IMAGE_PRESETS.filter(
      (preset) =>
        !configured.some(
          (item) =>
            item.name === preset.model &&
            item.provider?.platform === preset.platform &&
            (item.provider?.base_url ?? '').replace(/\/+$/, '') === preset.base_url
        )
    ).map(
      (preset): CreationModel => ({
        id: `preset::${preset.id}`,
        presetId: preset.id,
        name: preset.model,
        kind,
        source: 'cloud',
        state: 'not-configured',
        available: false,
      })
    ),
  ];
}
