import { z } from 'zod';

export const mediaIdentitySchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      value.trim() === value &&
      Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
    'Invalid media identity'
  );

const positiveInteger = z.number().int().safe().positive();

export const mediaTimeBaseSchema = z
  .object({
    numerator: positiveInteger,
    denominator: positiveInteger,
  })
  .strict();

const identity = {
  assetId: mediaIdentitySchema,
  revision: positiveInteger,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
};

const dimensions = { width: positiveInteger, height: positiveInteger };
const timing = { durationTicks: positiveInteger, timeBase: mediaTimeBaseSchema };

/** Metadata only: filesystem access is resolved separately at the trusted boundary. */
export const mediaAssetSchema = z.discriminatedUnion('kind', [
  z.object({ ...identity, kind: z.literal('image'), ...dimensions }).strict(),
  z.object({ ...identity, kind: z.literal('video'), ...dimensions, ...timing }).strict(),
  z.object({ ...identity, kind: z.literal('audio'), ...timing }).strict(),
]);

/** Dimensions use display orientation; ticks are relative to the media presentation origin. */
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaTimeBase = z.infer<typeof mediaTimeBaseSchema>;
