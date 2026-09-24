import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { downloadH3FromSources, fetchH3Download } from './h3Downloader';
import { buildH3DownloadPlan, type H3SourceConfig } from './h3DownloadPlan';
import type { H3DownloadProgress } from '@/common/chat/document/h3Setup';

export type H3AccelerationMode = 'auto' | 'dense' | 'sla';
export type H3AccelerationStatus = {
  mode: H3AccelerationMode;
  backend: 'dense' | 'sla';
  available: boolean;
  root?: string;
  tritonPresent: boolean;
  pythonDevPresent: boolean;
  reason: string;
};
export type H3AccelerationOptions = {
  mode?: H3AccelerationMode;
  root?: string;
  pythonDevRoot?: string;
  env?: NodeJS.ProcessEnv;
};
export type H3AccelerationInstallInput = {
  platform: NodeJS.Platform;
  pythonVersion: string;
  torchVersion: string;
  cudaVersion?: string;
  gpuName?: string;
  gpuCapability?: [number, number];
  targetRoot: string;
};
export type H3AccelerationInstallPlan = {
  supported: boolean;
  targetRoot: string;
  tritonVersion?: string;
  tritonWheelUrl?: string;
  needsPythonDevFiles: boolean;
  reasons: string[];
  dryRun: true;
};
export type H3PythonDevBundle = {
  url: string;
  sizeBytes: number;
  sha512: string;
  archiveType: 'zip';
};
export type H3AccelerationDependencyOptions = {
  fetchImpl?: typeof fetch;
  downloadRoot: string;
  pythonExecutable: string;
  targetRoot: string;
  pythonDevBundle?: H3PythonDevBundle;
  execute?: (python: string, args: string[]) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (detail: H3DownloadProgress) => void;
};
export type H3AccelerationDependencyResult = {
  installed: boolean;
  backend: 'sla' | 'dense';
  reason: string;
  plan?: H3AccelerationInstallPlan;
};
export type H3AccelerationInstallerOptions = {
  execute?: (python: string, args: string[]) => Promise<void>;
  fsImpl?: typeof fs;
};

const TRITON_WINDOWS_RELEASE = 'https://github.com/triton-lang/triton-windows/releases/download/v3.0.0-windows.post1';

export function buildH3AccelerationInstallPlan(input: H3AccelerationInstallInput): H3AccelerationInstallPlan {
  const reasons: string[] = [];
  if (input.platform !== 'win32') reasons.push('WINDOWS_ACCEL_BUNDLE_ONLY');
  const python = /^3\.(\d+)/.exec(input.pythonVersion)?.[1];
  if (python !== '13') reasons.push('PYTHON_VERSION_UNSUPPORTED');
  const torch = /^2\.(\d+)/.exec(input.torchVersion)?.[1];
  const tritonVersion = torch === '13' ? '3.7.1.post27' : torch === '14' ? '3.8.0.post28' : undefined;
  if (!tritonVersion) reasons.push('PYTORCH_VERSION_UNSUPPORTED');
  if (
    input.gpuCapability &&
    input.gpuCapability[0] >= 12 &&
    (!input.cudaVersion || Number.parseFloat(input.cudaVersion) < 12.8)
  )
    reasons.push('BLACKWELL_CUDA_TOO_OLD');
  if (!input.gpuName?.toLowerCase().includes('nvidia')) reasons.push('NVIDIA_GPU_NOT_DETECTED');
  return {
    supported: reasons.length === 0,
    targetRoot: input.targetRoot,
    tritonVersion,
    tritonWheelUrl: tritonVersion
      ? `${TRITON_WINDOWS_RELEASE}/triton_windows-${tritonVersion}-cp313-cp313-win_amd64.whl`
      : undefined,
    needsPythonDevFiles: true,
    reasons,
    dryRun: true,
  };
}

function defaultExecute(python: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(python, args, { windowsHide: true, timeout: 300000 }, (error) => (error ? reject(error) : resolve()));
  });
}

export class H3AccelerationInstaller {
  constructor(private readonly options: H3AccelerationInstallerOptions = {}) {}

