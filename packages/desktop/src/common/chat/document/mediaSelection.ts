import { z } from 'zod';
import { mediaAssetSchema, mediaIdentitySchema, mediaTimeBaseSchema } from '@/common/chat/document/mediaAsset';

const reference = {
  assetId: mediaIdentitySchema,
  assetRevision: z.number().int().safe().positive(),
};
const tick = z.number().int().safe().nonnegative();
const coordinate = z.number().finite().min(0).max(1);
const extent = z.number().finite().positive().max(1);

export const mediaSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ ...reference, kind: z.literal('whole') }).strict(),
  z
    .object({
      ...reference,
      kind: z.literal('range'),
      startTicks: tick,
      endTicks: tick,
      timeBase: mediaTimeBaseSchema,
    })
    .strict(),
  z
    .object({
      ...reference,
      kind: z.literal('region'),
      x: coordinate,
      y: coordinate,
      width: extent,
      height: extent,
    })
    .strict(),
]);

export type MediaSelection = z.infer<typeof mediaSelectionSchema>;

/** Validate both shape and referential integrity before a selection enters an agent turn. */
export function validateMediaSelection(assetInput: unknown, selectionInput: unknown): MediaSelection {
  const asset = mediaAssetSchema.parse(assetInput);
  const selection = mediaSelectionSchema.parse(selectionInput);
  if (asset.assetId !== selection.assetId || asset.revision !== selection.assetRevision) {
    throw new Error('MEDIA_REFERENCE_MISMATCH');
  }
  if (selection.kind === 'range') {
    if (asset.kind === 'image') throw new Error('MEDIA_RANGE_REQUIRES_TIMED_ASSET');
    // Exact rational identity avoids silently interpreting ticks in a different unit.
    if (
      asset.timeBase.numerator !== selection.timeBase.numerator ||
      asset.timeBase.denominator !== selection.timeBase.denominator
    ) {
      throw new Error('MEDIA_TIME_BASE_MISMATCH');
    }
    if (selection.startTicks >= selection.endTicks || selection.endTicks > asset.durationTicks) {
      throw new Error('MEDIA_RANGE_OUT_OF_BOUNDS');
    }
  }
  if (selection.kind === 'region') {
    if (asset.kind !== 'image') throw new Error('MEDIA_REGION_REQUIRES_IMAGE');
    if (selection.x + selection.width > 1 || selection.y + selection.height > 1) {
      throw new Error('MEDIA_REGION_OUT_OF_BOUNDS');
    }
  }
  return selection;
}
