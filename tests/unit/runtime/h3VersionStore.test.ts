import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { H3VersionStore } from '@/process/services/runtime/H3VersionStore';

describe('H3 version store', () => {
  it('persists versions and selects exactly one candidate', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h3-versions-')), 'versions.json');
    const store = new H3VersionStore(file);
    store.create({ id: 'v1', parentId: null, label: 'H3 1', jobId: 'j1', createdAt: '2026-01-01T00:00:00Z', selected: true });
    store.create({ id: 'v2', parentId: 'v1', label: 'H3 2', jobId: 'j2', createdAt: '2026-01-01T00:00:01Z', selected: false });
    expect(store.select('v2').filter((version) => version.selected).map((version) => version.id)).toEqual(['v2']);
    expect(new H3VersionStore(file).list().find((version) => version.selected)?.id).toBe('v2');
  });
});
