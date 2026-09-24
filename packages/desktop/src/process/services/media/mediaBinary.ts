import fs from 'node:fs';
import path from 'node:path';

type MediaBinaryName = 'ffmpeg' | 'ffprobe';
type MediaBinaryResolutionOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  cwd?: string;
};

export function resolveMediaBinary(
  name: MediaBinaryName,
  options: MediaBinaryResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const override = env[`AIONUI_${name.toUpperCase()}_PATH`]?.trim();
  if (override) return override;

  const platform = options.platform ?? process.platform;
  const filename = platform === 'win32' ? `${name}.exe` : name;
  const processResources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesPath = options.resourcesPath ?? processResources;
  const cwd = options.cwd ?? process.cwd();
  const candidates = [
    resourcesPath && path.join(resourcesPath, 'ffmpeg', filename),
    path.join(cwd, 'resources', 'ffmpeg', `${platform}-${process.arch}`, filename),
    path.join(cwd, 'resources', 'ffmpeg', filename),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? name;
}
