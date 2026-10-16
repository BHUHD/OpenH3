import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { inspectCreationInventory } from '@/process/services/media/creation/inventory';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));
it('requires assets, pinned nodes and all generation workflows while remaining selectable with runtime stopped', () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
  directories.push(bundleRoot);
  const install = {
    bundleRoot,
    runtimeRoot: bundleRoot,
    modelsDirectory: path.join(bundleRoot, 'models'),
    bundleVerified: true,
    runtimePresent: true,
    missingAssets: [],
    missingCustomNodes: [],
  };
  expect(inspectCreationInventory(install, false).h3.installed).toBe(false);
  fs.mkdirSync(path.join(bundleRoot, 'workflows/lowvram'), { recursive: true });
  for (const name of [
    '01_reference_4step_sla_lowvram.api.json',
    '04_i2v_fl2v_4step_sla_lowvram.api.json',
    '05_ref2va_4step_sla_lowvram.api.json',
  ])
    fs.writeFileSync(path.join(bundleRoot, 'workflows/lowvram', name), '{}');
  expect(inspectCreationInventory(install, false).h3).toMatchObject({ installed: true, runtimeRunning: false });
  expect(inspectCreationInventory({ ...install, missingAssets: ['missing.safetensors'] }, true).h3.installed).toBe(
    false
  );
  expect(inspectCreationInventory({ ...install, missingCustomNodes: ['missing-node'] }, true).h3.installed).toBe(false);
  fs.mkdirSync(install.modelsDirectory);
  fs.writeFileSync(path.join(install.modelsDirectory, 'my-image-model.safetensors'), 'fixture');
  fs.writeFileSync(path.join(install.modelsDirectory, 'incomplete.safetensors.part'), 'fixture');
  expect(inspectCreationInventory(install, false).models).toEqual([
    { id: 'downloaded:my-image-model.safetensors', name: 'my-image-model.safetensors' },
  ]);
});
