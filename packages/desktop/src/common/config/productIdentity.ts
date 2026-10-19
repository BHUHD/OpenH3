/**
 * Public product identity for the OpenH3 distribution.
 *
 * Legacy protocol/package identifiers remain AionUi for compatibility. User
 * visible runtime paths and display identity use OpenH3.
 */
export const PRODUCT_NAME = 'OpenH3';
export const LEGACY_PRODUCT_NAME = 'AionUi';
export const PRODUCT_DATA_DIR_NAME = 'OpenH3';
export const LEGACY_DATA_DIR_NAME = 'aionui';

/** Canonical backend process identity for new OpenH3 installations. */
export const BACKEND_BINARY_NAME = 'openh3-core';

/**
 * The old backend executable remains a supported input. Existing installs,
 * PATH entries, and downloaded upstream bundles must continue to start.
 */
export const LEGACY_BACKEND_BINARY_NAMES = ['aioncore'] as const;

/** New and legacy environment variables accepted by the desktop launcher. */
export const BACKEND_BINARY_ENV_VARS = ['OPENH3_BACKEND_BIN', 'AIONUI_BACKEND_BIN'] as const;

/** New resource directory and the directory used by existing packages. */
export const BACKEND_BUNDLE_DIR_NAME = 'bundled-openh3-core';
export const LEGACY_BACKEND_BUNDLE_DIR_NAME = 'bundled-aioncore';
