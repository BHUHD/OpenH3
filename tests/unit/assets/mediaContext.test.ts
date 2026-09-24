import { describe, expect, it } from 'vitest';
import { buildMediaContext } from '@/common/chat/document/mediaContext';

const asset = { assetId: 'image', revision: 1, contentHash: 'a'.repeat(64), kind: 'image', width: 640, height: 480 };
const selection = { kind: 'whole', assetId: 'image', assetRevision: 1 };

describe('media context for an agent turn', () => {
  it('creates a versioned JSON envelope with validated asset references', () => {
    expect(buildMediaContext([asset], [selection])).toEqual({ schemaVersion: 1, media: [{ asset, selection }] });
  });

  it('supports a turn with no selected media', () => {
    expect(buildMediaContext([], [])).toEqual({ schemaVersion: 1, media: [] });
  });

  it('includes only selected assets', () => {
    expect(buildMediaContext([asset, { ...asset, assetId: 'unused' }], [selection]).media).toHaveLength(1);
  });

  it('rejects unknown asset identities instead of guessing a file path', () => {
    expect(() => buildMediaContext([], [selection])).toThrow();
  });

  it('rejects duplicate asset identities even when versions differ', () => {
    expect(() => buildMediaContext([asset, { ...asset, revision: 2 }], [selection])).toThrow();
  });

  it('rejects a reference to a superseded asset version', () => {
    expect(() => buildMediaContext([{ ...asset, revision: 2 }], [selection])).toThrow();
  });

  it('does not retain mutable input references', () => {
    const input = { ...asset };
    const context = buildMediaContext([input], [selection]);
    input.width = 100;
    expect(context.media[0].asset).toEqual(asset);
  });
});
