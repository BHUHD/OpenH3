import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeMediaArtifact, validateMediaArtifact } from '@/process/services/media/mediaArtifact';

describe('media artifacts', () => {
  it('requires a non-empty output and removes it on cleanup', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'media-')), 'out.mp4');
    const spec = { kind: 'transcode' as const, sourcePath: 'in.mp4', outputPath: file };
    expect(() => validateMediaArtifact(spec)).toThrow('MEDIA_OUTPUT_MISSING');
    fs.writeFileSync(file, 'x');
    expect(() => validateMediaArtifact(spec)).not.toThrow();
    removeMediaArtifact(spec);
    expect(fs.existsSync(file)).toBe(false);
  });
  it('does not require an output for probe jobs', () => {
    expect(() => validateMediaArtifact({ kind: 'probe', sourcePath: 'in.mp4' })).not.toThrow();
  });
});
