import { describe, expect, it } from 'vitest';
import { mediaAssetSchema } from '@/common/chat/document/mediaAsset';

const image = {
  assetId: 'asset-image',
  revision: 1,
  contentHash: 'a'.repeat(64),
  kind: 'image',
  width: 1920,
  height: 1080,
};

describe('media asset metadata', () => {
  it('accepts oriented image dimensions without a filesystem path', () => {
    expect(mediaAssetSchema.parse(image)).toEqual(image);
  });

  it('preserves rational time bases rather than assuming constant frame rate', () => {
    const video = { ...image, kind: 'video', durationTicks: 900001, timeBase: { numerator: 1, denominator: 90000 } };
    expect(mediaAssetSchema.parse(video)).toEqual(video);
  });

  it('accepts audio without fabricated image dimensions', () => {
    const audio = {
      assetId: 'voice',
      revision: 1,
      contentHash: 'b'.repeat(64),
      kind: 'audio',
      durationTicks: 48000,
      timeBase: { numerator: 1, denominator: 48000 },
    };
    expect(mediaAssetSchema.parse(audio)).toEqual(audio);
  });

  it.each([
    { revision: 0 },
    { revision: 1.5 },
    { contentHash: 'not-a-hash' },
    { width: 0 },
    { height: Number.NaN },
    { assetId: '' },
    { assetId: '   ' },
    { assetId: 'bad\u0000id' },
    { path: 'C:/private/file.png' },
    { kind: 'document' },
  ])('rejects invalid or unexpected metadata %j', (patch) => {
    expect(mediaAssetSchema.safeParse({ ...image, ...patch }).success).toBe(false);
  });

  it.each([
    { durationTicks: Number.MAX_SAFE_INTEGER + 1 },
    { durationTicks: 0 },
    { durationTicks: Infinity },
    { timeBase: { numerator: 1, denominator: 0 } },
  ])('rejects unusable media timing %j', (patch) => {
    const video = { ...image, kind: 'video', durationTicks: 90000, timeBase: { numerator: 1, denominator: 90000 } };
    expect(mediaAssetSchema.safeParse({ ...video, ...patch }).success).toBe(false);
  });
});
