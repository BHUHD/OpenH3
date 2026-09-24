import { describe, expect, it } from 'vitest';
import { validateMediaSelection } from '@/common/chat/document/mediaSelection';

const image = { assetId: 'image', revision: 2, contentHash: 'a'.repeat(64), kind: 'image', width: 800, height: 600 };
const video = {
  ...image,
  assetId: 'video',
  kind: 'video',
  durationTicks: 1001,
  timeBase: { numerator: 1001, denominator: 30000 },
};
const range = {
  kind: 'range',
  assetId: 'video',
  assetRevision: 2,
  startTicks: 0,
  endTicks: 1001,
  timeBase: { numerator: 1001, denominator: 30000 },
};

describe('media selection validation', () => {
  it('accepts the complete half-open interval including the asset end boundary', () => {
    expect(validateMediaSelection(video, range)).toEqual(range);
  });

  it('accepts an explicit whole-asset reference', () => {
    const selection = { kind: 'whole', assetId: 'image', assetRevision: 2 };
    expect(validateMediaSelection(image, selection)).toEqual(selection);
  });

  it.each([
    { assetRevision: 1 },
    { assetId: 'other' },
    { startTicks: -1 },
    { endTicks: 1002 },
    { startTicks: 1001 },
    { startTicks: 0.5 },
    { startTicks: NaN },
    { timeBase: { numerator: 1, denominator: 30 } },
    { kind: 'unknown' },
  ])('rejects stale, ambiguous or out-of-bounds ranges %j', (patch) => {
    expect(() => validateMediaSelection(video, { ...range, ...patch })).toThrow();
  });

  it('does not accept a time range for a still image', () => {
    expect(() => validateMediaSelection(image, { ...range, assetId: 'image' })).toThrow();
  });

  it('accepts a normalized rectangle in oriented source coordinates', () => {
    const region = { kind: 'region', assetId: 'image', assetRevision: 2, x: 0.2, y: 0.1, width: 0.8, height: 0.9 };
    expect(validateMediaSelection(image, region)).toEqual(region);
  });

  it.each([
    { x: -0.1 },
    { width: 0 },
    { height: Infinity },
    { x: 0.8, width: 0.3 },
    { y: 0.8, height: 0.3 },
    { coordinateSpace: 'css-pixels' },
  ])('rejects invalid image regions %j', (patch) => {
    const region = { kind: 'region', assetId: 'image', assetRevision: 2, x: 0, y: 0, width: 1, height: 1 };
    expect(() => validateMediaSelection(image, { ...region, ...patch })).toThrow();
  });

  it('does not invent spatial tracking for video from a still-image selection', () => {
    const region = { kind: 'region', assetId: 'video', assetRevision: 2, x: 0, y: 0, width: 1, height: 1 };
    expect(() => validateMediaSelection(video, region)).toThrow();
  });
});
