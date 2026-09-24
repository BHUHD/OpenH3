import { describe, expect, it } from 'vitest';
import { resolveH3BundleRoot } from '@/process/services/runtime/h3BundlePath';

describe('H3 bundle path resolution', () => {
  it('honors the explicit offline bundle environment override', () => {
    const previous = process.env.AIONUI_H3_BUNDLE_ROOT;
    process.env.AIONUI_H3_BUNDLE_ROOT = 'D:\\offline\\h3-bundle';
    try { expect(resolveH3BundleRoot()).toBe('D:\\offline\\h3-bundle'); }
    finally {
      if (previous === undefined) delete process.env.AIONUI_H3_BUNDLE_ROOT;
      else process.env.AIONUI_H3_BUNDLE_ROOT = previous;
    }
  });
});
