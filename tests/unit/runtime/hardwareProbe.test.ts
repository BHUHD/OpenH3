import { describe, expect, it, vi } from 'vitest';
import { collectHardware, parseNvidiaReport } from '@process/services/runtime/hardwareProbe';

const xml = `<nvidia_smi_log><driver_version>576.80</driver_version><cuda_version>12.9</cuda_version>
<gpu><product_name>NVIDIA GeForce GTX 1080</product_name><fb_memory_usage><total>8192 MiB</total><free>7000 MiB</free></fb_memory_usage></gpu>
</nvidia_smi_log>`;

describe('read-only hardware discovery', () => {
  it('parses NVIDIA structured output without treating driver CUDA support as an installed runtime', () => {
    expect(parseNvidiaReport(xml)).toEqual({
      driverVersion: '576.80',
      driverCudaCapability: '12.9',
      gpus: [{ name: 'NVIDIA GeForce GTX 1080', totalMemoryMiB: 8192, freeMemoryMiB: 7000 }],
    });
  });

  it('preserves unknown memory as null rather than zero or NaN', () => {
    expect(parseNvidiaReport(xml.replace('8192 MiB', 'N/A')).gpus[0].totalMemoryMiB).toBeNull();
  });

  it.each(['not xml', '<other/>', '<nvidia_smi_log><gpu></nvidia_smi_log>'])(
    'rejects malformed or unrelated output',
    (input) => {
      expect(() => parseNvidiaReport(input)).toThrow();
    }
  );

  it('reports probe failure without inventing an absent GPU or aborting all diagnostics', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('not installed'));
    const result = await collectHardware({
      platform: 'win32',
      totalMemoryBytes: 32 * 2 ** 30,
      freeMemoryBytes: 16 * 2 ** 30,
      execute,
    });
    expect(result.gpuProbe).toEqual({ status: 'unavailable', reason: 'NVIDIA_PROBE_FAILED' });
    expect(result.gpus).toEqual([]);
  });

  it('executes only the fixed NVIDIA query', async () => {
    const execute = vi.fn().mockResolvedValue(xml);
    await collectHardware({
      platform: 'linux',
      totalMemoryBytes: 384 * 2 ** 30,
      freeMemoryBytes: 300 * 2 ** 30,
      execute,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith('nvidia-smi', ['-q', '-x']);
  });
});
