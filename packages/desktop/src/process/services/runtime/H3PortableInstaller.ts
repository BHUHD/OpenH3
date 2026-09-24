import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { matlowaiCompleteOfflineBundle, MATLOWAI_CUSTOM_NODE_ARCHIVES, MATLOWAI_MODEL_ASSETS, validateOfflineBundle } from './h3OfflineBundle';
import { resolveH3BundleRoot } from './h3BundlePath';

type ExecFileSync = (file: string, args: string[], options: { cwd: string; stdio: 'ignore' }) => unknown;
export type H3PortableInstallerOptions = { bundleRoot?: string; execFileSync?: ExecFileSync; verifyBundle?: boolean; onPhase?: (phase: 'verifying' | 'extracting') => void };
export type H3PortableInstallStatus = { bundleRoot: string; runtimeRoot: string; modelsDirectory: string; bundleVerified: boolean; runtimePresent: boolean; missingAssets: string[]; missingCustomNodes: string[] };

export class H3PortableInstaller {
  private readonly bundleRoot: string;
  private readonly run: ExecFileSync;
  private readonly verifyBundle: boolean;
  private readonly onPhase?: H3PortableInstallerOptions['onPhase'];
  constructor(options: H3PortableInstallerOptions = {}) {
    this.bundleRoot = path.resolve(options.bundleRoot ?? resolveH3BundleRoot());
    this.run = options.execFileSync ?? ((file, args, execOptions) => execFileSync(file, args, execOptions));
    this.verifyBundle = options.verifyBundle ?? true;
    this.onPhase = options.onPhase;
  }

  ensureInstalled(): string {
    const runtimeRoot = path.join(this.bundleRoot, 'runtime', 'ComfyUI_windows_portable');
    this.onPhase?.('verifying');
    this.verifyOfflineBundleOnce();
    this.onPhase?.('extracting');
    if (!fs.existsSync(path.join(runtimeRoot, 'python_embeded', 'python.exe')) || !fs.existsSync(path.join(runtimeRoot, 'ComfyUI', 'main.py'))) {
      const extractor = path.join(this.bundleRoot, 'runtime', '7zr.exe');
      const archive = path.join(this.bundleRoot, 'runtime', 'ComfyUI_windows_portable_nvidia.7z');
      if (!fs.existsSync(extractor) || !fs.existsSync(archive)) throw new Error('H3_PORTABLE_BUNDLE_INCOMPLETE');
      this.run(extractor, ['x', archive, `-o${path.join(this.bundleRoot, 'runtime')}`, '-y'], { cwd: path.join(this.bundleRoot, 'runtime'), stdio: 'ignore' });
    }
    if (!fs.existsSync(path.join(runtimeRoot, 'python_embeded', 'python.exe')) || !fs.existsSync(path.join(runtimeRoot, 'ComfyUI', 'main.py'))) throw new Error('H3_PORTABLE_EXTRACT_FAILED');
    this.prepareModels();
    this.prepareCustomNodes(runtimeRoot);
    return runtimeRoot;
  }

  modelsDirectory(): string {
    this.prepareModels();
    return path.join(this.bundleRoot, 'models');
  }

  status(): H3PortableInstallStatus {
    const runtimeRoot = path.join(this.bundleRoot, 'runtime', 'ComfyUI_windows_portable');
    const targetRoot = path.join(runtimeRoot, 'ComfyUI', 'custom_nodes');
    return {
      bundleRoot: this.bundleRoot,
      runtimeRoot,
      modelsDirectory: path.join(this.bundleRoot, 'models'),
      bundleVerified: this.markerIsCurrent(),
      runtimePresent: fs.existsSync(path.join(runtimeRoot, 'python_embeded', 'python.exe')) && fs.existsSync(path.join(runtimeRoot, 'ComfyUI', 'main.py')),
      missingAssets: MATLOWAI_MODEL_ASSETS.filter((asset) => !fs.existsSync(path.join(this.bundleRoot, asset.relativePath))).map((asset) => asset.relativePath),
      missingCustomNodes: MATLOWAI_CUSTOM_NODE_ARCHIVES.filter((archive) => !fs.existsSync(path.join(targetRoot, archive.targetDirectory))).map((archive) => archive.id),
    };
  }

