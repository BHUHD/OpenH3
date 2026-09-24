import fs from 'node:fs';
import path from 'node:path';
import workflows from './h3EmbeddedWorkflows.json';
import {
  matlowaiCompleteOfflineBundle,
  MATLOWAI_CUSTOM_NODE_ARCHIVES,
  MATLOWAI_PORTABLE_RUNTIME_ARCHIVE,
  MATLOWAI_RUNTIME_DEPENDENCIES,
  type H3OfflineFile,
} from './h3OfflineBundle';
import { H3_MATLOWAI_COMFY_MODEL_MANIFEST } from './h3Profiles';

export type H3DownloadFile = H3OfflineFile & { url?: string; urls?: string[]; embeddedBase64?: string };
export type H3SourceConfig = { baseUrls?: string[]; publicSources?: boolean };
export function buildH3DownloadPlan(config: H3SourceConfig = {}) {
  const bases = config.baseUrls ?? [];
  if (bases.length > 8) throw new Error('H3_DOWNLOAD_SOURCE_CONFIG_INVALID');
  for (const base of bases) {
    const parsed = new URL(base);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('H3_DOWNLOAD_SOURCE_CONFIG_INVALID');
  }
  const urls: Record<string, string> = {
    [H3_MATLOWAI_COMFY_MODEL_MANIFEST.relativePath]: H3_MATLOWAI_COMFY_MODEL_MANIFEST.url,
    [MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.relativePath]: MATLOWAI_PORTABLE_RUNTIME_ARCHIVE.source,
    // This URL can change upstream: the pinned size/hash fail closed, never silently update.
    'runtime/7zr.exe': 'https://www.7-zip.org/a/7zr.exe',
  };
  for (const node of MATLOWAI_CUSTOM_NODE_ARCHIVES)
    urls[node.relativePath] = `${node.source}/archive/${node.revision}.zip`;
  for (const asset of MATLOWAI_RUNTIME_DEPENDENCIES) {
    if (!asset.relativePath.startsWith('models/')) continue;
    const remotePath =
      asset.id === 'h3-video-vae'
        ? path.posix.basename(asset.relativePath)
        : asset.relativePath.replace(/^models\//, '');
    urls[asset.relativePath] = `https://huggingface.co/${asset.source}/resolve/${asset.revision}/${remotePath}`;
  }
  const embedded: Record<string, string> = workflows;
  const files: H3DownloadFile[] = matlowaiCompleteOfflineBundle().files.map((file) => {
    if (embedded[file.relativePath]) return { ...file, embeddedBase64: embedded[file.relativePath] };
    if (!urls[file.relativePath]) throw new Error(`H3_DOWNLOAD_SOURCE_MISSING:${file.relativePath}`);
    const origin = urls[file.relativePath];
    const candidates = bases.map(
      (base) => base.replace(/\/$/, '') + '/' + file.relativePath.split('/').map(encodeURIComponent).join('/')
    );
    if (config.publicSources !== false) {
      if (new URL(origin).hostname === 'huggingface.co')
        candidates.push(origin.replace('https://huggingface.co/', 'https://hf-mirror.com/'));
      candidates.push(origin);
    }
    if (!candidates.length)
      throw new Error('H3_DOWNLOAD_NO_SOURCE: configure a LAN bundle server or use offline installation');
    return { ...file, url: origin, urls: [...new Set(candidates)] };
  });
  return { files, totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), reserveBytes: 15 * 2 ** 30 };
}

/** Read-only estimate: existing bytes are not considered checksum-verified. */
export function inspectH3DownloadSpace(bundleRoot: string) {
  const plan = buildH3DownloadPlan();
  let ancestor = path.resolve(bundleRoot);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('H3_DISK_NOT_FOUND');
    ancestor = parent;
  }
  const disk = fs.statfsSync(ancestor);
  const freeBytes = disk.bavail * disk.bsize;
  // Conservative: budget all replacement downloads even when old files are present.
  const requiredBytes = plan.totalBytes + plan.reserveBytes;
  return {
    freeBytes,
    requiredBytes,
    downloadBytes: plan.totalBytes,
    reserveBytes: plan.reserveBytes,
    enough: freeBytes >= requiredBytes,
  };
}
