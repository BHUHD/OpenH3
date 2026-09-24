import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildH3AccelerationEnv,
  buildH3AccelerationInstallPlan,
  ensureH3AccelerationLauncher,
  H3AccelerationInstaller,
  installH3AccelerationDependencies,
  resolveH3Acceleration,
} from '@/process/services/runtime/h3Acceleration';
import { createHash } from 'node:crypto';

function root(prefix: string): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(value, 'triton'), { recursive: true });
  fs.mkdirSync(path.join(value, 'include'), { recursive: true });
  fs.writeFileSync(path.join(value, 'include', 'Python.h'), '');
  return value;
}

describe('H3 acceleration environment detection', () => {
  it('falls back to dense when no acceleration root is configured', () =>
    expect(resolveH3Acceleration({ env: {} }).reason).toBe('ACCEL_ROOT_NOT_CONFIGURED'));
  it('enables automatic acceleration when dependencies exist', () =>
    expect(resolveH3Acceleration({ root: root('h3-auto-'), env: {} })).toMatchObject({
      backend: 'sla',
      available: true,
    }));
  it('accepts an explicitly selected external root without hardcoded machine paths', () =>
    expect(resolveH3Acceleration({ mode: 'sla', root: root('h3-accel-'), env: {} })).toMatchObject({
      backend: 'sla',
      available: true,
    }));
  it('injects only the configured root', () => {
    const value = root('h3-accel-env-');
    const env = buildH3AccelerationEnv({ mode: 'sla', root: value, env: { PYTHONPATH: 'existing' } });
    expect(env.PYTHONPATH?.split(path.delimiter)).toEqual([value, 'existing']);
    expect(env.AIONUI_H3_ACCEL_BACKEND).toBe('sla');
  });
  it('honors dense mode', () =>
    expect(resolveH3Acceleration({ root: root('h3-accel-dense-'), mode: 'dense', env: {} })).toMatchObject({
      backend: 'dense',
      reason: 'FORCED_DENSE',
    }));

  it('selects a matching Windows Triton plan for Python 3.13 and PyTorch 2.13', () => {
    const plan = buildH3AccelerationInstallPlan({
      platform: 'win32',
      pythonVersion: '3.13.14',
      torchVersion: '2.13.0+cu130',
      cudaVersion: '13.0',
      gpuName: 'NVIDIA GeForce RTX 5080',
      gpuCapability: [12, 0],
      targetRoot: 'D:/AionUi/h3-accel',
    });
    expect(plan).toMatchObject({
      supported: true,
      tritonVersion: '3.7.1.post27',
      needsPythonDevFiles: true,
      dryRun: true,
    });
  });

  it('rejects an unsupported CPU or old Blackwell CUDA environment without throwing', () => {
    const plan = buildH3AccelerationInstallPlan({
      platform: 'win32',
      pythonVersion: '3.12.7',
      torchVersion: '2.12.0',
      cudaVersion: '12.4',
      gpuName: 'NVIDIA GeForce RTX 5080',
      gpuCapability: [12, 0],
      targetRoot: 'D:/AionUi/h3-accel',
    });
    expect(plan.supported).toBe(false);
    expect(plan.reasons).toEqual(
      expect.arrayContaining(['PYTHON_VERSION_UNSUPPORTED', 'PYTORCH_VERSION_UNSUPPORTED', 'BLACKWELL_CUDA_TOO_OLD'])
    );
  });

  it('supports an opt-in dry-run without invoking pip', async () => {
    let invoked = false;
    const result = await new H3AccelerationInstaller({
      execute: async () => {
        invoked = true;
      },
    }).install({
      platform: 'win32',
      pythonVersion: '3.13.14',
      torchVersion: '2.13.0+cu130',
      cudaVersion: '13.0',
      gpuName: 'NVIDIA GeForce RTX 5080',
      gpuCapability: [12, 0],
      targetRoot: path.join(os.tmpdir(), 'h3-dry-run'),
      pythonExecutable: 'python',
      dryRun: true,
    });
    expect(result).toMatchObject({ dryRun: true, installed: false, supported: true });
    expect(invoked).toBe(false);
  });

  it('creates an external launcher for embedded Python isolation mode', () => {
    const value = root('h3-launcher-');
    const launcher = ensureH3AccelerationLauncher(value, 'D:/ComfyUI_windows_portable', value);
    const source = fs.readFileSync(launcher, 'utf8');
    expect(source).toContain('runpy.run_path');
    expect(source).toContain("runtime_root, 'ComfyUI'");
    expect(source).toContain('python_dev_root');
  });

  it('installs into the external target and records a marker without touching the main runtime', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-install-'));
    let args: string[] = [];
    const result = await new H3AccelerationInstaller({
      execute: async (_python, received) => {
        args = received;
      },
    }).install({
      platform: 'win32',
      pythonVersion: '3.13.14',
      torchVersion: '2.13.0+cu130',
      cudaVersion: '13.0',
      gpuName: 'NVIDIA GeForce RTX 5080',
      gpuCapability: [12, 0],
      targetRoot: target,
      pythonExecutable: 'portable-python',
    });
    expect(result.installed).toBe(true);
    expect(args).toContain(target);
    expect(fs.existsSync(path.join(target, '.h3-acceleration.json'))).toBe(true);
  });

  it('downloads pinned Triton and official Python development files before offline installation', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-deps-'));
    const wheelData = Buffer.from('wheel');
    const pythonData = Buffer.from('python-dev');
    const wheelHash = createHash('sha256').update(wheelData).digest('hex');
    const pythonHash = createHash('sha512').update(pythonData).digest('base64');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('pypi.org/pypi/'))
        return Response.json({
          releases: {
            '3.7.1.post27': [
              {
                filename: 'triton_windows-3.7.1.post27-cp313-cp313-win_amd64.whl',
                url: 'https://files.test/triton.whl',
                packagetype: 'bdist_wheel',
                size: wheelData.length,
                digests: { sha256: wheelHash },
              },
            ],
          },
        });
      if (url.includes('triton.whl'))
        return new Response(init?.method === 'HEAD' ? null : wheelData, {
          headers: { 'content-length': String(wheelData.length) },
        });
      if (url.includes('registration5'))
        return Response.json({
          packageContent: 'https://files.test/python.nupkg',
          catalogEntry: 'https://api.nuget.org/v3/catalog0/python.json',
        });
      if (url.includes('nuget.org'))
        return Response.json({
          packageContent: 'https://files.test/python.nupkg',
          packageSize: pythonData.length,
          packageHash: pythonHash,
          packageHashAlgorithm: 'SHA512',
        });
      return new Response(pythonData, { headers: { 'content-length': String(pythonData.length) } });
    }) as typeof fetch;
    const executed: string[][] = [];
    const result = await installH3AccelerationDependencies({
      platform: 'win32',
      pythonVersion: '3.13.14',
      torchVersion: '2.13.0',
      cudaVersion: '13.0',
      gpuName: 'NVIDIA RTX 5080',
      gpuCapability: [12, 0],
      targetRoot: path.join(rootDir, 'installed'),
      downloadRoot: path.join(rootDir, 'downloads'),
      pythonExecutable: 'python',
      fetchImpl,
      execute: async (_python, args) => {
        executed.push(args);
      },
    });
    expect(result).toMatchObject({ installed: true, backend: 'sla' });
    expect(executed).toHaveLength(3);
    expect(fs.existsSync(path.join(rootDir, 'installed', '.h3-acceleration.json'))).toBe(true);
  });
});

it('honors a failed dependency setup even when partially installed files exist', () => {
  const directory = root('h3-partial-');
  try {
    fs.writeFileSync(path.join(directory, '.h3-acceleration-fallback.json'), '{}');
    expect(resolveH3Acceleration({ root: directory, env: {} })).toMatchObject({ backend: 'dense', available: false, reason: 'ACCELERATION_INSTALL_FAILED' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
