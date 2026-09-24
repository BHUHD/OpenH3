import fs from 'node:fs';
import { execFile } from 'node:child_process';
import type { H3Reference } from '@/common/chat/document/h3Job';
import { resolveMediaBinary } from '@/process/services/media/mediaBinary';

type ProbeResult = { stdout: string };
type RunProbe = (binary: string, args: string[]) => Promise<ProbeResult>;
type H3ReferencePreflightOptions = {
  binary?: string;
  fileExists?: (filename: string) => boolean;
  probeDuration?: (filename: string) => Promise<number>;
  runProbe?: RunProbe;
};

const MIN_DURATION_SECONDS = 2;
const MAX_DURATION_SECONDS = 15;
const DURATION_EPSILON = 0.001;

function runFfprobe(binary: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('H3_REFERENCE_PROBE_FAILED'));
      else resolve({ stdout });
    });
  });
}

export function parseFfprobeDuration(stdout: string): number {
  let result: { format?: { duration?: unknown }; streams?: Array<{ duration?: unknown }> };
  try {
    result = JSON.parse(stdout) as typeof result;
  } catch {
    throw new Error('H3_REFERENCE_PROBE_INVALID_JSON');
  }
  const values = [result.format?.duration, ...(result.streams ?? []).map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) throw new Error('H3_REFERENCE_DURATION_UNAVAILABLE');
  return Math.max(...values);
}

export class H3ReferencePreflight {
  private readonly binary: string;
  private readonly fileExists: (filename: string) => boolean;
  private readonly probeDuration: (filename: string) => Promise<number>;

  constructor(options: H3ReferencePreflightOptions = {}) {
    this.binary = options.binary ?? resolveMediaBinary('ffprobe');
    this.fileExists = options.fileExists ?? fs.existsSync;
    const runProbe = options.runProbe ?? runFfprobe;
    this.probeDuration =
      options.probeDuration ??
      (async (filename) => {
        const { stdout } = await runProbe(this.binary, [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=duration',
          '-of',
          'json',
          '--',
          filename,
        ]);
        return parseFfprobeDuration(stdout);
      });
  }

  async validate(references: H3Reference[]): Promise<void> {
    const totalDuration: Record<'video' | 'audio', number> = { video: 0, audio: 0 };
    for (const reference of references) {
      if (reference.type === 'image') continue;
      if (!this.fileExists(reference.path)) throw new Error('H3_REFERENCE_FILE_NOT_FOUND');
      const duration = await this.probeDuration(reference.path);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('H3_REFERENCE_DURATION_UNAVAILABLE');
      if (duration < MIN_DURATION_SECONDS - DURATION_EPSILON)
        throw new Error('H3_REFERENCE_DURATION_TOO_SHORT');
      if (duration > MAX_DURATION_SECONDS + DURATION_EPSILON)
        throw new Error('H3_REFERENCE_DURATION_TOO_LONG');
      totalDuration[reference.type] += duration;
      if (totalDuration[reference.type] > MAX_DURATION_SECONDS + DURATION_EPSILON)
        throw new Error(`H3_REFERENCE_TOTAL_DURATION_EXCEEDED:${reference.type}`);
    }
  }
}
