import { describe, expect, it } from 'vitest';
import { buildVideoDraft } from '@/common/chat/document/videoDraft';

const file = { kind: 'project' as const, pe_id: 'project', relative_path: 'clips/demo.mp4' };
const range = { startSeconds: 1.25, endSeconds: 4.5, durationSeconds: 6, lastModified: 123 };

describe('video selection draft', () => {
  it('preserves the original file reference and seconds without pretending to know frame PTS or a hash', () => {
    const result = buildVideoDraft(file, range);
    expect(result.files).toEqual([file]);
    expect(JSON.parse(result.prompt)).toMatchObject({ type: 'video-selection', timeUnit: 'seconds', ...range });
    expect(result.prompt).not.toContain('contentHash');
  });
  it.each([
    { startSeconds: -1 },
    { endSeconds: 7 },
    { startSeconds: 4.5 },
    { durationSeconds: Infinity },
    { endSeconds: NaN },
    { lastModified: -1 },
  ])('rejects invalid range %j', (patch) => {
    expect(() => buildVideoDraft(file, { ...range, ...patch })).toThrow();
  });
  it('rejects a folder reference', () => {
    expect(() => buildVideoDraft({ ...file, relative_path: '' }, range)).toThrow();
  });
  it('returns an independent reference snapshot', () => {
    const copy = { ...file };
    const draft = buildVideoDraft(copy, range);
    copy.relative_path = 'other.mp4';
    expect(draft.files).toEqual([file]);
  });
});
