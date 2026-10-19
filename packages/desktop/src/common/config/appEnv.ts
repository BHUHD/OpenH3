/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';

/**
 * Returns baseName unchanged in release builds, or baseName + '-dev' in dev builds.
 * When OPENH3_MULTI_INSTANCE=1 (legacy AIONUI_MULTI_INSTANCE is also accepted),
 * appends '-2' to isolate the second dev instance.
 * Used to isolate symlink and directory names between environments.
 *
 * @example
 * getEnvAwareName('.openh3')        // release → '.openh3',        dev → '.openh3-dev'
 * getEnvAwareName('.openh3-config') // release → '.openh3-config', dev → '.openh3-config-dev'
 * // with AIONUI_MULTI_INSTANCE=1:  dev → '.openh3-dev-2'
 */
export function getEnvAwareName(baseName: string): string {
  if (getPlatformServices().paths.isPackaged() === true) return baseName;
  const suffix = (process.env.OPENH3_MULTI_INSTANCE ?? process.env.AIONUI_MULTI_INSTANCE) === '1' ? '-dev-2' : '-dev';
  return `${baseName}${suffix}`;
}
