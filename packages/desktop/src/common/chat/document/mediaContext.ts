import { mediaAssetSchema, type MediaAsset } from '@/common/chat/document/mediaAsset';
import {
  mediaSelectionSchema,
  validateMediaSelection,
  type MediaSelection,
} from '@/common/chat/document/mediaSelection';

export type MediaContext = {
  schemaVersion: 1;
  media: Array<{ asset: MediaAsset; selection: MediaSelection }>;
};

/** Build an immutable-by-ownership metadata snapshot, not a backend chat wire payload. */
export function buildMediaContext(assetInputs: readonly unknown[], selectionInputs: readonly unknown[]): MediaContext {
  const assets = new Map<string, MediaAsset>();
  for (const input of assetInputs) {
    const asset = mediaAssetSchema.parse(input);
    if (assets.has(asset.assetId)) throw new Error('MEDIA_DUPLICATE_ASSET');
    assets.set(asset.assetId, asset);
  }
  const media = selectionInputs.map((input) => {
    const selection = mediaSelectionSchema.parse(input);
    const asset = assets.get(selection.assetId);
    if (!asset) throw new Error('MEDIA_ASSET_NOT_FOUND');
    return { asset, selection: validateMediaSelection(asset, selection) };
  });
  return { schemaVersion: 1, media };
}