  async install(
    input: H3AccelerationInstallInput & { pythonExecutable: string; dryRun?: boolean }
  ): Promise<H3AccelerationInstallPlan & { installed: boolean }> {
    const plan = buildH3AccelerationInstallPlan(input);
    if (input.dryRun || !plan.supported) return { ...plan, installed: false };
    const fsImpl = this.options.fsImpl ?? fs;
    const target = path.resolve(input.targetRoot);
    fsImpl.mkdirSync(target, { recursive: true });
    try {
      await (this.options.execute ?? defaultExecute)(input.pythonExecutable, [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '--no-deps',
        '--target',
        target,
        `triton-windows==${plan.tritonVersion}`,
      ]);
      fsImpl.writeFileSync(
        path.join(target, '.h3-acceleration.json'),
        JSON.stringify({ plan, installedAt: new Date().toISOString() }, null, 2)
      );
      return { ...plan, installed: true };
    } catch (error) {
      return {
        ...plan,
        installed: false,
        reasons: [...plan.reasons, error instanceof Error ? `INSTALL_FAILED:${error.message}` : 'INSTALL_FAILED'],
      };
    }
  }
}

type PyPiFile = { size?: number; filename?: string; url?: string; digests?: { sha256?: string }; packagetype?: string };

async function fetchAccelerationMetadata(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetchH3Download(String(input), init ?? {});
  const bytes = Buffer.from(await response.arrayBuffer());
  const body = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return new Response(body, { status: response.status });
}

async function resolvePyPiWheel(
  version: string,
  fetchImpl: typeof fetch = fetchAccelerationMetadata
): Promise<{ url: string; filename: string; sha256: string; sizeBytes: number }> {
  const response = await fetchImpl('https://pypi.org/pypi/triton-windows/json', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`H3_ACCELERATION_PYPI_HTTP_${response.status}`);
  const payload = (await response.json()) as { releases?: Record<string, PyPiFile[]> };
  const files = payload.releases?.[version] ?? [];
  const file = files.find(
    (candidate) =>
      candidate.packagetype === 'bdist_wheel' &&
      candidate.filename?.endsWith('-cp313-cp313-win_amd64.whl') &&
      typeof candidate.url === 'string' &&
      /^[a-f0-9]{64}$/i.test(candidate.digests?.sha256 ?? '')
  );
  if (!file?.url || !file.filename || !file.digests?.sha256) throw new Error('H3_ACCELERATION_WHEEL_UNAVAILABLE');
  const sizeBytes = file.size ?? 0;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error('H3_ACCELERATION_WHEEL_SIZE_UNKNOWN');
  return { url: file.url, filename: file.filename, sha256: file.digests.sha256, sizeBytes };
}

