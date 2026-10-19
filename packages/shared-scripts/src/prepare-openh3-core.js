/**
 * Prepare the OpenH3 Core binary for packaging.
 *
 * Resolution order:
 *  1. Explicit local bundle from OPENH3_BACKEND_LOCAL_BUNDLE_DIR (no fallback)
 *  2. GitHub Actions artifact download when OPENH3_BACKEND_RUN_ID is set
 *  3. GitHub release download (requires version or defaults to "latest")
 *  4. Local binary fallback from OPENH3_BACKEND_LOCAL_BINARY
 *
 * Output: {projectRoot}/resources/bundled-openh3-core/{platform}-{arch}/
 *   - openh3-core[.exe]
 *   - manifest.json
 *   - managed-resources/...
 *
 * @module prepare-openh3-core
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyBundledOpenH3CoreResources } = require('./verify-bundled-openh3-core-resources');

// OpenH3 releases are canonical. The former AionCore repository remains a
// read-only fallback so existing release tags and Actions run ids continue to
// work during the repository migration.
const CANONICAL_REPOSITORY = 'pigq/OpenH3';
const LEGACY_REPOSITORY = 'iOfficeAI/AionCore';

const ACTIONS_ARTIFACT_TARGETS = {
  'darwin-arm64': {
    artifactName: 'openh3-core-manual-macos-arm64',
    legacyArtifactName: 'aioncore-manual-macos-arm64',
    manualPlatform: 'macos-arm64',
  },
  'darwin-x64': {
    artifactName: 'openh3-core-manual-macos-x64',
    legacyArtifactName: 'aioncore-manual-macos-x64',
    manualPlatform: 'macos-x64',
  },
  'linux-arm64': {
    artifactName: 'openh3-core-manual-linux-arm64',
    legacyArtifactName: 'aioncore-manual-linux-arm64',
    manualPlatform: 'linux-arm64',
  },
  'linux-x64': {
    artifactName: 'openh3-core-manual-linux-x64',
    legacyArtifactName: 'aioncore-manual-linux-x64',
    manualPlatform: 'linux-x64',
  },
  'win32-arm64': {
    artifactName: 'openh3-core-manual-windows-arm64',
    legacyArtifactName: 'aioncore-manual-windows-arm64',
    manualPlatform: 'windows-arm64',
  },
  'win32-x64': {
    artifactName: 'openh3-core-manual-windows-x64',
    legacyArtifactName: 'aioncore-manual-windows-x64',
    manualPlatform: 'windows-x64',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectorySafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function getBinaryName(platform, baseName = 'openh3-core') {
  return platform === 'win32' ? `${baseName}.exe` : baseName;
}

function getBinaryCandidates(platform) {
  return [getBinaryName(platform), getBinaryName(platform, 'aioncore')];
}

function getEnv(...names) {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function findFirstBinaryInDir(dir, platform) {
  for (const binaryName of getBinaryCandidates(platform)) {
    const binaryPath = findBinaryInDir(dir, binaryName);
    if (binaryPath) return { binaryName, binaryPath };
  }
  return null;
}

function getActionsTarget(platform, arch) {
  return ACTIONS_ARTIFACT_TARGETS[`${platform}-${arch}`] || null;
}

function getActionsArtifactName(platform, arch) {
  return getActionsTarget(platform, arch)?.artifactName || null;
}

function getActionsManualPlatform(platform, arch) {
  return getActionsTarget(platform, arch)?.manualPlatform || `${platform}-${arch}`;
}

function getBackendRepositories() {
  const configured = getEnv('OPENH3_BACKEND_REPO', 'AIONUI_BACKEND_REPO');
  return [...new Set([configured || CANONICAL_REPOSITORY, LEGACY_REPOSITORY])];
}

function splitRepository(repository) {
  const [owner, repo] = repository.split('/', 2);
  if (!owner || !repo) throw new Error(`Invalid OpenH3 backend repository: ${repository}`);
  return { owner, repo };
}

function getActionsArtifactMissingMessage({ runId, platform, arch, expectedArtifactName, availableArtifactNames }) {
  const available =
    Array.isArray(availableArtifactNames) && availableArtifactNames.length > 0
      ? availableArtifactNames.join(', ')
      : '(none)';
  return [
    `OpenH3 Core run ${runId} does not contain artifact [ ${expectedArtifactName} ] required for [ ${platform}-${arch} ].`,
    `Available artifacts: ${available}.`,
    `Re-run OpenH3 Core Manual Build with platform [ ${getActionsManualPlatform(platform, arch)} ] or all.`,
  ].join(' ');
}

function prepareManagedResources(binaryPath, targetDir) {
  const bundleOut = path.join(targetDir, 'managed-resources');
  const dataDir = path.join(targetDir, '.prepare-data');

  removeDirectorySafe(bundleOut);
  removeDirectorySafe(dataDir);
  ensureDirectory(bundleOut);
  ensureDirectory(dataDir);

  console.log(`  Preparing managed resources under ${path.relative(process.cwd(), bundleOut)}`);
  execFileSync(binaryPath, ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', bundleOut], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AIONUI_BUNDLED_MANAGED_RESOURCES: '',
    },
  });

  removeDirectorySafe(dataDir);
  return bundleOut;
}

function verifyPreparedOpenH3CoreBundle(projectRoot, platform, arch) {
  const result = verifyBundledOpenH3CoreResources({
    resourcesDir: path.join(projectRoot, 'resources'),
    electronPlatformName: platform,
    targetArch: arch,
  });
  if (result.missing.length > 0 || result.failures.length > 0) {
    const summary = result.missing.length > 0 ? result.missing.join(', ') : JSON.stringify(result.failures);
    throw new Error(`Prepared OpenH3 Core bundle is missing required bundled resource(s): ${summary}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the actual version tag when "latest" is requested.
 * Uses GitHub API via `gh` CLI (needs GH_TOKEN in CI) or falls back to
 * `curl` with an optional Authorization header (GITHUB_TOKEN / GH_TOKEN).
 */
