import fs from 'node:fs';
import path from 'node:path';
import type { H3Version } from '@/common/chat/document/h3Job';

export class H3VersionStore {
  private readonly versions = new Map<string, H3Version>();
  constructor(private readonly filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    if (fs.existsSync(filename)) {
      for (const value of JSON.parse(fs.readFileSync(filename, 'utf8')) as H3Version[]) {
        this.versions.set(value.id, {
          ...value,
          // Older stores only had `selected`; treat their selected row as an
          // accepted root and every other row as a reviewable candidate.
          review: value.review ?? (value.selected ? 'accepted' : 'candidate'),
        });
      }
    }
  }
  list(): H3Version[] {
    return [...this.versions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  create(version: H3Version): H3Version {
    this.versions.set(version.id, {
      ...version,
      review: version.review ?? (version.selected ? 'accepted' : 'candidate'),
    });
    this.flush();
    return this.versions.get(version.id)!;
  }

  /** Return the requested candidates in stable creation order for comparison. */
  compare(ids: string[]): H3Version[] {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 4) throw new Error('H3_VERSION_COMPARE_INVALID');
    const selected = unique.map((id) => {
      const version = this.versions.get(id);
      if (!version) throw new Error('H3_VERSION_NOT_FOUND');
      if (version.review === 'rejected') throw new Error('H3_VERSION_REJECTED');
      return version;
    });
    return selected.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Accept a candidate only if the caller still observes the same source version. */
  accept(id: string, expectedSelectedId?: string | null): H3Version[] {
    const target = this.versions.get(id);
    if (!target) throw new Error('H3_VERSION_NOT_FOUND');
    if (target.review === 'rejected') throw new Error('H3_VERSION_REJECTED');
    const current = [...this.versions.values()].find((value) => value.selected);
    if (expectedSelectedId !== undefined && expectedSelectedId !== (current?.id ?? null))
      throw new Error('H3_VERSION_CONFLICT');
    if (target.parentId && current?.id !== target.parentId) throw new Error('H3_VERSION_CONFLICT');

    const next = [...this.versions.values()].map((value) => {
      if (value.id === target.id)
        return {
          ...value,
          selected: true,
          review: 'accepted' as const,
          ...(current && current.id !== target.id ? { previousSelectedId: current.id } : {}),
        };
      return { ...value, selected: false, ...(value.id === current?.id ? { review: 'candidate' as const } : {}) };
    });
    this.versions.clear();
    for (const value of next) this.versions.set(value.id, value);
    this.flush();
    return this.list();
  }

  /** Backward-compatible name used by the original UI/API. */
  select(id: string, expectedSelectedId?: string | null): H3Version[] {
    return this.accept(id, expectedSelectedId);
  }

  reject(id: string): H3Version[] {
    const target = this.versions.get(id);
    if (!target) throw new Error('H3_VERSION_NOT_FOUND');
    if (target.selected) throw new Error('H3_VERSION_SELECTED_CANNOT_REJECT');
    this.versions.set(id, { ...target, review: 'rejected', previousSelectedId: undefined });
    this.flush();
    return this.list();
  }

  /** Undo a rejection, or undo the most recent accepted candidate when no id is given. */
  undo(id?: string): H3Version[] {
    if (id) {
      const target = this.versions.get(id);
      if (!target) throw new Error('H3_VERSION_NOT_FOUND');
      if (target.review !== 'rejected') throw new Error('H3_VERSION_NOT_REJECTED');
      this.versions.set(id, { ...target, review: 'candidate' });
      this.flush();
      return this.list();
    }
    const current = [...this.versions.values()].find((value) => value.selected && value.previousSelectedId);
    if (!current?.previousSelectedId) throw new Error('H3_VERSION_NOTHING_TO_UNDO');
    const previous = this.versions.get(current.previousSelectedId);
    if (!previous) throw new Error('H3_VERSION_CONFLICT');
    this.versions.set(current.id, {
      ...current,
      selected: false,
      review: 'candidate',
      previousSelectedId: undefined,
    });
    this.versions.set(previous.id, { ...previous, selected: true, review: 'accepted' });
    this.flush();
    return this.list();
  }
  private flush(): void {
    const temp = `${this.filename}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.list(), null, 2), 'utf8');
    fs.renameSync(temp, this.filename);
  }
}