async function resolvePythonDevBundle(
  version: string,
  fetchImpl: typeof fetch = fetchAccelerationMetadata
): Promise<H3PythonDevBundle> {
  const response = await fetchImpl(
    `https://api.nuget.org/v3/registration5-gz-semver2/python/${encodeURIComponent(version)}.json`,
    {
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) throw new Error(`H3_ACCELERATION_PYTHON_HTTP_${response.status}`);
  const registration = (await response.json()) as { packageContent?: string; catalogEntry?: string };
  if (!registration.catalogEntry?.startsWith('https://api.nuget.org/v3/catalog0/'))
    throw new Error('H3_ACCELERATION_PYTHON_METADATA_INVALID');
  const catalog = await fetchImpl(registration.catalogEntry, { signal: AbortSignal.timeout(15000) });
  if (!catalog.ok) throw new Error('H3_ACCELERATION_PYTHON_CATALOG_FAILED');
  const payload = { ...(await catalog.json()), packageContent: registration.packageContent } as {
    packageContent?: string;
    packageSize?: number;
    packageHash?: string;
    packageHashAlgorithm?: string;
  };
  if (
    !payload.packageContent ||
    !Number.isSafeInteger(payload.packageSize) ||
    payload.packageSize <= 0 ||
    payload.packageHashAlgorithm !== 'SHA512' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(payload.packageHash ?? '')
  )
    throw new Error('H3_ACCELERATION_PYTHON_METADATA_INVALID');
  return {
    url: payload.packageContent,
    sizeBytes: payload.packageSize,
    sha512: payload.packageHash,
    archiveType: 'zip',
  };
}

/** Install the optional path during H3 setup; every remote artifact is pinned before install. */
export async function installH3AccelerationDependencies(
  input: H3AccelerationInstallInput & H3AccelerationDependencyOptions
): Promise<H3AccelerationDependencyResult> {
  const plan = buildH3AccelerationInstallPlan(input);
  if (!plan.supported)
    return { installed: false, backend: 'dense', reason: plan.reasons.join(',') || 'UNSUPPORTED', plan };
  input.signal?.throwIfAborted();
  const bundleRoot = path.dirname(input.downloadRoot);
  const configFile = path.join(bundleRoot, 'download-sources.json');
  const config: H3SourceConfig = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''))
    : {};
  buildH3DownloadPlan(config); // Apply the same LAN/source validation as model downloads.
  const metadataFile = path.join(input.downloadRoot, `manifest-${input.pythonVersion}-${plan.tritonVersion}.json`);
  const cached = fs.existsSync(metadataFile)
    ? (JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as {
        pythonDevBundle: H3PythonDevBundle;
        wheel: Awaited<ReturnType<typeof resolvePyPiWheel>>;
      })
    : undefined;
  if (!cached && config.publicSources === false) throw new Error('H3_ACCELERATION_OFFLINE_MANIFEST_REQUIRED');
  const pythonDevBundle =
    input.pythonDevBundle ??
    cached?.pythonDevBundle ??
    (await resolvePythonDevBundle(input.pythonVersion, input.fetchImpl));
  const wheel = cached?.wheel ?? (await resolvePyPiWheel(plan.tritonVersion!, input.fetchImpl));
  if (path.basename(wheel.filename) !== wheel.filename || !/^triton_windows-[\w.-]+\.whl$/.test(wheel.filename))
    throw new Error('H3_ACCELERATION_WHEEL_NAME_INVALID');
  fs.mkdirSync(input.downloadRoot, { recursive: true });
  fs.writeFileSync(metadataFile, JSON.stringify({ wheel, pythonDevBundle }, null, 2));
  const sources = (url: string, filename: string): string[] => [
    ...(config.baseUrls ?? []).map(
      (base) => base.replace(/\/$/, '') + '/acceleration-download/' + encodeURIComponent(filename)
    ),
    ...(config.publicSources === false ? [] : [url]),
  ];
  const wheelPath = path.join(input.downloadRoot, wheel.filename);
  await downloadH3FromSources(
    {
      url: wheel.url,
      urls: sources(wheel.url, wheel.filename),
      destination: wheelPath,
      sizeBytes: wheel.sizeBytes,
      sha256: wheel.sha256,
    },
    {
      fetchImpl: input.fetchImpl,
      maxAttempts: 3,
      signal: input.signal,
      onProgress: (bytes, totalBytes) =>
        input.onProgress?.({ filename: wheel.filename, bytes, totalBytes: totalBytes ?? 0 }),
    }
  );
  const devPath = path.join(input.downloadRoot, 'python-dev.zip');
  await downloadH3FromSources(
    {
      url: pythonDevBundle.url,
      urls: sources(pythonDevBundle.url, 'python-dev.zip'),
      destination: devPath,
      sizeBytes: pythonDevBundle.sizeBytes,
      sha512: pythonDevBundle.sha512,
    },
    {
      fetchImpl: input.fetchImpl,
      maxAttempts: 3,
      signal: input.signal,
      onProgress: (bytes, totalBytes) =>
        input.onProgress?.({
          filename: 'Python ' + input.pythonVersion + ' development files',
          bytes,
          totalBytes: totalBytes ?? 0,
        }),
    }
  );
  input.signal?.throwIfAborted();
  fs.mkdirSync(input.targetRoot, { recursive: true });
  await (input.execute ?? defaultExecute)(input.pythonExecutable, [
    '-c',
    "import os, shutil, sys, zipfile; root=sys.argv[2]; zipfile.ZipFile(sys.argv[1]).extractall(root); tools=os.path.join(root, 'tools'); shutil.copytree(os.path.join(tools, 'include'), os.path.join(root, 'include'), dirs_exist_ok=True); shutil.copytree(os.path.join(tools, 'libs'), os.path.join(root, 'libs'), dirs_exist_ok=True); shutil.rmtree(tools, ignore_errors=True)",
    devPath,
    input.targetRoot,
  ]);
  await (input.execute ?? defaultExecute)(input.pythonExecutable, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    '--no-deps',
    '--no-index',
    '--target',
    input.targetRoot,
    wheelPath,
  ]);
  input.signal?.throwIfAborted();
  await (input.execute ?? defaultExecute)(input.pythonExecutable, [
    '-c',
    "import sys,pathlib; root=pathlib.Path(sys.argv[1]); sys.path.insert(0,str(root)); import triton; assert (root/'include'/'Python.h').is_file(); assert (root/'libs'/'python313.lib').is_file()",
    input.targetRoot,
  ]);
  fs.writeFileSync(
    path.join(input.targetRoot, '.h3-acceleration.json'),
    JSON.stringify({ plan, wheel, pythonDevBundle, installedAt: new Date().toISOString() }, null, 2)
  );
  fs.rmSync(path.join(input.targetRoot, '.h3-acceleration-fallback.json'), { force: true });
  return { installed: true, backend: 'sla', reason: 'SLA_ACCELERATION_INSTALLED', plan };
}

