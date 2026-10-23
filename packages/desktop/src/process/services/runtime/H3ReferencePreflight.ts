import fs from 'node:fs';
import { execFile } from 'node:child_process';
import type { H3Reference } from '@/common/chat/document/h3Job';
import { resolveMediaBinary } from '@/process/services/media/mediaBinary';

type ProbeResult = { stdout: string };
type RunProbe = (binary: string, args: string[]) => Promise<ProbeResult>;
export type H3ReferenceMedia = { duration: number; audio: boolean; fps?: number };
type H3ReferencePreflightOptions = {
  binary?: string;
  fileExists?: (filename: string) => boolean;
  probeDuration?: (filename: string) => Promise<number>;
  probeMedia?: (filename: string) => Promise<H3ReferenceMedia>;
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

export function parseFfprobeMedia(stdout: string): H3ReferenceMedia {
  let result: {
    format?: { duration?: unknown };
    streams?: Array<{ duration?: unknown; codec_type?: unknown; avg_frame_rate?: string }>;
  };
  try {
    result = JSON.parse(stdout) as typeof result;
  } catch {
    throw new Error('H3_REFERENCE_PROBE_INVALID_JSON');
  }
  const values = [result.format?.duration, ...(result.streams ?? []).map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) throw new Error('H3_REFERENCE_DURATION_UNAVAILABLE');
  const video = result.streams?.find((stream) => stream.codec_type === 'video');
  const [numerator, denominator] = (video?.avg_frame_rate ?? '').split('/').map(Number);
  const fps = denominator > 0 ? numerator / denominator : NaN;
  return {
    duration: Math.max(...values),
    audio: result.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
    ...(Number.isFinite(fps) && fps > 0 ? { fps } : {}),
  };
}

export class H3ReferencePreflight {
  private readonly binary: string;
  private readonly fileExists: (filename: string) => boolean;
  private readonly probeMedia: (filename: string) => Promise<H3ReferenceMedia>;

  constructor(options: H3ReferencePreflightOptions = {}) {
    this.binary = options.binary ?? resolveMediaBinary('ffprobe');
    this.fileExists = options.fileExists ?? fs.existsSync;
    const runProbe = options.runProbe ?? runFfprobe;
    this.probeMedia =
      options.probeMedia ??
      (options.probeDuration
        ? async (filename) => ({ duration: await options.probeDuration!(filename), audio: false })
        : async (filename) => {
            const { stdout } = await runProbe(this.binary, [
              '-v',
              'error',
              '-show_entries',
              'format=duration:stream=duration,codec_type,avg_frame_rate',
              '-of',
              'json',
              '--',
              filename,
            ]);
            return parseFfprobeMedia(stdout);
          });
  }

  async validate(references: H3Reference[]): Promise<void> {
    await this.inspect(references);
  }

  /** Validate limits and report whether each video has a soundtrack for Omni tag pairing. */
  async inspect(references: H3Reference[]): Promise<Map<string, H3ReferenceMedia>> {
    const totalDuration: Record<'video' | 'audio', number> = { video: 0, audio: 0 };
    const inspected = new Map<string, H3ReferenceMedia>();
    for (const reference of references) {
      if (reference.type === 'image') continue;
      if (!this.fileExists(reference.path)) throw new Error('H3_REFERENCE_FILE_NOT_FOUND');
      const media = await this.probeMedia(reference.path);
      const duration = media.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('H3_REFERENCE_DURATION_UNAVAILABLE');
      if (duration < MIN_DURATION_SECONDS - DURATION_EPSILON) throw new Error('H3_REFERENCE_DURATION_TOO_SHORT');
      if (duration > MAX_DURATION_SECONDS + DURATION_EPSILON) throw new Error('H3_REFERENCE_DURATION_TOO_LONG');
      totalDuration[reference.type] += duration;
      if (totalDuration[reference.type] > MAX_DURATION_SECONDS + DURATION_EPSILON)
        throw new Error(`H3_REFERENCE_TOTAL_DURATION_EXCEEDED:${reference.type}`);
      inspected.set(reference.path, media);
    }
    return inspected;
  }
}