  /** Fast, user-facing summary used by the first-run setup screen. */
  readiness(): 'ready' | 'needs-download' | 'needs-extract' | 'incomplete' {
    const status = this.status();
    if (status.bundleVerified && status.runtimePresent && status.missingAssets.length === 0 && status.missingCustomNodes.length === 0) return 'ready';
    if (!status.runtimePresent && fs.existsSync(path.join(this.bundleRoot, 'runtime', 'ComfyUI_windows_portable_nvidia.7z'))) return 'needs-extract';
    if (status.missingAssets.length || status.missingCustomNodes.length || !status.bundleVerified) return 'needs-download';
    return 'incomplete';
  }

  private prepareModels(): void {
    for (const asset of MATLOWAI_MODEL_ASSETS) {
      if (!fs.existsSync(path.join(this.bundleRoot, asset.relativePath))) throw new Error(`H3_MODEL_ASSET_MISSING:${asset.relativePath}`);
    }
  }

  private verifyOfflineBundleOnce(): void {
    if (!this.verifyBundle) return;
    const bundle = matlowaiCompleteOfflineBundle();
    if (this.markerIsCurrent()) return;
    const result = validateOfflineBundle(this.bundleRoot, bundle);
    if (!result.ok) throw new Error(`H3_OFFLINE_BUNDLE_INVALID:${[...result.missing, ...result.mismatched].join(',')}`);
    const files = bundle.files.map((file) => {
      const stat = fs.statSync(path.join(this.bundleRoot, file.relativePath));
      return { relativePath: file.relativePath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
    });
    const marker = path.join(this.bundleRoot, 'runtime', '.h3-bundle-verified.json');
    fs.writeFileSync(marker, JSON.stringify({ profileId: bundle.profileId, modelRevision: bundle.modelRevision, verifiedAt: new Date().toISOString(), files }), 'utf8');
  }

  private markerIsCurrent(): boolean {
    if (!this.verifyBundle) return false;
    const marker = path.join(this.bundleRoot, 'runtime', '.h3-bundle-verified.json');
    if (!fs.existsSync(marker)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(marker, 'utf8')) as { profileId?: string; modelRevision?: string; files?: Array<{ relativePath: string; sizeBytes: number; mtimeMs: number }> };
      const bundle = matlowaiCompleteOfflineBundle();
      if (data.profileId !== bundle.profileId || data.modelRevision !== bundle.modelRevision || !Array.isArray(data.files)) return false;
      return bundle.files.every((file) => {
        const recorded = data.files!.find((item) => item.relativePath === file.relativePath);
        if (!recorded) return false;
        const target = path.join(this.bundleRoot, file.relativePath);
        if (!fs.existsSync(target)) return false;
        const stat = fs.statSync(target);
        return stat.size === recorded.sizeBytes && stat.mtimeMs === recorded.mtimeMs;
      });
    } catch { return false; }
  }

  private prepareCustomNodes(runtimeRoot: string): void {
    const extractor = path.join(this.bundleRoot, 'runtime', '7zr.exe');
    const zipExtractor = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const targetRoot = path.join(runtimeRoot, 'ComfyUI', 'custom_nodes');
    fs.mkdirSync(targetRoot, { recursive: true });
    for (const archive of MATLOWAI_CUSTOM_NODE_ARCHIVES) {
      if (fs.existsSync(path.join(targetRoot, archive.targetDirectory))) continue;
      const source = path.join(this.bundleRoot, archive.relativePath);
      if (!fs.existsSync(source)) throw new Error(`H3_CUSTOM_NODE_ARCHIVE_MISSING:${archive.id}`);
      if (path.extname(source).toLowerCase() === '.zip') {
        this.run(zipExtractor, ['-xf', source, '-C', targetRoot], { cwd: targetRoot, stdio: 'ignore' });
      } else {
        this.run(extractor, ['x', source, `-o${targetRoot}`, '-y'], { cwd: targetRoot, stdio: 'ignore' });
      }
      const extractedRoot = path.join(targetRoot, archive.targetDirectory);
      if (!fs.existsSync(extractedRoot)) throw new Error(`H3_CUSTOM_NODE_EXTRACT_FAILED:${archive.id}`);
    }
  }
}
