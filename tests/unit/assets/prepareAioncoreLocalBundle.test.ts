import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A supplied local bundle must never trigger a download or execute its binary.
const childProcess = require('node:child_process');
const execute = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
  throw new Error('Unexpected external process for an explicit local bundle');
});
const { prepareAioncore } = require('../../../packages/shared-scripts/src/prepare-aioncore');
afterAll(() => execute.mockRestore());

describe('prepare-aioncore local bundle input', () => {
  it.each([
    { version: 'v0.2.2', inPlace: true },
    { version: 'latest', inPlace: true },
    { version: 'v0.2.2', inPlace: false },
  ])('uses the explicit local bundle for $version (inPlace: $inPlace)', ({ version, inPlace }) => {
    const tmp = mkdtempSync(join(tmpdir(), 'openh3-local-bundle-'));
    const target = join(tmp, 'resources', 'bundled-aioncore', 'win32-x64');
    const bundle = inPlace ? target : join(tmp, 'bundle');
    const managed = join(bundle, 'managed-resources');
    mkdirSync(join(managed, 'node', 'runtime'), { recursive: true });
    writeFileSync(join(bundle, 'aioncore.exe'), 'verified-local-runtime');
    writeFileSync(join(managed, 'node', 'runtime', 'node.exe'), 'bundled-node');
    writeFileSync(
      join(managed, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: { version: '24.11.0', root: 'node/runtime', executable: 'node.exe' },
        clis: [],
      })
    );
    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = bundle;
    execute.mockClear();
    try {
      const result = prepareAioncore({ projectRoot: tmp, platform: 'win32', arch: 'x64', version });
      expect(result.sourceType).toBe('local-bundle');
      for (const root of [bundle, target]) {
        expect(readFileSync(join(root, 'aioncore.exe'), 'utf8')).toBe('verified-local-runtime');
        expect(readFileSync(join(root, 'managed-resources', 'node', 'runtime', 'node.exe'), 'utf8')).toBe(
          'bundled-node'
        );
      }
      expect(execute).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a missing explicit bundle without deleting the previous runtime or downloading a replacement', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openh3-missing-bundle-'));
    const bundle = join(tmp, 'resources', 'bundled-aioncore', 'win32-x64');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'aioncore.exe'), 'previous-runtime');
    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = join(tmp, 'missing');
    execute.mockClear();
    try {
      expect(() => prepareAioncore({ projectRoot: tmp, platform: 'win32', arch: 'x64', version: 'v0.2.2' })).toThrow(
        /Local backend bundle is incomplete or missing/
      );
      expect(readFileSync(join(bundle, 'aioncore.exe'), 'utf8')).toBe('previous-runtime');
      expect(execute).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hard fails local bundle input that lacks managed-resources manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore.exe'), '');

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'win32',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
