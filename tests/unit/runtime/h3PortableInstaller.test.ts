import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { H3PortableInstaller } from '@/process/services/runtime/H3PortableInstaller';
import { MATLOWAI_CUSTOM_NODE_ARCHIVES, MATLOWAI_MODEL_ASSETS } from '@/process/services/runtime/h3OfflineBundle';

describe('H3 portable installer', () => {
  it('extracts and prepares the pinned runtime only once', () => {
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-installer-'));
    const archive = path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable_nvidia.7z');
    const extractor = path.join(bundleRoot, 'runtime', '7zr.exe');
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(path.join(bundleRoot, 'custom-node-sources'), { recursive: true });
    fs.writeFileSync(archive, 'archive');
    fs.writeFileSync(extractor, 'extractor');
    const calls: string[][] = [];
    for (const archive of MATLOWAI_CUSTOM_NODE_ARCHIVES) fs.writeFileSync(path.join(bundleRoot, archive.relativePath), 'node archive');
    for (const asset of MATLOWAI_MODEL_ASSETS) { fs.mkdirSync(path.dirname(path.join(bundleRoot, asset.relativePath)), { recursive: true }); fs.writeFileSync(path.join(bundleRoot, asset.relativePath), 'x'); }
    const runtimeRoot = path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable');
    const installer = new H3PortableInstaller({ bundleRoot, execFileSync: (_file, args) => {
      calls.push(args);
      if (args[0] === 'x' && args[1].endsWith('.7z')) {
        fs.mkdirSync(path.join(runtimeRoot, 'ComfyUI'), { recursive: true });
        fs.mkdirSync(path.join(runtimeRoot, 'python_embeded'), { recursive: true });
        fs.writeFileSync(path.join(runtimeRoot, 'python_embeded', 'python.exe'), 'python');
        fs.writeFileSync(path.join(runtimeRoot, 'ComfyUI', 'main.py'), 'main');
      } else if (args[0] === '-xf') {
        const archive = MATLOWAI_CUSTOM_NODE_ARCHIVES.find((item) => args[1] === path.join(bundleRoot, item.relativePath));
        if (archive) { const nodeRoot = path.join(runtimeRoot, 'ComfyUI', 'custom_nodes', archive.targetDirectory); fs.mkdirSync(nodeRoot, { recursive: true }); fs.writeFileSync(path.join(nodeRoot, '__init__.py'), ''); }
      } else {
        const archive = MATLOWAI_CUSTOM_NODE_ARCHIVES.find((item) => args[1] === path.join(bundleRoot, item.relativePath));
        if (archive) { const nodeRoot = path.join(runtimeRoot, 'ComfyUI', 'custom_nodes', archive.targetDirectory); fs.mkdirSync(nodeRoot, { recursive: true }); fs.writeFileSync(path.join(nodeRoot, '__init__.py'), ''); }
      }
    }, verifyBundle: false });
    expect(installer.ensureInstalled()).toBe(runtimeRoot);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual(['x', archive, `-o${path.join(bundleRoot, 'runtime')}`, '-y']);
    expect(installer.ensureInstalled()).toBe(runtimeRoot);
    expect(calls).toHaveLength(4);
    expect(installer.modelsDirectory()).toBe(path.join(bundleRoot, 'models'));
  });

  it('resolves a relative bundle root before invoking the extractor', () => {
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-relative-'));
    const installer = new H3PortableInstaller({ bundleRoot: path.relative(process.cwd(), bundleRoot), verifyBundle: false, execFileSync: (_file, args) => {
      expect(path.isAbsolute(_file) || _file === 'tar').toBe(true);
      expect(path.isAbsolute(args[1])).toBe(true);
      if (args[0] === 'x') expect(path.isAbsolute(args[2].slice(2))).toBe(true);
      if (args[0] === '-xf') expect(path.isAbsolute(args[3])).toBe(true);
      fs.mkdirSync(path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable', 'python_embeded'), { recursive: true });
      fs.mkdirSync(path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable', 'ComfyUI'), { recursive: true });
      fs.writeFileSync(path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable', 'python_embeded', 'python.exe'), 'python');
      fs.writeFileSync(path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable', 'ComfyUI', 'main.py'), 'main');
      const archive = MATLOWAI_CUSTOM_NODE_ARCHIVES.find((item) => args[1] === path.join(bundleRoot, item.relativePath));
      if (archive) { fs.mkdirSync(path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable', 'ComfyUI', 'custom_nodes', archive.targetDirectory), { recursive: true }); }
    } });
    fs.mkdirSync(path.join(bundleRoot, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(bundleRoot, 'runtime', '7zr.exe'), 'extractor');
    fs.writeFileSync(path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable_nvidia.7z'), 'archive');
    for (const asset of MATLOWAI_MODEL_ASSETS) { fs.mkdirSync(path.dirname(path.join(bundleRoot, asset.relativePath)), { recursive: true }); fs.writeFileSync(path.join(bundleRoot, asset.relativePath), 'x'); }
    for (const archive of MATLOWAI_CUSTOM_NODE_ARCHIVES) { fs.mkdirSync(path.dirname(path.join(bundleRoot, archive.relativePath)), { recursive: true }); fs.writeFileSync(path.join(bundleRoot, archive.relativePath), 'zip'); }
    expect(installer.ensureInstalled()).toContain(path.join('runtime', 'ComfyUI_windows_portable'));
  });

  it('reports missing assets and does not trust a stale verification marker', () => {
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-status-'));
    const installer = new H3PortableInstaller({ bundleRoot });
    const status = installer.status();
    expect(status.bundleVerified).toBe(false);
    expect(status.runtimePresent).toBe(false);
    expect(status.missingAssets).toHaveLength(MATLOWAI_MODEL_ASSETS.length);
    expect(status.missingCustomNodes).toHaveLength(MATLOWAI_CUSTOM_NODE_ARCHIVES.length);
  });
});
