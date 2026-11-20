import { z } from 'zod';

const identifier = z.string().min(1).max(256);
const accountMediaModel = z.object({
  model_id: identifier,
  display_name: z.string().min(1).max(256),
  kind: z.enum(['image', 'video']),
  capabilities: z.array(z.enum(['text-to-image', 'text-to-video', 'image-to-video'])).min(1),
});

export const accountMediaCatalog = z.object({
  account_id: identifier,
  account_key: identifier,
  models: z.array(accountMediaModel).max(2048),
});
export type AccountMediaCatalog = z.infer<typeof accountMediaCatalog>;
/** accountId here is the opaque issuer/owner/subject key supplied by the native media catalog. */
export type AccountMediaRef = { accountId: string; modelId: string };
export type AccountMediaDefaults = Partial<Record<'image' | 'video', AccountMediaRef>>;

/** Bind saved picker choices to the cloud identity, even if another account lists the same model. */
export function accountMediaId(accountId: string, modelId: string): string {
  return 'account-media:' + JSON.stringify([accountId, modelId]);
}

export function accountMediaRef(id: string | undefined): AccountMediaRef | undefined {
  if (!id?.startsWith('account-media:')) return undefined;
  try {
    const [accountId, modelId] = z.tuple([identifier, identifier]).parse(JSON.parse(id.slice('account-media:'.length)));
    return { accountId, modelId };
  } catch {
    return undefined;
  }
}
