import fs from 'fs';
import path from 'path';

type FileSystem = Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'renameSync'>;

/** Atomically move a legacy profile; never merge live databases into an existing profile. */
export function migrateLegacyUserDataDirectory(source: string, target: string, fileSystem: FileSystem = fs): boolean {
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(target);
  const samePath =
    process.platform === 'win32'
      ? resolvedSource.toLowerCase() === resolvedTarget.toLowerCase()
      : resolvedSource === resolvedTarget;
  if (samePath || !fileSystem.existsSync(source) || fileSystem.existsSync(target)) return false;
  fileSystem.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fileSystem.renameSync(source, target);
    return true;
  } catch {
    return false;
  }
}
