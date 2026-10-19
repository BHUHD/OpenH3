/**
 * Resolve the OpenH3 Core version tag to download for packaging.
 *
 * Order:
 *   1. OPENH3_BACKEND_VERSION, then the legacy AIONUI_BACKEND_VERSION env
 *   2. "openh3CoreVersion", then legacy "aioncoreVersion" in package.json
 *   3. 'latest' (GitHub API releases/latest; non-reproducible fallback)
 *
 * Keep this file tiny and dependency-free — it's required from both
 * scripts/prepareOpenH3Core.js and scripts/pack-web-cli.js before
 * any project-level install has necessarily completed.
 */

const fs = require('fs');
const path = require('path');

function resolveOpenH3CoreVersion(projectRoot) {
  const envOverride = process.env.OPENH3_BACKEND_VERSION || process.env.AIONUI_BACKEND_VERSION;
  if (envOverride && envOverride.trim()) {
    return envOverride.trim();
  }

  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    for (const field of ['openh3CoreVersion', 'aioncoreVersion']) {
      if (pkg && typeof pkg[field] === 'string' && pkg[field].trim()) {
        return pkg[field].trim();
      }
    }
  } catch {
    // fall through
  }

  return 'latest';
}

module.exports = { resolveOpenH3CoreVersion, resolveAioncoreVersion: resolveOpenH3CoreVersion };
