import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { H3VersionStore } from '@/process/services/runtime/H3VersionStore';

describe('H3 version store', () => {
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
