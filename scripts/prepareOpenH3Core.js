/**
 * CLI wrapper for preparing the OpenH3 Core bundle.
 *
 * Reads environment variables and invokes the shared module.
 *
 * Version resolution order:
 *  1. OPENH3_BACKEND_RUN_ID env (legacy AIONUI_BACKEND_RUN_ID is accepted)
 *  2. OPENH3_BACKEND_VERSION env (legacy AIONUI_BACKEND_VERSION is accepted)
 *  3. "openh3CoreVersion" field in repo-root package.json (legacy field accepted)
 *  4. 'latest' (fallback; not recommended for reproducible builds)
 *
 * Environment variables:
 *  - OPENH3_BACKEND_RUN_ID: OpenH3 Core Manual Build workflow run id
 *  - OPENH3_BACKEND_VERSION: override the pinned version
 *  - OPENH3_BACKEND_ARCH: target architecture (default: process.arch)
 *  - GH_TOKEN / GITHUB_TOKEN: GitHub API token (for rate limiting)
 */

const path = require('path');
const { prepareOpenH3Core } = require('../packages/shared-scripts/src/prepare-openh3-core.js');
const { resolveOpenH3CoreVersion } = require('./resolveOpenH3CoreVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
// Support cross-compilation: canonical env > legacy env > npm config > process arch.
const arch =
  process.env.OPENH3_BACKEND_ARCH ||
  process.env.AIONUI_BACKEND_ARCH ||
  process.env.npm_config_target_arch ||
  process.arch;
const version = resolveOpenH3CoreVersion(projectRoot);

try {
  prepareOpenH3Core({ projectRoot, platform, arch, version });
} catch (error) {
  console.error('❌ prepareOpenH3Core failed:', error.message);
  process.exit(1);
}

module.exports = function () {
  try {
    return prepareOpenH3Core({ projectRoot, platform, arch, version });
  } catch (error) {
    console.error('❌ prepareOpenH3Core failed:', error.message);
    throw error;
  }
};
