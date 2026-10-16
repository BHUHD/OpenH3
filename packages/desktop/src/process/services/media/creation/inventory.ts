import fs from 'node:fs';
import path from 'node:path';
import type { LocalCreationInventory } from '@/common/chat/document/creation/creation';
import type { H3PortableInstallStatus } from '../../runtime/H3PortableInstaller';

const WORKFLOWS = [
  '01_reference_4step_sla_lowvram.api.json',
  '04_i2v_fl2v_4step_sla_lowvram.api.json',
  '05_ref2va_4step_sla_lowvram.api.json',
];

/** Read installed files without starting ComfyUI, following links, or downloading models. */
export function inspectCreationInventory(
  install: H3PortableInstallStatus,
  runtimeRunning: boolean
): LocalCreationInventory {
  const missingWorkflows = WORKFLOWS.filter(
    (name) => !fs.existsSync(path.join(install.bundleRoot, 'workflows', 'lowvram', name))
  );
  const models: LocalCreationInventory['models'] = [];
  const names = new Set<string>();
  const scan = (root: string, relative = '', depth = 0): void => {
    if (depth > 5 || models.length >= 200) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (models.length >= 200) break;
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) scan(root, file, depth + 1);
      else if (entry.isFile() && /\.(safetensors|ckpt|gguf|pt|pth)$/i.test(entry.name) && !names.has(entry.name)) {
        names.add(entry.name);
        models.push({ id: `downloaded:${file.replaceAll('\\', '/')}`, name: entry.name });
      }
    }
  };
  scan(install.modelsDirectory);
  scan(path.join(install.runtimeRoot, 'ComfyUI', 'models'));
  return {
    h3: {
      installed:
        install.bundleVerified &&
        install.runtimePresent &&
        install.missingAssets.length === 0 &&
        install.missingCustomNodes.length === 0 &&
        missingWorkflows.length === 0,
      runtimeRunning,
      missingWorkflows,
    },
    models,
  };
}
