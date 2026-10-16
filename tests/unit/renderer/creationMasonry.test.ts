import { describe, expect, it } from 'vitest';
import { creationMasonry } from '@/renderer/pages/guid/Creation/masonry';

describe('creation masonry', () => {
  it('packs mixed ratios into the shortest column with 2px gutters', () => {
    const { items, height } = creationMasonry(766, ['3:4', '16:9', '3:4', '3:4', '16:9'], false);
    expect(items.map((item) => item.width)).toEqual([190, 190, 190, 190, 190]);
    expect(items[4].left).toBe(192);
    expect(items[4].top).toBe((190 * 9) / 16 + 2);
    expect(height).toBeCloseTo((190 * 4) / 3);
    for (const a of items)
      for (const b of items) {
        if (a === b || a.left !== b.left) continue;
        expect(a.top + a.height <= b.top || b.top + b.height <= a.top).toBe(true);
      }
  });
  it('uses two columns on mobile and retains the media aspect ratios', () => {
    const { items } = creationMasonry(370, ['3:4', '16:9', '4:3'], true);
    expect(items[0].width).toBe(184);
    expect(items[1].left).toBe(186);
    expect(items[2].left).toBe(186);
    expect(items[2].height).toBe(138);
  });
});
