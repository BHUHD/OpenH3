import { DOMParser } from '@xmldom/xmldom';

export type GpuInfo = { name: string; totalMemoryMiB: number | null; freeMemoryMiB: number | null };
export type NvidiaReport = { driverVersion: string | null; driverCudaCapability: string | null; gpus: GpuInfo[] };
export type HardwareSnapshot = NvidiaReport & {
  platform: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  gpuProbe: { status: 'ok' } | { status: 'unavailable'; reason: 'NVIDIA_PROBE_FAILED' };
};

type ProbeInputs = {
  platform: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  execute: (command: string, args: string[]) => Promise<string>;
};

function memoryMiB(value: string | undefined): number | null {
  const match = /^(\d+)\s+MiB$/.exec(value?.trim() ?? '');
  const number = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/** Parse nvidia-smi XML with no shell parsing or filesystem/entity resolution. */
export function parseNvidiaReport(xml: string): NvidiaReport {
  const errors: string[] = [];
  const capture = (message: string): void => {
    errors.push(message);
  };
  const document = new DOMParser({
    errorHandler: { warning: capture, error: capture, fatalError: capture },
  }).parseFromString(xml, 'text/xml');
  if (errors.length || document.documentElement?.nodeName !== 'nvidia_smi_log')
    throw new Error('INVALID_NVIDIA_REPORT');
  const text = (name: string): string | null => document.getElementsByTagName(name)[0]?.textContent?.trim() || null;
  const nodes = document.getElementsByTagName('gpu');
  const gpus: GpuInfo[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const gpu = nodes[index];
    const memory = gpu.getElementsByTagName('fb_memory_usage')[0];
    gpus.push({
      name: gpu.getElementsByTagName('product_name')[0]?.textContent?.trim() || 'unknown',
      totalMemoryMiB: memoryMiB(memory?.getElementsByTagName('total')[0]?.textContent ?? undefined),
      freeMemoryMiB: memoryMiB(memory?.getElementsByTagName('free')[0]?.textContent ?? undefined),
    });
  }
  return { driverVersion: text('driver_version'), driverCudaCapability: text('cuda_version'), gpus };
}

/** Read a hardware snapshot; missing NVIDIA tooling is a diagnostic, not a crash. */
export async function collectHardware(inputs: ProbeInputs): Promise<HardwareSnapshot> {
  const host = {
    platform: inputs.platform,
    totalMemoryBytes: inputs.totalMemoryBytes,
    freeMemoryBytes: inputs.freeMemoryBytes,
  };
  try {
    const report = parseNvidiaReport(await inputs.execute('nvidia-smi', ['-q', '-x']));
    return { ...host, ...report, gpuProbe: { status: 'ok' } };
  } catch {
    return {
      ...host,
      driverVersion: null,
      driverCudaCapability: null,
      gpus: [],
      gpuProbe: { status: 'unavailable', reason: 'NVIDIA_PROBE_FAILED' },
    };
  }
}