function resolveLatestTag() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  for (const repository of getBackendRepositories()) {
    const { owner, repo } = splitRepository(repository);
    // 1. Try gh CLI (honours GH_TOKEN automatically)
    try {
      const out = execSync(`gh api repos/${owner}/${repo}/releases/latest --jq .tag_name`, {
        encoding: 'utf-8',
        timeout: 15000,
      }).trim();
      if (out) return out;
    } catch {
      // gh CLI not available or this repository is unavailable — try curl.
    }

    // 2. Curl with optional token to avoid rate-limit 403
    try {
      const authArgs = token ? ['-H', `Authorization: token ${token}`] : [];
      const args = ['-fsSL', ...authArgs, `https://api.github.com/repos/${owner}/${repo}/releases/latest`];
      const out = execFileSync('curl', args, { encoding: 'utf-8', timeout: 15000 });
      const tag = JSON.parse(out).tag_name;
      if (tag) return tag;
    } catch {
      // network issue, rate limit, or repository fallback miss
    }
  }

  return null;
}

/**
 * Build the release asset filename for the given platform/arch/tag.
 *
 * Expected asset naming convention:
 *   openh3-core-v0.1.0-aarch64-apple-darwin.tar.gz
 */
function getAssetName(platform, arch, tag) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `openh3-core-${tag}-${normalizedArch}-${normalizedPlatform}${ext}`;
}

function getLegacyAssetName(platform, arch, tag) {
  const canonical = getAssetName(platform, arch, tag);
  return canonical?.replace(/^openh3-core-/, 'aioncore-') || null;
}

function getDownloadUrl(assetName, tag, repository = getBackendRepositories()[0]) {
  return `https://github.com/${repository}/releases/download/${tag}/${assetName}`;
}

function downloadFile(url, outputPath) {
  console.log(`  Downloading OpenH3 Core from ${url}`);
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 120000,
    });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 120000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function extractArchive(archivePath, outputDir, platform) {
  ensureDirectory(outputDir);
  if (platform === 'win32' || archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
  }
}

function findBinaryInDir(dir, binaryName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
}

function findOpenH3CoreArchiveInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isFile() &&
      (entry.name.startsWith('openh3-core-') || entry.name.startsWith('aioncore-')) &&
      (entry.name.endsWith('.zip') || entry.name.endsWith('.tar.gz'))
    ) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findOpenH3CoreArchiveInDir(fullPath);
      if (found) return found;
    }
  }
  return null;
}

function getGitHubToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
}

function githubApiGetJson(apiPath) {
  const token = getGitHubToken();

  try {
    return JSON.parse(
      execFileSync('gh', ['api', apiPath], {
        encoding: 'utf-8',
        timeout: 15000,
        env: {
          ...process.env,
          GH_TOKEN: token || process.env.GH_TOKEN,
        },
      })
    );
  } catch {
    // gh CLI not available or failed — fall back to curl.
  }

  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) {
    headers.push('-H', `Authorization: Bearer ${token}`);
  }

  const url = `https://api.github.com/${apiPath}`;
  const out = execFileSync('curl', ['-fsSL', ...headers, url], {
    encoding: 'utf-8',
    timeout: 15000,
  });
  return JSON.parse(out);
}

