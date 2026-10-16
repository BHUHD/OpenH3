import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPlatformServices } from '@/common/platform';

export const COMFY_LOCAL_SKILL_NAME = 'comfyui-local';
export const COMFY_LOCAL_SKILL_PREFERENCE = 'skills.comfyuiLocal.bundle';

type BackendRequest = <T>(method: 'GET' | 'POST' | 'PUT', endpoint: string, body?: unknown) => Promise<T>;
type SkillRecord = { name: string; location: string; source: string; is_custom: boolean };
type BundleStamp = { version: string; contentHash: string; location: string };
type ResourceContext = { isPackaged: boolean; appPath: string | null; resourcesPath?: string };
type ProvisionResult = 'imported' | 'updated' | 'current' | 'preserved';

/** Resolve only the application-owned bundle, independently of the chat workspace. */
export function resolveComfySkillResourcePath(context?: ResourceContext): string {
  const paths = context ?? {
    isPackaged: getPlatformServices().paths.isPackaged(),
    appPath: getPlatformServices().paths.getAppPath(),
    resourcesPath: process.resourcesPath,
  };
  if (paths.isPackaged) {
    const resourcesRoot = paths.resourcesPath ?? (paths.appPath ? path.dirname(paths.appPath) : undefined);
    if (!resourcesRoot) throw new Error('ComfyUI skill resource root is unavailable');
    return path.resolve(resourcesRoot, 'skills', COMFY_LOCAL_SKILL_NAME);
  }
  if (!paths.appPath) throw new Error('ComfyUI skill application root is unavailable');
  return path.resolve(paths.appPath, 'resources', 'skills', COMFY_LOCAL_SKILL_NAME);
}

function skillRoot(location: string): string {
  if (!path.isAbsolute(location)) throw new Error('ComfyUI skill location must be absolute');
  return path.basename(location).toLowerCase() === 'skill.md' ? path.dirname(location) : location;
}

async function hashSkillTree(root: string): Promise<string> {
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('ComfyUI skill root must be a directory');
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    await entries.reduce<Promise<void>>(async (previous, entry) => {
      await previous;
      if (entry.isSymbolicLink()) throw new Error('ComfyUI skill bundle must not contain symbolic links');
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, entryPath).split(path.sep).join('/');
        const content = await fs.readFile(entryPath);
        hash.update(JSON.stringify([relativePath, content.length]));
        hash.update(content);
      }
    }, Promise.resolve());
  };
  await visit(root);
  return hash.digest('hex');
}

function readStamp(value: unknown): BundleStamp | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const stamp = value as Partial<BundleStamp>;
  if (
    typeof stamp.version !== 'string' ||
    typeof stamp.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(stamp.contentHash) ||
    typeof stamp.location !== 'string' ||
    !path.isAbsolute(stamp.location)
  ) {
    return undefined;
  }
  return stamp as BundleStamp;
}

function sameLocation(left: string, right: string): boolean {
  const relative = path.relative(skillRoot(left), skillRoot(right));
  return relative === '';
}

/** Import skill instructions only; never install ComfyUI, models, or nodes at startup. */
export async function provisionComfySkill(
  request: BackendRequest,
  resourcePath = resolveComfySkillResourcePath()
): Promise<ProvisionResult> {
  const bundleRoot = skillRoot(resourcePath);
  const manifest = JSON.parse(await fs.readFile(path.join(bundleRoot, 'manifest.json'), 'utf8')) as {
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== COMFY_LOCAL_SKILL_NAME || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('Invalid ComfyUI skill bundle manifest');
  }
  await fs.access(path.join(bundleRoot, 'SKILL.md'));
  const contentHash = await hashSkillTree(bundleRoot);
  const [preferences, skills] = await Promise.all([
    request<Record<string, unknown>>('GET', '/api/settings/client'),
    request<SkillRecord[]>('GET', '/api/skills'),
  ]);
  if (!Array.isArray(skills)) throw new Error('Backend skill inventory is unavailable');
  const existing = skills.filter((skill) => skill.name === COMFY_LOCAL_SKILL_NAME);
  const stamp = readStamp(preferences?.[COMFY_LOCAL_SKILL_PREFERENCE]);

  if (existing.length > 0) {
    // The import API overwrites by name. Ownership and an unchanged tree are required.
    const owned = existing[0];
    if (
      existing.length !== 1 ||
      !stamp ||
      owned.source !== 'custom' ||
      owned.is_custom !== true ||
      !path.isAbsolute(owned.location) ||
      !sameLocation(owned.location, stamp.location)
    ) {
      return 'preserved';
    }
    try {
      if ((await hashSkillTree(skillRoot(owned.location))) !== stamp.contentHash) return 'preserved';
    } catch {
      return 'preserved';
    }
    if (stamp.version === manifest.version && stamp.contentHash === contentHash) return 'current';
  }

  const imported = await request<{
    skill_name: string;
    skill_names?: string[];
    failed?: Array<{ code: string }>;
  }>('POST', '/api/skills/import', { skill_path: bundleRoot });
  if (
    !imported ||
    (imported.skill_name !== COMFY_LOCAL_SKILL_NAME && !imported.skill_names?.includes(COMFY_LOCAL_SKILL_NAME)) ||
    imported.failed?.length
  ) {
    throw new Error('ComfyUI skill import did not complete');
  }
  const refreshed = await request<SkillRecord[]>('GET', '/api/skills');
  const installed = refreshed?.filter((skill) => skill.name === COMFY_LOCAL_SKILL_NAME);
  const installedSkill = installed?.[0];
  if (
    installed?.length !== 1 ||
    !installedSkill ||
    installedSkill.source !== 'custom' ||
    installedSkill.is_custom !== true ||
    (await hashSkillTree(skillRoot(installedSkill.location))) !== contentHash
  ) {
    throw new Error('ComfyUI skill imported content could not be verified');
  }
  await request('PUT', '/api/settings/client', {
    [COMFY_LOCAL_SKILL_PREFERENCE]: { version: manifest.version, contentHash, location: installedSkill.location },
  });
  return existing.length > 0 ? 'updated' : 'imported';
}
