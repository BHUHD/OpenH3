import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

function plainFile(filename: string): fs.Stats | undefined {
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  return stat?.isFile() ? stat : undefined;
}

function receiptPath(destination: string): string {
  return `${destination}.h3-verified.json`;
}

function downloadIdentity(file: H3DownloadFile, stat: fs.Stats) {
  return {
    sha256: file.sha256,
    size: stat.size,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

/** Record a completed download for space estimates only. The installer still checks the payload. */
export function recordH3VerifiedDownload(bundleRoot: string, file: H3DownloadFile): void {
  const destination = path.join(bundleRoot, file.relativePath);
  const receipt = receiptPath(destination);
  const temporary = `${receipt}.${randomUUID()}.tmp`;
  try {
    const stat = plainFile(destination);
    if (!stat || stat.size !== file.sizeBytes) return;
    fs.writeFileSync(temporary, JSON.stringify(downloadIdentity(file, stat)), { flag: 'wx' });
    fs.renameSync(temporary, receipt);
  } catch {
    // An unwritable or interrupted receipt only affects the next estimate.
    try {
      fs.unlinkSync(temporary);
    } catch {
      // No temporary file was committed.
    }
  }
}

function hasVerifiedDownload(destination: string, file: H3DownloadFile): boolean {
  const receipt = receiptPath(destination);
  try {
    const stat = plainFile(destination);
    const proof = plainFile(receipt);
    if (stat?.size !== file.sizeBytes || !proof || proof.size > 4096) return false;
    const identity = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    return Object.entries(downloadIdentity(file, stat)).every(([key, value]) => identity?.[key] === value);
  } catch {
    return false;
  }
}

/** Estimate additional disk use and expected remaining network transfer from the pinned manifest. */
export function inspectH3DownloadSpace(bundleRoot: string, plan = buildH3DownloadPlan()) {
  let ancestor = path.resolve(bundleRoot);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('H3_DISK_NOT_FOUND');
    ancestor = parent;
  }
  const disk = fs.statfsSync(ancestor);
  const device = fs.statSync(ancestor).dev;
  const freeBytes = disk.bavail * disk.bsize;
  let downloadBytes = 0;
  let requiredBytes = plan.reserveBytes;
  for (const file of plan.files) {
    const destination = path.join(bundleRoot, file.relativePath);
    if (!file.embeddedBase64 && hasVerifiedDownload(destination, file)) continue;
    const partial = plainFile(`${destination}.part`);
    // Sparse or linked data may occupy less reusable disk space than its logical length.
    const allocated =
      partial && partial.dev === device && partial.nlink === 1
        ? Math.min(file.sizeBytes, partial.size, partial.blocks * 512)
        : 0;
    requiredBytes += file.sizeBytes - allocated;
    if (!file.embeddedBase64) {
      const resumable = partial && partial.size <= file.sizeBytes ? partial.size : 0;
      downloadBytes += file.sizeBytes - resumable;
    }
  }
  return {
    freeBytes,
    requiredBytes,
    downloadBytes,
    reserveBytes: plan.reserveBytes,
    enough: freeBytes >= requiredBytes,
  };
}
