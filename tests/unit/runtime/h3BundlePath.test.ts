import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveH3BundleRoot } from '@/process/services/runtime/h3BundlePath';

describe('H3 bundle path resolution', () => {
  it('prefers the canonical OpenH3 environment override', () => {
    const previousCanonical = process.env.OPENH3_H3_BUNDLE_ROOT;
    const previousLegacy = process.env.AIONUI_H3_BUNDLE_ROOT;
    const bundleRoot = path.resolve('offline', 'openh3-bundle');
    process.env.OPENH3_H3_BUNDLE_ROOT = bundleRoot;
    process.env.AIONUI_H3_BUNDLE_ROOT = path.resolve('offline', 'legacy-bundle');
    try {
      expect(resolveH3BundleRoot()).toBe(bundleRoot);
    } finally {
      if (previousCanonical === undefined) delete process.env.OPENH3_H3_BUNDLE_ROOT;
      else process.env.OPENH3_H3_BUNDLE_ROOT = previousCanonical;
      if (previousLegacy === undefined) delete process.env.AIONUI_H3_BUNDLE_ROOT;
      else process.env.AIONUI_H3_BUNDLE_ROOT = previousLegacy;
    }
  });

  it('honors the explicit offline bundle environment override', () => {
    const previous = process.env.AIONUI_H3_BUNDLE_ROOT;
    const bundleRoot = path.resolve('offline', 'h3-bundle');
    process.env.AIONUI_H3_BUNDLE_ROOT = bundleRoot;
    try {
      expect(resolveH3BundleRoot()).toBe(bundleRoot);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_H3_BUNDLE_ROOT;
      else process.env.AIONUI_H3_BUNDLE_ROOT = previous;
    }
  });
});