function downloadFileWithAuth(url, outputPath) {
  const token = getGitHubToken();
  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) {
    headers.push('-H', `Authorization: Bearer ${token}`);
  }

  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', ...headers, '-o', outputPath, url], {
      timeout: 120000,
    });
    return;
  } catch {
    // curl may be unavailable in some local environments; try gh before failing.
  }

  execFileSync('gh', ['api', url, '--output', outputPath], {
    timeout: 120000,
    env: {
      ...process.env,
      GH_TOKEN: token || process.env.GH_TOKEN,
    },
  });
}

function listActionsArtifacts(runId, repository) {
  const { owner, repo } = splitRepository(repository);
  const response = githubApiGetJson(`repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  return Array.isArray(response?.artifacts) ? response.artifacts : [];
}

function downloadAndExtractActionsArtifact(platform, arch, runId) {
  const target = getActionsTarget(platform, arch);
  if (!target) {
    throw new Error(`Unsupported OpenH3 Core Actions artifact target: ${platform}-${arch}`);
  }

  const expectedArtifactName = target.artifactName;
  const expectedArtifactNames = [target.artifactName, target.legacyArtifactName];
  const availableArtifactNames = new Set();
  let selected = null;
  let lastApiError = null;

  for (const repository of getBackendRepositories()) {
    let artifacts;
    try {
      artifacts = listActionsArtifacts(runId, repository);
    } catch (error) {
      lastApiError = error;
      continue;
    }
    for (const name of artifacts.map((artifact) => artifact.name).filter(Boolean)) {
      availableArtifactNames.add(name);
    }
    const artifact = expectedArtifactNames
      .map((name) => artifacts.find((candidate) => candidate.name === name))
      .find(Boolean);
    if (artifact) {
      selected = { artifact, repository };
      break;
    }
  }

  if (!selected) {
    if (lastApiError && availableArtifactNames.size === 0) {
      throw new Error(
        `Unable to list OpenH3 Core artifacts for run ${runId}: ${lastApiError.message || String(lastApiError)}`
      );
    }
    throw new Error(
      getActionsArtifactMissingMessage({
        runId,
        platform,
        arch,
        expectedArtifactName,
        availableArtifactNames: [...availableArtifactNames].sort(),
      })
    );
  }

  const { artifact, repository } = selected;
  const actualArtifactName = artifact.name;

  // Keep the historical temporary directory so interrupted old packaging jobs
  // can still be cleaned up by their existing housekeeping scripts.
  const tempDir = path.join(os.tmpdir(), 'openh3-core-prepare-actions', runId, `${platform}-${arch}`);
  const artifactZipPath = path.join(tempDir, `${actualArtifactName}.zip`);
  const artifactExtractDir = path.join(tempDir, 'artifact');
  const binaryExtractDir = path.join(tempDir, 'binary');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  const downloadUrl =
    artifact.archive_download_url ||
    (() => {
      const { owner, repo } = splitRepository(repository);
      return `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`;
    })();
  console.log(`  Downloading OpenH3 Core run ${runId} artifact ${actualArtifactName} from ${repository}`);
  downloadFileWithAuth(downloadUrl, artifactZipPath);
  extractArchive(artifactZipPath, artifactExtractDir, platform);

  const archivePath = findOpenH3CoreArchiveInDir(artifactExtractDir);
  if (!archivePath) {
    throw new Error(
      `OpenH3 Core artifact ${actualArtifactName} from run ${runId} does not contain an OpenH3 Core archive`
    );
  }

  extractArchive(archivePath, binaryExtractDir, platform);

  const binary = findFirstBinaryInDir(binaryExtractDir, platform);
  if (!binary) {
    throw new Error(
      `OpenH3 Core binary (${getBinaryCandidates(platform).join(' or ')}) not found in artifact ${actualArtifactName} from run ${runId}`
    );
  }

  return {
    binaryPath: binary.binaryPath,
    tempDir,
    artifactName: actualArtifactName,
    archivePath,
    url: downloadUrl,
  };
}

function downloadAndExtract(platform, arch, tag) {
  const assetName = getAssetName(platform, arch, tag);
  if (!assetName) {
    throw new Error(`Unsupported OpenH3 Core target: ${platform}-${arch}`);
  }

  const tempDir = path.join(os.tmpdir(), 'openh3-core-prepare', tag, `${platform}-${arch}`);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  const candidates = [
    { assetName, label: 'OpenH3 Core' },
    { assetName: getLegacyAssetName(platform, arch, tag), label: 'legacy AionCore' },
  ];
  let lastError = null;
  for (const repository of getBackendRepositories()) {
    for (const candidate of candidates) {
      if (!candidate.assetName) continue;
      const archivePath = path.join(tempDir, candidate.assetName);
      removeDirectorySafe(extractDir);
      try {
        const url = getDownloadUrl(candidate.assetName, tag, repository);
        downloadFile(url, archivePath);
        extractArchive(archivePath, extractDir, platform);
        const binary = findFirstBinaryInDir(extractDir, platform);
        if (!binary) {
          throw new Error(
            `OpenH3 Core binary (${getBinaryCandidates(platform).join(' or ')}) not found in downloaded archive`
          );
        }
        return { binaryPath: binary.binaryPath, tempDir, url, repository, assetName: candidate.assetName };
      } catch (error) {
        lastError = error;
      }
    }
  }

  removeDirectorySafe(tempDir);
  throw lastError || new Error(`OpenH3 Core release asset not found for ${platform}-${arch} (${tag})`);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prepare the OpenH3 Core binary for packaging.
 *
 * @param {object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string} options.platform - Target platform (process.platform)
 * @param {string} options.arch - Target architecture (process.arch)
 * @param {string} options.version - Backend version (default: 'latest')
 * @returns {{ prepared: true; dir: string; sourceType: string }}
 */
function prepareOpenH3Core(options) {
  const { projectRoot, platform, arch, version = 'latest' } = options;
  const runtimeKey = `${platform}-${arch}`;
  const actionsRunId = getEnv('OPENH3_BACKEND_RUN_ID', 'AIONUI_BACKEND_RUN_ID');
  const localBundleDir = getEnv('OPENH3_BACKEND_LOCAL_BUNDLE_DIR', 'AIONUI_BACKEND_LOCAL_BUNDLE_DIR');

  let tag = null;
  if (!actionsRunId) {
    // Resolve the actual version tag — release asset filenames include the tag.
    if (version === 'latest' && !localBundleDir) {
      const resolved = resolveLatestTag();
      if (!resolved) {
        throw new Error('Failed to resolve the latest OpenH3 Core release tag from GitHub API');
      }
      tag = resolved;
      console.log(`Resolved OpenH3 Core "latest" → ${tag}`);
    } else if (version !== 'latest') {
      tag = version.startsWith('v') ? version : `v${version}`;
    }
  }

  const targetDir = path.join(projectRoot, 'resources', 'bundled-openh3-core', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);

  console.log(
    `Preparing OpenH3 Core for ${runtimeKey} (${actionsRunId ? `actions run: ${actionsRunId}` : `version: ${tag}`})`
  );

  if (localBundleDir) {
    const resolvedLocalBundleDir = path.resolve(localBundleDir);
    const localBinaryPath = getBinaryCandidates(platform)
      .map((candidate) => path.join(resolvedLocalBundleDir, candidate))
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    const localManagedResourcesDir = path.join(resolvedLocalBundleDir, 'managed-resources');
    if (
      fs.existsSync(resolvedLocalBundleDir) &&
      fs.statSync(resolvedLocalBundleDir).isDirectory() &&
      localBinaryPath &&
      fs.existsSync(localManagedResourcesDir) &&
      fs.statSync(localManagedResourcesDir).isDirectory()
    ) {
      // The source may already be the packaging output. Never remove it first.
      const sourceRoot = fs.realpathSync(resolvedLocalBundleDir);
      const outputRoot = fs.existsSync(targetDir) ? fs.realpathSync(targetDir) : path.resolve(targetDir);
      if (path.relative(sourceRoot, outputRoot) !== '') {
        const isNested = (parent, child) => {
          const relative = path.relative(parent, child);
          return (
            relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
          );
        };
        if (isNested(sourceRoot, outputRoot) || isNested(outputRoot, sourceRoot)) {
          throw new Error('Local backend bundle and packaging output must not contain one another.');
        }
        removeDirectorySafe(targetDir);
        copyDirectorySafe(sourceRoot, targetDir);
        // Do not carry the legacy executable name into a newly generated
        // OpenH3 bundle. Legacy bundles remain readable through the resolver,
        // but new artifacts expose only the canonical filename.
        for (const legacyName of getBinaryCandidates(platform).slice(1)) {
          const legacyTarget = path.join(targetDir, legacyName);
          if (path.resolve(legacyTarget) !== path.resolve(targetBinaryPath)) removeDirectorySafe(legacyTarget);
        }
      }
      if (localBinaryPath && path.resolve(localBinaryPath) !== path.resolve(targetBinaryPath)) {
        copyFileSafe(localBinaryPath, targetBinaryPath);
      }
      ensureExecutableMode(targetBinaryPath);
      const manifest = {
        platform,
        arch,
        version: tag || (actionsRunId ? `actions-run-${actionsRunId}` : 'local-bundle'),
        generatedAt: new Date().toISOString(),
        sourceType: 'local-bundle',
        source: { path: resolvedLocalBundleDir },
        files: [binaryName, 'managed-resources/'],
      };
      writeJson(path.join(targetDir, 'manifest.json'), manifest);
      verifyPreparedOpenH3CoreBundle(projectRoot, platform, arch);
      console.log(`  Using local OpenH3 Core bundle: ${resolvedLocalBundleDir}`);
      return { prepared: true, dir: targetDir, sourceType: 'local-bundle' };
    }
    throw new Error(`Local backend bundle is incomplete or missing: ${resolvedLocalBundleDir}`);
  }

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  let sourcePath = null;
  let sourceType = 'none';
  let sourceDetail = {};
  let tempDir = null;

  // 1. Download from GitHub Actions artifacts when manual build run id is provided.
  if (actionsRunId) {
    const result = downloadAndExtractActionsArtifact(platform, arch, actionsRunId);
    sourcePath = result.binaryPath;
    tempDir = result.tempDir;
    sourceType = 'actions-artifact';
    sourceDetail = {
      runId: actionsRunId,
      artifactName: result.artifactName,
      url: result.url,
    };
    console.log(`  Downloaded from GitHub Actions artifact`);
  }

  // 2. Download from GitHub releases.
  if (!sourcePath && tag) {
    try {
      const result = downloadAndExtract(platform, arch, tag);
      sourcePath = result.binaryPath;
      tempDir = result.tempDir;
      sourceType = 'download';
      sourceDetail = { url: result.url };
      console.log(`  Downloaded from GitHub releases`);
    } catch (error) {
      console.warn(`  Download failed: ${error.message}`);
    }
  }

  // 3. Use an explicitly supplied local cache when network download is unavailable.
  if (!sourcePath) {
    const localBinary = getEnv('OPENH3_BACKEND_LOCAL_BINARY', 'AIONUI_BACKEND_LOCAL_BINARY');
    if (localBinary) {
      const resolvedLocalBinary = path.resolve(localBinary);
      if (fs.existsSync(resolvedLocalBinary) && fs.statSync(resolvedLocalBinary).isFile()) {
        sourcePath = resolvedLocalBinary;
        sourceType = 'local-binary';
        sourceDetail = { path: resolvedLocalBinary };
        console.log(`  Using local OpenH3 Core binary: ${resolvedLocalBinary}`);
      } else {
        console.warn(`  Local OpenH3 Core binary not found: ${resolvedLocalBinary}`);
      }
    }
  }

  // Write result. The source may still be the legacy `aioncore` binary;
  // new bundles always expose the canonical OpenH3 Core filename.
  if (sourcePath) {
    copyFileSafe(sourcePath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);
    const bundledManagedResourcesDir = prepareManagedResources(targetBinaryPath, targetDir);

    // The release tag is the authoritative version — the aioncore
    // binary does not expose a --version flag (it has --app-version which
    // takes a value, not a self-report).
    const manifest = {
      platform,
      arch,
      version: tag || `actions-run-${actionsRunId}`,
      generatedAt: new Date().toISOString(),
      sourceType,
      source: sourceDetail,
      files: [binaryName, 'managed-resources/'],
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    verifyPreparedOpenH3CoreBundle(projectRoot, platform, arch);
    console.log(
      `  Bundled OpenH3 Core prepared: resources/bundled-openh3-core/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );
    console.log(`  Bundled managed resources prepared: ${bundledManagedResourcesDir}`);

    if (tempDir) removeDirectorySafe(tempDir);
    return { prepared: true, dir: targetDir, sourceType };
  }

  throw new Error(`OpenH3 Core binary not found for ${runtimeKey} (tag: ${tag})`);
}

module.exports = {
  getActionsArtifactMissingMessage,
  getActionsArtifactName,
  prepareOpenH3Core,
  prepareAioncore: prepareOpenH3Core,
  verifyPreparedOpenH3CoreBundle,
  verifyPreparedAioncoreBundle: verifyPreparedOpenH3CoreBundle,
};
