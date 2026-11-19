import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createH3Job, type H3Job } from '@/common/chat/document/h3Job';
import { H3VersionStore } from '@/process/services/runtime/H3VersionStore';

describe('H3 version store', () => {
  it('publishes a new root once and leaves a recovered job without a recorded parent as a candidate', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-versions-publish-'));
    const file = path.join(directory, 'versions.json');
    const store = new H3VersionStore(file);
    const completed = (id: string): H3Job => ({
      ...createH3Job({ prompt: id }, id),
      status: 'succeeded',
      artifacts: [
        {
          filename: 'clip.mp4',
          subfolder: '',
          type: 'output',
          mimeType: 'video/mp4',
          resourcePath: `/artifacts/${id}`,
        },
      ],
    });
    try {
      const first = { ...completed('new'), ...store.submissionContext() };
      store.publishCompletedJob(first);
      store.publishCompletedJob(first);
      store.publishCompletedJob(completed('legacy'));
      const recovered = new H3VersionStore(file);
      expect(recovered.list()).toHaveLength(2);
      expect(recovered.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ jobId: 'new', parentId: null, selected: true, review: 'accepted' }),
          expect.objectContaining({ jobId: 'legacy', parentId: null, selected: false, review: 'candidate' }),
        ])
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists versions and selects exactly one candidate', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h3-versions-')), 'versions.json');
    const store = new H3VersionStore(file);
    store.create({
      id: 'v1',
      parentId: null,
      label: 'H3 1',
      jobId: 'j1',
      createdAt: '2026-01-01T00:00:00Z',
      selected: true,
    });
    store.create({
      id: 'v2',
      parentId: 'v1',
      label: 'H3 2',
      jobId: 'j2',
      createdAt: '2026-01-01T00:00:01Z',
      selected: false,
    });
    expect(
      store
        .select('v2')
        .filter((version) => version.selected)
        .map((version) => version.id)
    ).toEqual(['v2']);
    expect(new H3VersionStore(file).list().find((version) => version.selected)?.id).toBe('v2');
  });

  it('rejects a stale candidate acceptance instead of overwriting a newer selected version', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h3-versions-cas-')), 'versions.json');
    const store = new H3VersionStore(file);
    store.create({
      id: 'v1',
      parentId: null,
      label: 'H3 1',
      jobId: 'j1',
      createdAt: '2026-01-01T00:00:00Z',
      selected: true,
    });
    store.create({
      id: 'v2',
      parentId: 'v1',
      label: 'H3 2',
      jobId: 'j2',
      createdAt: '2026-01-01T00:00:01Z',
      selected: false,
    });

    expect(() => store.accept('v2', 'v-other')).toThrow('H3_VERSION_CONFLICT');
    expect(store.list().find((version) => version.selected)?.id).toBe('v1');
  });

  it('does not auto-select after an explicit selection and undo return to the original version', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-versions-return-'));
    const file = path.join(directory, 'versions.json');
    const store = new H3VersionStore(file);
    try {
      const initial = { id: 'a', parentId: null, label: 'A', jobId: 'job-a', createdAt: '2026-01-01T00:00:00Z' };
      store.create({ ...initial, selected: true });
      store.create({ ...initial, id: 'b', jobId: 'job-b', label: 'B', selected: false });
      const submitted = store.submissionContext();
      store.select('b', 'a');
      store.undo();

      const reopened = new H3VersionStore(file);
      reopened.publishCompletedJob({
        ...createH3Job({ prompt: 'Generate C' }, 'job-c'),
        ...submitted,
        status: 'succeeded',
        artifacts: [
          { filename: 'c.mp4', subfolder: '', type: 'output', mimeType: 'video/mp4', resourcePath: '/artifacts/c' },
        ],
      });
      expect(reopened.list().find((version) => version.selected)?.id).toBe('a');
      expect(reopened.list()).toContainEqual(
        expect.objectContaining({ jobId: 'job-c', parentId: 'a', selected: false })
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('supports compare, reject, undo and persisted acceptance decisions', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h3-versions-review-')), 'versions.json');
    const store = new H3VersionStore(file);
    store.create({
      id: 'v1',
      parentId: null,
      label: 'H3 1',
      jobId: 'j1',
      createdAt: '2026-01-01T00:00:00Z',
      selected: true,
    });
    store.create({
      id: 'v2',
      parentId: 'v1',
      label: 'H3 2',
      jobId: 'j2',
      createdAt: '2026-01-01T00:00:01Z',
      selected: false,
    });

    expect(store.compare(['v2', 'v1']).map((version) => version.id)).toEqual(['v1', 'v2']);
    expect(store.reject('v2').find((version) => version.id === 'v2')).toMatchObject({ review: 'rejected' });
    expect(store.undo('v2').find((version) => version.id === 'v2')).toMatchObject({ review: 'candidate' });
    store.accept('v2', 'v1');
    expect(store.list().find((version) => version.selected)?.id).toBe('v2');
    expect(store.undo().find((version) => version.selected)?.id).toBe('v1');
    expect(new H3VersionStore(file).list().find((version) => version.selected)?.id).toBe('v1');
  });
});