/** Prepare optional dependencies once per installed environment; failures keep Dense usable. */
export async function prepareH3Acceleration(
  bundleRoot: string,
  runtimeRoot: string,
  options: { signal?: AbortSignal; retry?: boolean; onProgress?: (detail: H3DownloadProgress) => void } = {}
): Promise<void> {
  if (process.env.AIONUI_H3_ACCEL_MODE === 'dense') return;
  const targetRoot = path.join(bundleRoot, 'acceleration');
  const marker = path.join(targetRoot, '.h3-acceleration.json');
  const fallback = path.join(targetRoot, '.h3-acceleration-fallback.json');
  if (
    !options.retry &&
    (fs.existsSync(fallback) ||
      (fs.existsSync(marker) &&
        fs.existsSync(path.join(targetRoot, 'triton', '__init__.py')) &&
        fs.existsSync(path.join(targetRoot, 'include', 'Python.h')) &&
        fs.existsSync(path.join(targetRoot, 'libs', 'python313.lib'))))
  )
    return;
  const python = path.join(runtimeRoot, 'python_embeded', 'python.exe');
  try {
    options.signal?.throwIfAborted();
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        python,
        [
          '-c',
          "import json,sys; import torch; print(json.dumps({'python':sys.version.split()[0], 'torch':torch.__version__, 'cuda':torch.version.cuda, 'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else '', 'capability':torch.cuda.get_device_capability(0) if torch.cuda.is_available() else None}))",
        ],
        { windowsHide: true, timeout: 60000, signal: options.signal },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      );
    });
    const probe = JSON.parse(stdout.trim()) as {
      python: string;
      torch: string;
      cuda?: string;
      gpu?: string;
      capability?: [number, number];
    };
    const result = await installH3AccelerationDependencies({
      platform: process.platform,
      pythonVersion: probe.python,
      torchVersion: probe.torch,
      cudaVersion: probe.cuda,
      gpuName: probe.gpu,
      gpuCapability: probe.capability,
      targetRoot,
      downloadRoot: path.join(bundleRoot, 'acceleration-download'),
      pythonExecutable: python,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    if (!result.installed) throw new Error(result.reason);
  } catch (error) {
    options.signal?.throwIfAborted();
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(
      fallback,
      JSON.stringify({
        backend: 'dense',
        reason: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      })
    );
  }
}

function has(root: string | undefined, relativePath: string): boolean {
  return Boolean(root && fs.existsSync(path.join(root, relativePath)));
}

