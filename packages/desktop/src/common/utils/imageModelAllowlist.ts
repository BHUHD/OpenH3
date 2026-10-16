/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist for built-in image generation tool.
 *
 * The built-in image tool supports chat-completions image responses and the
 * synchronous OpenAI-compatible images API used by APIYi.
 *
 * Model selection therefore must be a platform+model allowlist of providers
 * known to work, rather than a coarse name-substring match. Otherwise users
 * see options like `dall-e-3` / `sd-3.5` in the dropdown that
 * are guaranteed to fail at runtime.
 *
 * Chat rules mirror the providers supplemented in `useConfigModelListWithImage.ts`.
 */

type ProviderShape = {
  platform?: string;
  base_url?: string;
  name?: string;
};

const IMAGE_NAME_PATTERN = /(image|banana|imagine)/i;

const RULES: Array<{
  id: string;
  match: (provider: ProviderShape) => boolean;
}> = [
  {
    id: 'gemini',
    match: (p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai',
  },
  {
    id: 'openrouter',
    match: (p) => !!p.base_url?.includes('openrouter.ai'),
  },
  {
    id: 'antigravity',
    match: (p) => !!p.name?.toLowerCase().includes('antigravity'),
  },
];

export const isImageGenSupported = (provider: ProviderShape, modelName: string): boolean => {
  if (isImagesApiProvider(provider, modelName)) return true;
  if (!IMAGE_NAME_PATTERN.test(modelName)) return false;
  return RULES.some((rule) => rule.match(provider));
};

/** Providers whose image model is exposed through `/images/generations`/`edits`. */
export const isImagesApiProvider = (provider: ProviderShape, modelName: string): boolean =>
  !['gemini', 'gemini-vertex-ai', 'anthropic'].includes(provider.platform ?? '') && /^gpt-image-/i.test(modelName);
