import fs from 'node:fs';
import path from 'node:path';

type H3BundleConfig = { bundleRoot?: string };

function readConfiguredRoot(dataDir?: string): string | undefined {
  if (!dataDir) return undefined;
  try {
    const file = path.join(dataDir, 'h3-environment.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as H3BundleConfig;
    return typeof value.bundleRoot === 'string' && value.bundleRoot.trim() ? value.bundleRoot.trim() : undefined;
  } catch { return undefined; }
}

export function resolveH3BundleRoot(dataDir = process.env.AIONUI_DATA_DIR): string {
  const configured = process.env.AIONUI_H3_BUNDLE_ROOT?.trim();
  if (configured) return path.resolve(configured);
  const persisted = readConfiguredRoot(dataDir);
  if (persisted) return path.resolve(persisted);

  const candidates = [
    typeof process.resourcesPath === 'string' ? path.join(process.resourcesPath, 'h3-offline-bundle') : undefined,
    process.execPath ? path.join(path.dirname(process.execPath), 'h3-offline-bundle') : undefined,
    path.resolve(process.cwd(), path.basename(process.cwd()) === 'desktop' ? '..' : '.', '.runtime/h3-offline-bundle'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? (dataDir ? path.join(dataDir, 'h3-offline-bundle') : candidates[candidates.length - 1]);
}

export function persistH3BundleRoot(dataDir: string, bundleRoot: string): string {
  const resolved = path.resolve(bundleRoot);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'h3-environment.json');
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ bundleRoot: resolved, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(temporary, file);
  return resolved;
}