export function resolveH3Acceleration(options: H3AccelerationOptions = {}): H3AccelerationStatus {
  const env = options.env ?? process.env;
  const mode = options.mode ?? (env.AIONUI_H3_ACCEL_MODE as H3AccelerationMode | undefined) ?? 'auto';
  const root = options.root ?? (env.AIONUI_H3_ACCEL_ROOT?.trim() || undefined);
  const pythonDevRoot = options.pythonDevRoot ?? (env.AIONUI_PYTHON_DEV_ROOT?.trim() || root);
  const tritonPresent = has(root, 'triton') || has(root, path.join('site-packages', 'triton'));
  const pythonDevPresent =
    has(pythonDevRoot, path.join('include', 'Python.h')) ||
    has(pythonDevRoot, path.join('python313', 'include', 'Python.h'));
  if (mode === 'dense')
    return { mode, backend: 'dense', available: false, root, tritonPresent, pythonDevPresent, reason: 'FORCED_DENSE' };
  if (root && fs.existsSync(path.join(root, '.h3-acceleration-fallback.json')))
    return {
      mode,
      backend: 'dense',
      available: false,
      root,
      tritonPresent,
      pythonDevPresent,
      reason: 'ACCELERATION_INSTALL_FAILED',
    };
  if (!root)
    return {
      mode,
      backend: 'dense',
      available: false,
      tritonPresent: false,
      pythonDevPresent: false,
      reason: 'ACCEL_ROOT_NOT_CONFIGURED',
    };
  if (!tritonPresent)
    return {
      mode,
      backend: 'dense',
      available: false,
      root,
      tritonPresent,
      pythonDevPresent,
      reason: 'TRITON_NOT_FOUND',
    };
  if (!pythonDevPresent)
    return {
      mode,
      backend: 'dense',
      available: false,
      root,
      tritonPresent,
      pythonDevPresent,
      reason: 'PYTHON_DEV_FILES_NOT_FOUND',
    };
  return {
    mode,
    backend: 'sla',
    available: true,
    root,
    tritonPresent,
    pythonDevPresent,
    reason: 'SLA_ACCELERATION_AVAILABLE',
  };
}

export function buildH3AccelerationEnv(options: H3AccelerationOptions = {}): NodeJS.ProcessEnv {
  const env = { ...(options.env ?? process.env) };
  const status = resolveH3Acceleration(options);
  if (status.backend !== 'sla' || !status.root) return env;
  env.PYTHONPATH = [status.root, ...(env.PYTHONPATH?.split(path.delimiter).filter(Boolean) ?? [])].join(path.delimiter);
  env.AIONUI_H3_ACCEL_BACKEND = 'sla';
  return env;
}

export function ensureH3AccelerationLauncher(root: string, runtimeRoot: string, pythonDevRoot?: string): string {
  fs.mkdirSync(root, { recursive: true });
  const launcher = path.join(root, 'aionui_h3_accel_launcher.py');
  const source =
    `import os, runpy, sys\n` +
    `runtime_root = os.environ['AIONUI_H3_RUNTIME_ROOT']\n` +
    `accel_root = os.environ['AIONUI_H3_ACCEL_ROOT']\n` +
    `python_dev_root = os.environ.get('AIONUI_PYTHON_DEV_ROOT', '')\n` +
    `sys.path.insert(0, accel_root)\n` +
    `sys.path.insert(0, os.path.join(runtime_root, 'ComfyUI'))\n` +
    `if python_dev_root: os.environ['AIONUI_PYTHON_DEV_ROOT'] = python_dev_root\n` +
    `os.environ.setdefault('CC', os.path.join(accel_root, 'triton', 'runtime', 'tcc', 'tcc.exe'))\n` +
    `os.environ.setdefault('CUDA_PATH', os.path.join(accel_root, 'triton', 'backends', 'nvidia'))\n` +
    `import sysconfig\n` +
    `_paths = sysconfig.get_paths\n` +
    `def _patched_paths(*args, **kwargs):\n` +
    `    result = _paths(*args, **kwargs).copy()\n` +
    `    if python_dev_root:\n` +
    `        result['include'] = os.path.join(python_dev_root, 'include')\n` +
    `    return result\n` +
    `sysconfig.get_paths = _patched_paths\n` +
    `try:\n` +
    `    import triton.runtime.build\n` +
    `    if python_dev_root:\n` +
    `        triton.runtime.build.find_python = lambda: [os.path.join(python_dev_root, 'libs')]\n` +
    `except Exception:\n` +
    `    pass\n` +
    `sys.argv = [os.path.join(runtime_root, 'ComfyUI', 'main.py')] + sys.argv[1:]\n` +
    `runpy.run_path(sys.argv[0], run_name='__main__')\n`;
  fs.writeFileSync(launcher, source, 'utf8');
  return launcher;
}
